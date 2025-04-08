// src/routes/channel.routes.ts
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

// Thread routes
router.post("/:id/threads", ChannelController.createThread);
router.get("/:id/threads", ChannelController.getThreads);
router.get("/:id/threads/:threadId", ChannelController.getThreadById);
router.get(
  "/:id/threads/:threadId/messages",
  ChannelController.getThreadMessages,
);
router.post(
  "/:id/threads/:threadId/messages",
  ChannelController.sendThreadMessage,
);

export default router;
