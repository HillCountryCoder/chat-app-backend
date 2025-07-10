import { Router } from "express";
import authRoutes from "./auth.routes";
import directMessageRoutes from "./direct-message.routes";
import userRoutes from "./user.routes";
import channelRoutes from "./channel.routes";
import messageReactionRoutes from "./message-reaction.routes";
import attachmentRoutes from "./attachment.routes";
import presenceRoutes from "../presence/routes/presence.routes";
const router = Router();

router.use("/auth", authRoutes);
router.use("/direct-messages", directMessageRoutes);
router.use("/users", userRoutes);
router.use("/channels", channelRoutes);
router.use("/messages", messageReactionRoutes);
router.use('/attachments', attachmentRoutes);
router.use("/presence", presenceRoutes);
export default router;
