import { Router } from "express";
import authRoutes from "./auth.routes";
import directMessageRoutes from "./direct-message.routes";
import userRoutes from "./user.routes";
import channelRoutes from "./channel.routes";

const router = Router();

router.use("/auth", authRoutes);
router.use("/direct-messages", directMessageRoutes);
router.use("/users", userRoutes);
router.use("/channels", channelRoutes);

export default router;
