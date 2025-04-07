import { Router } from "express";
import authRoutes from "./auth.routes";
import directMessageRoutes from "./direct-message.routes";
import userRoutes from "./user.routes";

const router = Router();

router.use("/auth", authRoutes);
router.use("/direct-messages", directMessageRoutes);
router.use("/users", userRoutes);

export default router;
