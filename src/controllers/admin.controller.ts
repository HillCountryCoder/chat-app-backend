import { NextFunction, Request, Response } from "express";
import crypto from "crypto";
import { TenantService } from "../services/tenant.service";
import { createLogger } from "../common/logger";

const logger = createLogger("admin-controller");

export class AdminController {
  /**
   * POST /api/admin/tenants/generate-credentials
   * Generate credentials for a new tenant (internal use only)
   */
  static async generateTenantCredentials(
    req: Request,
    res: Response,
    next: NextFunction,
  ) {
    try {
      // TODO: Add super admin authentication
      // if (!req.user?.isSuperAdmin) {
      //   res.status(403).json({ error: "Unauthorized" });
      // }

      const { tenantId, name, adminEmail } = req.body;

      if (!tenantId || !name || !adminEmail) {
        res.status(400).json({
          error: "Missing required fields: tenantId, name, adminEmail",
        });
      }

      // Validate tenantId format
      if (!/^[a-z0-9-_]+$/.test(tenantId)) {
        res.status(400).json({
          error: "Invalid tenantId format",
        });
      }

      // Check if tenant already exists
      const existing = await TenantService.getTenant(tenantId);
      if (existing) {
        res.status(409).json({
          error: "Tenant with this ID already exists",
        });
      }

      // Generate cryptographically secure credentials
      const sharedSecret = crypto.randomBytes(32).toString("hex");
      const registrationToken = crypto.randomBytes(32).toString("hex");
      const registrationExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

      // Store pending registration
      await TenantService.createPendingRegistration({
        tenantId,
        name,
        adminEmail,
        sharedSecret,
        registrationToken,
        registrationExpiry,
      });

      logger.info("Generated tenant credentials", { tenantId, adminEmail });

      // Return credentials - send these to client securely
      res.json({
        success: true,
        credentials: {
          tenantId,
          sharedSecret,
          registrationToken,
          expiresAt: registrationExpiry.toISOString(),
        },
        instructions: {
          step1:
            "Send sharedSecret and registrationToken to client via secure channel",
          step2: "Client stores sharedSecret in their .env file",
          step3: "Client calls POST /api/tenants/register with all credentials",
          step4: "You verify domain and activate tenant",
        },
        clientCurlExample: `curl -X POST https://your-chat-api.com/api/tenants/register \\
  -H "Content-Type: application/json" \\
  -d '{
    "tenantId": "${tenantId}",
    "domain": "client-domain.com",
    "allowedOrigins": ["https://client-domain.com", "https://app.client-domain.com"],
    "sharedSecret": "${sharedSecret}",
    "registrationToken": "${registrationToken}"
  }'`,
      });
    } catch (error) {
      logger.error("Failed to generate tenant credentials", { error });
      next(error);
    }
  }

  /**
   * GET /api/admin/tenants
   * List all tenants
   */
  static async listAllTenants(req: Request, res: Response, next: NextFunction) {
    try {
      const tenants = await TenantService.getAllTenants();

      res.json({
        success: true,
        tenants: tenants.map((t) => ({
          id: t.tenantId,
          name: t.name,
          domain: t.domain,
          status: t.status,
          isActive: t.isActive,
          createdAt: t.createdAt,
        })),
      });
    } catch (error) {
      logger.error("Failed to list tenants", { error });
      next(error);
    }
  }

  /**
   * POST /api/admin/tenants/:tenantId/activate
   * Manually activate a tenant
   */
  static async activateTenant(req: Request, res: Response, next: NextFunction) {
    try {
      const { tenantId } = req.params;

      const tenant = await TenantService.setTenantStatus(tenantId, "verified");

      res.json({
        success: true,
        message: `Tenant ${tenantId} activated`,
        tenant: {
          id: tenant.tenantId,
          status: tenant.status,
          isActive: tenant.isActive,
        },
      });
    } catch (error) {
      logger.error("Failed to activate tenant", { error });
      next(error);
    }
  }
}
