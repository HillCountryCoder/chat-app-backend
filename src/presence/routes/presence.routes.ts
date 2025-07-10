// src/routes/presence.routes.ts
import { Router } from "express";
import { PresenceController } from "../controllers/presence.controller";
import { authMiddleware } from "../../common/middlewares";

const router = Router();

// All routes require authentication
router.use(authMiddleware);

// Get current user's presence status
router.get("/me", PresenceController.getMyPresence);

// Update current user's status
router.put("/me/status", PresenceController.updateMyStatus);

// Get presence status of specific users
router.post("/bulk", PresenceController.getBulkPresence);

// Get online users (with pagination)
router.get("/online", PresenceController.getOnlineUsers);

// Get presence status of user's connections
router.get("/connections", PresenceController.getConnectionsPresence);

// Get user's presence history (for analytics)
router.get("/history", PresenceController.getPresenceHistory);

// Get presence analytics for current user
router.get("/analytics", PresenceController.getPresenceAnalytics);

// Connection management routes
router.post("/connections", PresenceController.addConnection);
router.delete(
  "/connections/:connectionId",
  PresenceController.removeConnection,
);

// Admin routes (require admin privileges)
router.get("/admin/stats", PresenceController.getPresenceStats);
router.post("/admin/cleanup", PresenceController.cleanupPresenceHistory);
router.get("/admin/active-sessions", PresenceController.getActiveSessions);

export default router;
