import { Router } from "express";
import { RequestHandler } from "express";
import { TenantController } from "../controllers/tenant.controller";
import { authMiddleware } from "../common/middlewares";
import { verifySSOToken } from "../common/middlewares/sso_authentication.middleware";

const router = Router();

// ===== SSO AUTHENTICATION ROUTES (Must come BEFORE parameterized routes) =====
/**
 * POST /api/tenants/sso/init
 * Initialize SSO session from parent app
 * This uses the verifySSOToken middleware which handles the entire auth flow
 **/
router.post("/sso/init", verifySSOToken as RequestHandler);

/**
 * GET /api/tenants/sso/session
 * Get current session info
 * Requires valid JWT token
 */
router.get(
  "/sso/session",
  authMiddleware,
  TenantController.getCurrentSessionInfo as RequestHandler,
);

/**
 * DELETE /api/tenants/sso/logout
 * Revoke session
 * Requires valid JWT token
 */
router.delete("/sso/logout", authMiddleware, TenantController.logoutSSO);

// ===== PUBLIC TENANT ROUTES (No Auth Required) =====
/**
 * POST /api/tenants/register
 * Register a new tenant
 */
router.post("/register", TenantController.registerTenant as RequestHandler);

/**
 * POST /api/tenants/verify
 * Verify tenant domain ownership
 */
router.post("/verify", TenantController.verifyTenant as RequestHandler);

// ===== PROTECTED TENANT MANAGEMENT ROUTES (Auth Required) =====
/**
 * GET /api/tenants
 * List all active tenants
 * Requires authentication
 * NOTE: This must come BEFORE /:tenantId to avoid conflicts
 */
router.get("/", authMiddleware, TenantController.getAllActiveTenants);

/**
 * GET /api/tenants/:tenantId
 * Get tenant details (public info only)
 */
router.get("/:tenantId", TenantController.getTenantById as RequestHandler);

/**
 * PATCH /api/tenants/:tenantId
 * Update tenant settings
 * Requires authentication and admin permissions
 */
router.patch(
  "/:tenantId",
  authMiddleware,
  TenantController.updateTenantById as RequestHandler,
);

/**
 * DELETE /api/tenants/:tenantId
 * Suspend tenant
 * Requires authentication and admin permissions
 */
router.delete("/:tenantId", authMiddleware, TenantController.deleteTenantById);

export default router;
