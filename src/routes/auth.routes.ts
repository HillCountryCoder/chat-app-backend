import { Router } from "express";
import { AuthController } from "../controllers";
import {
  loginSchema,
  registerSchema,
} from "../services/validation/auth.validation";
import { authMiddleware, validateRequest } from "../common/middlewares";

const router = Router();

router.post(
  "/register",
  validateRequest(registerSchema),
  AuthController.registerUser,
);

router.post("/login", validateRequest(loginSchema), AuthController.login);

// protected routes
router.get("/me", authMiddleware, AuthController.getCurrentUser);

export default router;
