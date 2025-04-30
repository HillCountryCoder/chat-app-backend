import { Router } from "express";
import authRoutes from "./auth.routes";
import directMessageRoutes from "./direct-message.routes";
import userRoutes from "./user.routes";
import channelRoutes from "./channel.routes";
import messageReactionRoutes from "./message-reaction.routes";
const router = Router();

router.use("/auth", authRoutes);
router.use("/direct-messages", directMessageRoutes);
router.use("/users", userRoutes);
router.use("/channels", channelRoutes);
router.use("/messages", messageReactionRoutes);
export default router;
