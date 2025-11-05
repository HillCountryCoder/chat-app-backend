import { Request, Response, NextFunction } from "express";
import { TenantService } from "../services/tenant.service";
import { runInTenantContext, tenantContext } from "../plugins/tenantPlugin";
import { TenantAuthenticatedRequest } from "../common/types/auth.type";
import {
  BadRequestError,
  NotFoundError,
  UnauthorizedError,
} from "../common/errors";
import { authService } from "../services";
import { User } from "../models";
import crypto from "crypto";
import { createLogger } from "../common/logger";

interface TenantTokenPayload {
  tenantUserId: string; // External user ID
  email: string;
  name: string;
  avatarUrl?: string;
  tenantId: string;
  externalSystem: string; // 'wnp', 'shopify', etc. - DYNAMIC!
  timestamp: number;
  nonce: string;
  iss: string; // Issuer
  aud: string; // Audience
  exp: number; // Expiry timestamp (in seconds)
}

const logger = createLogger("tenant-controller");
export class TenantController {
  /**
   * POST /api/tenants/sso/init
   * SSO authentication endpoint (controller version)
   */
  static async initSSO(req: Request, res: Response, next: NextFunction) {
    try {
      const { token, signature } = req.body;

      // Validate request
      if (!token || !signature) {
        res.status(400).json({ error: "Missing token or signature" });
      }

      // Decode token
      let payload: TenantTokenPayload;
      try {
        const decodedStr = Buffer.from(token, "base64").toString("utf-8");
        payload = JSON.parse(decodedStr);
      } catch (err) {
        logger.error("Failed to decode SSO token", { error: err });
        throw new BadRequestError("Invalid token format");
      }

      // Validate payload
      if (
        !payload.tenantId ||
        !payload.tenantUserId ||
        !payload.email ||
        !payload.externalSystem
      ) {
        res.status(400).json({ error: "Invalid token payload" });
      }

      // Check expiry
      const now = Math.floor(Date.now() / 1000);
      if (payload.exp && payload.exp < now) {
        res.status(401).json({ error: "Token expired" });
      }

      // Get tenant
      const tenant = await TenantService.getTenantWithSecret(payload.tenantId);
      if (!tenant || !tenant.isActive || tenant.status !== "verified") {
        res.status(403).json({ error: "Tenant not active" });
      }

      // Verify signature
      const expectedSignature = crypto
        .createHmac("sha256", tenant.sharedSecret)
        .update(token)
        .digest("hex");

      if (signature !== expectedSignature) {
        res.status(401).json({ error: "Invalid signature" });
      }

      // Verify origin
      const origin = req.headers.origin || req.headers.referer;
      if (
        !origin ||
        !tenant.allowedOrigins.some((allowed) => origin.startsWith(allowed))
      ) {
        res.status(403).json({ error: "Origin not allowed" });
      }

      // Find or create user
      const chatUser = await runInTenantContext(tenant.tenantId, async () => {
        let user = await User.findOne({
          tenantId: tenant.tenantId,
          externalId: payload.tenantUserId,
          externalSystem: payload.externalSystem,
        });

        if (!user) {
          user = await User.create({
            tenantId: tenant.tenantId,
            externalId: payload.tenantUserId,
            externalSystem: payload.externalSystem,
            email: payload.email,
            username:
              payload.email.split("@")[0] +
              "_" +
              payload.tenantUserId.slice(0, 6),
            displayName: payload.name,
            avatarUrl: payload.avatarUrl,
            isActive: true,
            emailVerified: true,
          });
        } else {
          user.displayName = payload.name;
          user.email = payload.email;
          user.avatarUrl = payload.avatarUrl;
          user.isActive = true;
          await user.save();
        }

        return user;
      });

      logger.info("SSO user authenticated", {
        tenantId: tenant.tenantId,
        user: { ...chatUser },
      });

      // Generate tokens
      const deviceInfo = req.headers["user-agent"] || "Unknown Device";
      const ipAddress = req.ip || req.socket.remoteAddress || "Unknown IP";
      const userAgent = req.headers["user-agent"] || "Unknown";

      const {
        accessToken,
        refreshToken,
        accessTokenExpiresIn,
        refreshTokenExpiresIn,
      } = await authService.generateTokenPair(
        chatUser,
        false,
        deviceInfo,
        ipAddress,
        userAgent,
      );
      logger.info("SSO init successful", {
        userId: chatUser._id.toString(),
        tenantId: tenant.tenantId,
        accessToken: accessToken,
        refreshToken: refreshToken,
      });
      // Return response
      res.status(200).json({
        success: true,
        accessToken,
        refreshToken,
        accessTokenExpiresIn,
        refreshTokenExpiresIn,
        user: {
          id: chatUser._id.toString(),
          email: chatUser.email,
          displayName: chatUser.displayName,
          avatarUrl: chatUser.avatarUrl,
        },
        tenant: {
          id: tenant.tenantId,
          name: tenant.name,
        },
      });
    } catch (error) {
      console.error("SSO init failed:", error);
      next(error);
    }
  }
  /**
   * POST /api/tenants/register
   * Complete tenant registration (called by client with credentials)
   * This is the NEW method that clients use
   */
  static async registerTenant(req: Request, res: Response, next: NextFunction) {
    try {
      const {
        tenantId,
        domain,
        allowedOrigins,
        sharedSecret,
        registrationToken,
      } = req.body;

      // Validate required fields
      if (
        !tenantId ||
        !domain ||
        !allowedOrigins ||
        !sharedSecret ||
        !registrationToken
      ) {
        res.status(400).json({
          error:
            "Missing required fields: tenantId, domain, allowedOrigins, sharedSecret, registrationToken",
        });
      }

      // Complete registration with provided credentials
      const tenant = await TenantService.completeRegistration({
        tenantId,
        domain,
        allowedOrigins,
        sharedSecret,
        registrationToken,
      });

      res.status(201).json({
        success: true,
        tenant: {
          id: tenant.tenantId,
          name: tenant.name,
          domain: tenant.domain,
          status: tenant.status,
          // DO NOT sharedSecret
        },
        message:
          "Tenant registered successfully. Please contact admin to verify your domain.",
      });
    } catch (error) {
      console.error("Tenant registration error:", error);
      next(error);
    }
  }

  /**
   * POST /api/tenants/verify
   * Verify tenant domain ownership
   */
  static async verifyTenant(req: Request, res: Response, next: NextFunction) {
    try {
      const { tenantId, verificationCode } = req.body;

      if (!tenantId || !verificationCode) {
        res.status(400).json({
          error: "Missing tenantId or verificationCode",
        });
      }

      const tenant = await TenantService.verifyTenant(
        tenantId,
        verificationCode,
      );

      res.json({
        success: true,
        tenant: {
          id: tenant.tenantId,
          name: tenant.name,
          status: tenant.status,
        },
        message:
          "Tenant verified successfully. Default channels have been created.",
      });
    } catch (error) {
      console.error("Tenant verification error:", error);
      next(error);
    }
  }

  /**
   * GET /api/tenants/:tenantId
   * Get tenant details (public information only)
   */
  static async getTenantById(req: Request, res: Response, next: NextFunction) {
    try {
      const { tenantId } = req.params;

      const tenant = await TenantService.getTenant(tenantId);

      if (!tenant) {
        return res.status(404).json({ error: "Tenant not found" });
      }

      res.json({
        success: true,
        tenant: {
          id: tenant.tenantId,
          name: tenant.name,
          domain: tenant.domain,
          status: tenant.status,
          isActive: tenant.isActive,
          // Don't expose settings or allowedOrigins publicly
        },
      });
    } catch (error) {
      console.error("Get tenant error:", error);
      next(error);
    }
  }

  /**
   * PATCH /api/tenants/:tenantId
   * Update tenant settings
   * Requires authentication and admin permissions
   */
  static async updateTenantById(
    req: TenantAuthenticatedRequest,
    res: Response,
    next: NextFunction,
  ) {
    try {
      const { tenantId } = req.params;
      const updates = req.body;

      // Verify user is authenticated
      if (!req.user) {
        throw new UnauthorizedError("Authentication required");
      }

      // TODO: Verify that requester has admin permissions for this tenant
      // For now, just check if user belongs to the tenant
      if (req.user.tenantId !== tenantId) {
        res.status(403).json({
          error: "You don't have permission to update this tenant",
        });
      }

      const tenant = await TenantService.updateTenant(tenantId, updates);

      res.json({
        success: true,
        tenant: {
          id: tenant.tenantId,
          name: tenant.name,
          settings: tenant.settings,
          allowedOrigins: tenant.allowedOrigins,
        },
        message: "Tenant updated successfully",
      });
    } catch (error) {
      console.error("Update tenant error:", error);
      next(error);
    }
  }

  /**
   * DELETE /api/tenants/:tenantId
   * Suspend tenant
   * Requires authentication and super admin permissions
   */
  static async deleteTenantById(
    req: TenantAuthenticatedRequest,
    res: Response,
    next: NextFunction,
  ) {
    try {
      const { tenantId } = req.params;

      // Verify user is authenticated
      if (!req.user) {
        throw new UnauthorizedError("Authentication required");
      }

      // TODO: Verify that requester has super admin permissions
      // This should only be allowed for platform administrators

      await TenantService.setTenantStatus(tenantId, "suspended");

      res.json({
        success: true,
        message: "Tenant suspended successfully",
      });
    } catch (error) {
      console.error("Suspend tenant error:", error);
      next(error);
    }
  }

  /**
   * GET /api/tenants
   * List all active tenants
   * Requires authentication
   */
  static async getAllActiveTenants(
    req: TenantAuthenticatedRequest,
    res: Response,
    next: NextFunction,
  ) {
    try {
      // Verify user is authenticated
      if (!req.user) {
        throw new UnauthorizedError("Authentication required");
      }

      const tenants = await TenantService.getActiveTenants();

      res.json({
        success: true,
        tenants: tenants.map((t) => ({
          id: t.tenantId,
          name: t.name,
          domain: t.domain,
          status: t.status,
        })),
      });
    } catch (error) {
      console.error("List tenants error:", error);
      next(error);
    }
  }

  // ===== SSO AUTH ENDPOINTS =====

  /**
   * GET /api/tenants/sso/session
   * Get current session info
   * Uses tenant context from middleware
   */
  static async getCurrentSessionInfo(
    req: TenantAuthenticatedRequest,
    res: Response,
    next: NextFunction,
  ) {
    try {
      // Check if user is authenticated
      if (!req.user) {
        throw new UnauthorizedError("User not authenticated");
      }

      // Get tenant context (could be from AsyncLocalStorage or request)
      const context = req.tenantContext || tenantContext.getStore();

      if (!context) {
        throw new NotFoundError("No tenant context found");
      }

      res.json({
        success: true,
        session: {
          tenantId: context.tenantId,
          userId: req.user._id.toString(),
          email: req.user.email,
          displayName: req.user.displayName,
          externalId: req.user.externalId,
          externalSystem: req.user.externalSystem,
        },
      });
    } catch (error) {
      console.error("Get session error:", error);
      next(error);
    }
  }

  /**
   * DELETE /api/tenants/sso/logout
   * Revoke session
   */
  static async logoutSSO(
    req: TenantAuthenticatedRequest,
    res: Response,
    next: NextFunction,
  ) {
    try {
      const token = req.headers.authorization?.replace("Bearer ", "");

      if (token) {
        // TODO: Delete from Redis
        // await redis.del(`chat_session:${token}`);
      }

      res.json({
        success: true,
        message: "Logged out successfully",
      });
    } catch (error) {
      console.error("Logout error:", error);
      next(error);
    }
  }
}
