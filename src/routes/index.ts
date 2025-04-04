import { Router } from "express";
import authRoutes from "./auth.routes";
import directMessageRoutes from "./direct-message.routes";

const router = Router();

router.use("/auth", authRoutes);
router.use("/direct-messages", directMessageRoutes);

export default router;
