// src/routes/direct-message.routes.ts
import { Router } from "express";
import { DirectMessageController } from "../controllers/direct-message.controller";
import { authMiddleware } from "../common/middlewares/auth.middleware";

const router = Router();

// All routes require authentication
router.use(authMiddleware);

// Get all direct messages for the current user
router.get("/", DirectMessageController.getDirectMessages);

// Get unread counts - This needs to come BEFORE the :id route to avoid conflicts
router.get("/unread-counts", DirectMessageController.getUnreadCounts);

// Get a specific direct message
router.get("/:id", DirectMessageController.getDirectMessageById);

// Get messages in a direct message conversation
router.get("/:id/messages", DirectMessageController.getMessages);

// Mark messages as read
router.post("/:id/read", DirectMessageController.markAsRead);

router.get(
  "/:id/stats/rich-content",
  DirectMessageController.getRichContentStats,
);

router.put("/:id/messages/:messageId", DirectMessageController.editMessage);
// Send a new message
router.post("/messages", DirectMessageController.sendMessage);

export default router;
