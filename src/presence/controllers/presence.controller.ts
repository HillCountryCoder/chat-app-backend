import { Response } from "express";
import { AuthenticatedRequest } from "../../common/types";
import { createLogger } from "../../common/logger";
import { ErrorHandler, ValidationError } from "../../common/errors";
import { PresenceStatus } from "../presence-manager";
import { ConnectionService, PresenceHistoryService } from "../services";
import { CONNECTION_TYPE } from "../constants";
import { ServiceLocator } from "../../common/service-locator";

const logger = createLogger("presence-controller");
const errorHandler = new ErrorHandler(logger);
const statuses = ["online", "offline", "away", "busy"];
export class PresenceController {
  /**
   * Get current user's presence status
   */
  static async getMyPresence(req: AuthenticatedRequest, res: Response) {
    try {
      const userId = req.user?.id;
      const serviceLocator = ServiceLocator.getInstance();
      const presenceManager = serviceLocator.getPresenceManager();

      const presence = await presenceManager.getUserPresence(userId);
      if (!presence) {
        res.json({
          userId,
          status: "offline",
          lastSeen: null,
        });
      }
      res.json(presence);
    } catch (error) {
      if (error instanceof Error) {
        errorHandler.handleError(error, res);
      }
    }
  }
  /**
   * Update current user's status
   */
  static async updateMyStatus(req: AuthenticatedRequest, res: Response) {
    try {
      const userId = req.user?.id;
      const { status } = req.body;

      if (!statuses.includes(status)) {
        throw new ValidationError(
          "Invalid status. Must be online, away, or busy",
        );
      }
      const serviceLocator = ServiceLocator.getInstance();
      const presenceManager = serviceLocator.getPresenceManager();
      await presenceManager.processHeartbeat(userId, status);

      res.json({ success: true });
    } catch (error) {
      if (error instanceof Error) {
        errorHandler.handleError(error, res);
      }
    }
  }
  /**
   * Get presence status of specific users
   */

  static async getBulkPresence(req: AuthenticatedRequest, res: Response) {
    try {
      const { userIds } = req.body;
      if (!Array.isArray(userIds) || userIds.length === 0) {
        throw new ValidationError("userIds must be a non-empty array");
      }
      if (userIds.length > 100) {
        throw new ValidationError("Maximum 100 users per request");
      }

      const serviceLocator = ServiceLocator.getInstance();
      const presenceManager = serviceLocator.getPresenceManager();
      const presenceMap = await presenceManager.getBulkPresence(userIds);

      const result: Record<string, PresenceStatus> = {};
      presenceMap.forEach((presence, userId) => {
        result[userId] = presence;
      });
      res.json(result);
    } catch (error) {
      if (error instanceof Error) {
        errorHandler.handleError(error, res);
      }
    }
  }

  /**
   * Get online users (with pagination)
   */
  static async getOnlineUsers(req: AuthenticatedRequest, res: Response) {
    try {
      const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
      const cursor = req.query.cursor as string | undefined;

      const serviceLocator = ServiceLocator.getInstance();
      const presenceManager = serviceLocator.getPresenceManager();
      const onlineUsers = await presenceManager.getOnlineUsers(limit, cursor);

      res.json(onlineUsers);
    } catch (error) {
      if (error instanceof Error) {
        errorHandler.handleError(error, res);
      }
    }
  }
  /**
   * Get presence status of user's connections
   */

  static async getConnectionsPresence(
    req: AuthenticatedRequest,
    res: Response,
  ) {
    try {
      const userId = req.user?.id;
      const connectionType = req.query.type as string;
      const channelId = req.query.channelId as string;

      // Get user's connections
      let connectionIds: string[] = [];

      if (channelId) {
        connectionIds = await ConnectionService.getChannelConnections(
          channelId,
        );
      } else {
        connectionIds = await ConnectionService.getUserConnections(
          userId,
          connectionType as CONNECTION_TYPE,
        );
      }

      if (connectionIds.length === 0) {
        res.json({});
      }

      // Get presence for all connections
      const serviceLocator = ServiceLocator.getInstance();
      const presenceManager = serviceLocator.getPresenceManager();
      const presenceMap = await presenceManager.getBulkPresence(connectionIds);

      // Convert Map to object
      const result: Record<string, PresenceStatus> = {};
      presenceMap.forEach((presence, connectionId) => {
        result[connectionId] = presence;
      });

      res.json(result);
    } catch (error) {
      if (error instanceof Error) {
        errorHandler.handleError(error, res);
      }
    }
  }

  /**
   * Get user's presence history (for analytics)
   */
  static async getPresenceHistory(req: AuthenticatedRequest, res: Response) {
    try {
      const userId = req.user?.id;
      const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
      const skip = parseInt(req.query.skip as string) || 0;
      const startDate = req.query.startDate
        ? new Date(req.query.startDate as string)
        : undefined;
      const endDate = req.query.endDate
        ? new Date(req.query.endDate as string)
        : undefined;

      const { history, total } = await PresenceHistoryService.getUserHistory(
        userId,
        {
          limit,
          skip,
          startDate,
          endDate,
        },
      );

      res.json({
        history,
        pagination: {
          total,
          limit,
          skip,
          hasMore: skip + limit < total,
        },
      });
    } catch (error) {
      if (error instanceof Error) {
        errorHandler.handleError(error, res);
      }
    }
  }
  /**
   * Get presence analytics for current user
   */
  static async getPresenceAnalytics(req: AuthenticatedRequest, res: Response) {
    try {
      const userId = req.user?.id;
      const startDate = req.query.startDate
        ? new Date(req.query.startDate as string)
        : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000); // Default: 30 days ago
      const endDate = req.query.endDate
        ? new Date(req.query.endDate as string)
        : new Date(); // Default: now

      const analytics = await PresenceHistoryService.getPresenceAnalytics(
        userId,
        startDate,
        endDate,
      );

      res.json({
        ...analytics,
        period: {
          startDate: startDate.toISOString(),
          endDate: endDate.toISOString(),
        },
      });
    } catch (error) {
      if (error instanceof Error) {
        errorHandler.handleError(error, res);
      }
    }
  }
  /**
   * Add a connection
   */
  static async addConnection(req: AuthenticatedRequest, res: Response) {
    try {
      const userId = req.user?.id;
      const { connectionId, type, channelId, directMessageId } = req.body;

      if (!connectionId || !type) {
        throw new ValidationError("connectionId and type are required");
      }

      if (!["direct_message", "channel_member"].includes(type)) {
        throw new ValidationError("Invalid connection type");
      }

      const contextId = type === "direct_message" ? directMessageId : channelId;
      await ConnectionService.addConnection(
        userId,
        connectionId,
        type,
        contextId,
      );

      res.json({ success: true, message: "Connection added successfully" });
    } catch (error) {
      if (error instanceof Error) {
        errorHandler.handleError(error, res);
      }
    }
  }

  /**
   * Remove a connection
   */
  static async removeConnection(req: AuthenticatedRequest, res: Response) {
    try {
      const userId = req.user?.id;
      const { connectionId } = req.params;
      const { type, channelId, directMessageId } = req.query;
      const contextId =
        type === "direct_message"
          ? (directMessageId as string)
          : (channelId as string);
      await ConnectionService.removeConnection(
        userId,
        connectionId,
        type as CONNECTION_TYPE,
        contextId,
      );

      res.json({ success: true, message: "Connection removed successfully" });
    } catch (error) {
      if (error instanceof Error) {
        errorHandler.handleError(error, res);
      }
    }
  }
  /**
   * Get presence statistics (admin only)
   */
  static async getPresenceStats(req: AuthenticatedRequest, res: Response) {
    try {
      // TODO: Check if user is admin would have to add roles in the model
      //   if (!req.user.isAdmin) {
      //     return res.status(403).json({ error: "Admin access required" });
      //   }

      const serviceLocator = ServiceLocator.getInstance();
      const presenceManager = serviceLocator.getPresenceManager();
      const stats = await presenceManager.getPresenceStats();

      res.json(stats);
    } catch (error) {
      if (error instanceof Error) {
        errorHandler.handleError(error, res);
      }
    }
  }
  /**
   * Cleanup old presence history (admin only)
   */
  static async cleanupPresenceHistory(
    req: AuthenticatedRequest,
    res: Response,
  ) {
    try {
      // Check if user is admin
      //   if (!req.user.isAdmin) {
      //     return res.status(403).json({ error: "Admin access required" });
      //   }

      const { daysToKeep = 90 } = req.body;
      const deletedCount = await PresenceHistoryService.cleanupOldHistory(
        daysToKeep,
      );

      res.json({
        success: true,
        deletedCount,
        message: `Cleaned up ${deletedCount} old presence records`,
      });
    } catch (error) {
      if (error instanceof Error) {
        errorHandler.handleError(error, res);
      }
    }
  }

  /**
   * Get active sessions (admin only)
   */
  static async getActiveSessions(req: AuthenticatedRequest, res: Response) {
    try {
      // Check if user is admin
      //   if (!req.user.isAdmin) {
      //     return res.status(403).json({ error: "Admin access required" });
      //   }

      const activeSessions = await PresenceHistoryService.getActiveSessions();

      res.json({
        activeSessions,
        count: activeSessions.length,
      });
    } catch (error) {
      if (error instanceof Error) {
        errorHandler.handleError(error, res);
      }
    }
  }
}
