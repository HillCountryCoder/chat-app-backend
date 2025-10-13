import { Request, Response, NextFunction } from "express";
import { TenantService } from "../services/tenant.service";
import { tenantContext } from "../plugins/tenantPlugin";
import { TenantAuthenticatedRequest } from "../common/types/auth.type";
import { UnauthorizedError } from "../common/errors";

export class TenantController {
  /**
   * POST /api/tenants/register
   * Register a new tenant
   */
  static async registerTenant(req: Request, res: Response, next: NextFunction) {
    try {
      const { tenantId, name, domain, allowedOrigins, adminEmail } = req.body;

      // Validate required fields
      if (!tenantId || !name || !domain || !allowedOrigins || !adminEmail) {
        return res.status(400).json({
          error:
            "Missing required fields: tenantId, name, domain, allowedOrigins, adminEmail",
        });
      }

      const tenant = await TenantService.registerTenant({
        tenantId,
        name,
        domain,
        allowedOrigins,
        adminEmail,
      });

      res.status(201).json({
        success: true,
        tenant: {
          id: tenant.tenantId,
          name: tenant.name,
          domain: tenant.domain,
          status: tenant.status,
          sharedSecret: tenant.sharedSecret, // Return secret ONLY on registration
        },
        message:
          "Tenant registered successfully. Store the sharedSecret securely!",
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
        return res.status(400).json({
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
        return res.status(403).json({
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
        return res.status(401).json({ error: "No active session" });
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
