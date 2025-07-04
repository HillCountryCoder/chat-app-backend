import { Router } from "express";
import { AuthController } from "../controllers";
import {
  loginSchemaForMiddleware,
  registerSchema,
  refreshTokenSchema,
} from "../services/validation/auth.validation";
import { authMiddleware, validateRequest } from "../common/middlewares";

const router = Router();

// Public routes
router.post(
  "/register",
  validateRequest(registerSchema),
  AuthController.registerUser,
);

router.post(
  "/login",
  validateRequest(loginSchemaForMiddleware),
  AuthController.login,
);

router.post(
  "/refresh",
  validateRequest(refreshTokenSchema),
  AuthController.refreshToken,
);

// Protected routes
router.get("/me", authMiddleware, AuthController.getCurrentUser);
router.post("/logout", authMiddleware, AuthController.logout);
router.post("/logout-all", authMiddleware, AuthController.logoutAll);
router.get("/sessions", authMiddleware, AuthController.getActiveSessions);
router.post(
  "/cleanup-sessions",
  authMiddleware,
  AuthController.cleanupSessions,
);

router.post("/cleanup-all-sessions", AuthController.cleanupAllSessions);
export default router;
