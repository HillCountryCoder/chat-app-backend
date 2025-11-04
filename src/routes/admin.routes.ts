import { Router } from "express";
import { AdminController } from "../controllers/admin.controller";

const router = Router();

// TODO: Add super admin middleware to protect these routes
// import { superAdminMiddleware } from "../common/middlewares";
// router.use(superAdminMiddleware);

// Generate credentials for new tenant
router.post(
  "/tenants/generate-credentials",
  AdminController.generateTenantCredentials,
);

// List all tenants
router.get("/tenants", AdminController.listAllTenants);

// Activate tenant
router.post("/tenants/:tenantId/activate", AdminController.activateTenant);

export default router;
