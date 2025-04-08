import { Router } from "express";
import { ChannelController } from "../controllers/channel.controller";
import { authMiddleware } from "../common/middlewares/auth.middleware";

const router = Router();

// All routes require authentication
router.use(authMiddleware);

// Channel routes
router.post("/", ChannelController.createChannel);
router.get("/", ChannelController.getChannels);
router.get("/:id", ChannelController.getChannelById);
router.get("/:id/members", ChannelController.getChannelMembers);
router.post("/:id/members", ChannelController.addMember);
router.delete("/:id/members/:userId", ChannelController.removeMember);
router.get("/:id/messages", ChannelController.getMessages);
router.post("/:id/messages", ChannelController.sendMessage);

export default router;
