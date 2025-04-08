import { Router } from "express";
import { AuthController } from "../controllers";
import {
  loginSchemaForMiddleware,
  registerSchema,
} from "../services/validation/auth.validation";
import { authMiddleware, validateRequest } from "../common/middlewares";

const router = Router();

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

// protected routes
router.get("/me", authMiddleware, AuthController.getCurrentUser);

export default router;
