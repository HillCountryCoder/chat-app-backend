import { Response, NextFunction } from "express";
import crypto from "crypto";
import { TenantService } from "../../services/tenant.service";
import { User } from "../../models/user.model";
import { setTenantContext } from "../../plugins/tenantPlugin";
import { TenantAuthenticatedRequest } from "../types/auth.type";

interface TenantTokenPayload {
  tenantUserId: string; // External user ID
  email: string;
  name: string;
  avatarUrl?: string;
  tenantId: string;
  timestamp: number;
  nonce: string;
  iss: string; // Issuer
  aud: string; // Audience
  exp: number; // Expiry timestamp
}

/**
 * Middleware to verify SSO token from parent app (e.g., WNP)
 * and auto-create/sync user in chat database
 *
 * This middleware:
 * 1. Verifies the JWT signature using tenant's shared secret
 * 2. Validates token expiry and structure
 * 3. Checks origin against tenant's allowed origins
 * 4. Auto-creates or syncs user in chat database
 * 5. Attaches tenant context to request
 */
export const verifySSOToken = async (
  req: TenantAuthenticatedRequest,
  res: Response,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  next: NextFunction,
) => {
  try {
    const { token, signature } = req.body;

    if (!token || !signature) {
      return res.status(400).json({
        error: "Missing token or signature",
      });
    }

    // 1. Decode token payload
    let payload: TenantTokenPayload;
    try {
      const decodedStr = Buffer.from(token, "base64").toString("utf-8");
      payload = JSON.parse(decodedStr);
    } catch (err) {
      console.error("Token decode failed:", err);
      return res.status(400).json({ error: "Invalid token format" });
    }

    // 2. Validate token structure
    if (!payload.tenantId || !payload.tenantUserId || !payload.email) {
      return res.status(400).json({ error: "Invalid token payload" });
    }

    // 3. Check token expiry
    const now = Math.floor(Date.now() / 1000);
    if (payload.exp && payload.exp < now) {
      return res.status(401).json({ error: "Token expired" });
    }

    // 4. Get tenant and verify signature
    const tenant = await TenantService.getTenantWithSecret(payload.tenantId);

    if (!tenant) {
      console.error("Tenant not found:", payload.tenantId);
      return res.status(404).json({ error: "Tenant not found" });
    }

    if (!tenant.isActive || tenant.status !== "verified") {
      return res.status(403).json({ error: "Tenant not active" });
    }

    // Verify HMAC signature
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

    // 5. Verify origin
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

    // 6. Set tenant context for database operations
    await new Promise<void>((resolve) => {
      setTenantContext(tenant.tenantId)(req, res, () => resolve());
    });

    // 7. Find or create user in Chat DB
    let chatUser = await User.findOne({
      tenantId: tenant.tenantId,
      externalId: payload.tenantUserId,
      externalSystem: "wnp",
    });

    if (!chatUser) {
      // Auto-create user on first login
      chatUser = await User.create({
        tenantId: tenant.tenantId,
        externalId: payload.tenantUserId,
        externalSystem: "wnp",
        email: payload.email,
        username:
          payload.email.split("@")[0] + "_" + payload.tenantUserId.slice(0, 6),
        displayName: payload.name,
        avatarUrl: payload.avatarUrl,
        isActive: true,
        emailVerified: true, // Trust parent app's verification
        // No passwordHash for federated users
      });

      console.log(
        "✅ Auto-created chat user for external user:",
        payload.tenantUserId,
      );
    } else {
      // Update user info in case it changed in parent app
      chatUser.displayName = payload.name;
      chatUser.email = payload.email;
      chatUser.avatarUrl = payload.avatarUrl;
      chatUser.isActive = true;
      await chatUser.save();

      console.log(
        "✅ Synced chat user data from external system:",
        payload.tenantUserId,
      );
    }

    // 8. Generate chat session token
    const sessionToken = crypto.randomBytes(32).toString("hex");

    // TODO: Store in Redis (1 hour expiry)
    // await redis.setex(
    //   `chat_session:${sessionToken}`,
    //   3600,
    //   JSON.stringify({
    //     tenantId: tenant.tenantId,
    //     userId: chatUser._id.toString(),
    //     email: chatUser.email,
    //     externalId: payload.tenantUserId
    //   })
    // );

    // 9. Attach context to request for next middleware
    req.tenantContext = {
      tenantId: tenant.tenantId,
      userId: chatUser._id.toString(),
      email: chatUser.email,
      displayName: chatUser.displayName,
    };
    req.tenantId = tenant.tenantId;
    req.user = chatUser;

    // 10. Send response with session token
    res.json({
      success: true,
      sessionToken,
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
    console.error("SSO verification failed:", error);
    return res.status(500).json({ error: "Authentication failed" });
  }
};
