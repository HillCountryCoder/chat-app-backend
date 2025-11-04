import { Response } from "express";
import crypto from "crypto";
import { TenantService } from "../../services/tenant.service";
import { User } from "../../models/user.model";
import { TenantAuthenticatedRequest } from "../types/auth.type";
import { authService } from "../../services";
import { runInTenantContext } from "../../plugins/tenantPlugin";
import { createLogger } from "../logger";

const logger = createLogger("sso-auth-middleware");
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

/**
 * SSO Authentication Middleware
 *
 * This is a TERMINAL middleware - it sends a response and does NOT call next()
 *
 * Purpose: Verify SSO token from parent app and return a session token
 *
 * Flow:
 * 1. Parent app POSTs to /api/tenants/sso/init with signed token
 * 2. This middleware verifies signature, creates/syncs user
 * 3. Returns sessionToken for client to use in subsequent requests
 * 4. Client uses sessionToken with normal authMiddleware for all other API calls
 *
 * @param req - Request with token and signature in body
* @param res - Response object
 * @param next - NextFunction (not used - this is terminal middleware)
 */
export const verifySSOToken = async (
  req: TenantAuthenticatedRequest,
  res: Response,
) => {
  try {
    const { token, signature } = req.body;
    logger.info("Starting SSO token verification process", {
      tenantId: req.body.tenantId,
      token: token,
      signature: signature,
    });

    // 1. Validate request has required fields
    if (!token || !signature) {
      return res.status(400).json({
        error: "Missing token or signature",
      });
    }

    // 2. Decode token payload
    let payload: TenantTokenPayload;
    try {
      const decodedStr = Buffer.from(token, "base64").toString("utf-8");
      payload = JSON.parse(decodedStr);
    } catch (err) {
      console.error("Token decode failed:", err);
      return res.status(400).json({ error: "Invalid token format" });
    }

    // 3. Validate token structure
    if (
      !payload.tenantId ||
      !payload.tenantUserId ||
      !payload.email ||
      !payload.externalSystem
    ) {
      return res.status(400).json({
        error: "Invalid token payload - missing required fields",
      });
    }

    // 4. Check token expiry
    const now = Math.floor(Date.now() / 1000);
    if (payload.exp && payload.exp < now) {
      return res.status(401).json({ error: "Token expired" });
    }
    logger.info("SSO token payload validated", {
      tenantId: payload.tenantId,
      tenantUserId: payload.tenantUserId,
    });
    // 5. Get tenant and verify it's active
    const tenant = await TenantService.getTenantWithSecret(payload.tenantId);
    logger.info("Fetched tenant for SSO", {
      tenantId: payload.tenantId,
      tenant,
    });
    if (!tenant) {
      console.error("Tenant not found:", payload.tenantId);
      return res.status(404).json({ error: "Tenant not found" });
    }

    if (!tenant.isActive || tenant.status !== "verified") {
      return res.status(403).json({ error: "Tenant not active" });
    }

    // 6. Verify HMAC signature
    const expectedSignature = crypto
      .createHmac("sha256", tenant.sharedSecret)
      .update(token)
      .digest("hex");

    if (signature !== expectedSignature) {
      console.error("Signature mismatch:", {
        received: signature,
        expected: expectedSignature,
      });

      // Log security event
      console.error(
        "🚨 SECURITY ALERT: Invalid signature for tenant",
        payload.tenantId,
      );

      return res.status(401).json({ error: "Invalid signature" });
    }

    // 7. Verify origin
    const origin = req.headers.origin || req.headers.referer;

    if (
      !origin ||
      !tenant.allowedOrigins.some((allowed) => origin.startsWith(allowed))
    ) {
      console.error("Origin not allowed:", {
        origin,
        allowed: tenant.allowedOrigins,
      });

      return res.status(403).json({ error: "Origin not allowed" });
    }

    // 8. Find or create user in Chat DB (within tenant context)
    const chatUser = await runInTenantContext(tenant.tenantId, async () => {
      let user = await User.findOne({
        tenantId: tenant.tenantId,
        externalId: payload.tenantUserId,
        externalSystem: payload.externalSystem, // Dynamic!
      });

      if (!user) {
        // Auto-create user on first login
        user = await User.create({
          tenantId: tenant.tenantId,
          externalId: payload.tenantUserId,
          externalSystem: payload.externalSystem, // Dynamic!
          email: payload.email,
          username:
            payload.email.split("@")[0] +
            "_" +
            payload.tenantUserId.slice(0, 6),
          displayName: payload.name,
          avatarUrl: payload.avatarUrl,
          isActive: true,
          emailVerified: true, // Trust parent app's verification
          // No passwordHash for federated users
        });

        console.log(
          `✅ Auto-created chat user for ${payload.externalSystem} user:`,
          payload.tenantUserId,
        );
      } else {
        // Update user info in case it changed in parent app
        user.displayName = payload.name;
        user.email = payload.email;
        user.avatarUrl = payload.avatarUrl;
        user.isActive = true;
        await user.save();

        console.log(
          `✅ Synced chat user data from ${payload.externalSystem}:`,
          payload.tenantUserId,
        );
      }

      return user;
    });

    // 9. Generate chat session token ( already stored in database )
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
    logger.info("Generated token pair for SSO user", {
      accessTokenExpiresIn,
      refreshTokenExpiresIn,
      tenantId: payload.tenantId,
      tenantEmail: payload.email,
    });

    // 10 return response
    logger.info("About to send SSO response", {
      hasAccessToken: !!accessToken,
      hasRefreshToken: !!refreshToken,
      userId: chatUser._id.toString(),
    });

    // 10 return response
    const responseData = {
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
    };

    logger.info("Sending SSO response", { responseData });

    res.status(200).json(responseData); // Explicitly set status 200

    logger.info("SSO response sent successfully");
  } catch (error) {
    console.error("SSO verification failed:", error);
    return res.status(500).json({ error: "Authentication failed" });
  }
};
