import crypto from "crypto";
import { createLogger } from "../common/logger";
import { TenantService } from "./tenant.service";
import { User } from "../models";
import {
  UnauthorizedError,
  ForbiddenError,
  BadRequestError,
} from "../common/errors";
import { runInTenantContext } from "../plugins/tenantPlugin";

const logger = createLogger("sso-token-service");

interface TenantTokenPayload {
  tenantUserId: string;
  email: string;
  name: string;
  avatarUrl?: string;
  tenantId: string;
  externalSystem: string;
  timestamp: number;
  nonce: string;
  iss: string;
  aud: string;
  exp: number;
}

export class SSOTokenService {
  /**
   * Validate and decode SSO token
   */
  static async validateToken(
    token: string,
    signature: string,
  ): Promise<TenantTokenPayload> {
    try {
      // Decode token
      const decodedStr = Buffer.from(token, "base64").toString("utf-8");
      const payload: TenantTokenPayload = JSON.parse(decodedStr);

      // Validate payload
      if (
        !payload.tenantId ||
        !payload.tenantUserId ||
        !payload.email ||
        !payload.externalSystem
      ) {
        throw new BadRequestError("Invalid token payload");
      }

      // Check entry
      const now = Math.floor(Date.now() / 1000);
      if (payload && payload.exp < now) {
        throw new UnauthorizedError("Token has expired");
      }
      logger.debug("Payload info", { payload });

      // Get tenant
      const tenant = await TenantService.getTenantWithSecret(payload.tenantId);
      logger.debug("Tenant info", { tenant });
      if (!tenant || !tenant.isActive || tenant.status !== "verified") {
        throw new ForbiddenError("Tenant is not active or verified");
      }

      // Verify signature
      const expectedSignature = crypto
        .createHmac("sha256", tenant.sharedSecret)
        .update(token)
        .digest("hex");
      if (signature !== expectedSignature) {
        throw new UnauthorizedError("Invalid token signature");
      }

      logger.info("SSO token validated successfully for tenant", {
        tenantId: payload.tenantId,
        userId: payload.tenantUserId,
      });

      return payload;
    } catch (error) {
      logger.error("Failed to validate SSO token", { error });
      throw error;
    }
  }

  /**
   * Find or create user from SSO payload
   */
  static async findOrCreateUser(payload: TenantTokenPayload) {
    return runInTenantContext(payload.tenantId, async () => {
      let user = await User.findOne({
        tenantId: payload.tenantId,
        externalSystem: payload.externalSystem,
        externalId: payload.tenantUserId,
      });

      if (!user) {
        user = await User.create({
          tenantId: payload.tenantId,
          externalId: payload.tenantUserId,
          externalSystem: payload.externalSystem,
          email: payload.email,
          username: `${payload.email.split("@")[0]}_${
            payload.tenantId
          }_${payload.tenantUserId.slice(0, 6)}`,
          displayName: payload.name,
          avatarUrl: payload.avatarUrl,
          isActive: true,
          emailVerified: true,
        });
        logger.info("Created new user from SSO", {
          userId: user._id,
          tenantId: payload.tenantId,
        });
      } else {
        // Update existing user
        user.displayName = payload.name;
        user.email = payload.email;
        user.avatarUrl = payload.avatarUrl;
        user.isActive = true;
        await user.save();

        logger.info("Updated existing user from SSO", {
          userId: user._id,
          tenantId: payload.tenantId,
        });
      }

      return user;
    });
  }
}
