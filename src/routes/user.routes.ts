import { Router } from "express";
import { UserController } from "../controllers/user.controller";
import { authMiddleware } from "../common/middlewares/auth.middleware";

const router = Router();

// All routes require authentication
router.use(authMiddleware);

// Get all users
router.get("/", UserController.getAllUsers);

// Get user by ID
router.get("/:id", UserController.getUserById);

export default router;
