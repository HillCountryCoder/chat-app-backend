import { Server, Socket } from "socket.io";
import { createLogger, createSocketLogger } from "../../common/logger";
import { z } from "zod";
import { ErrorHandler, ValidationError } from "../../common/errors";
import { PresenceManager, PresenceStatus } from "../presence-manager";
import { PresenceHistoryService } from "../services";
import { PRESENCE_STATUS } from "../constants";
import { ServiceLocator } from "../../common/service-locator";

const logger = createSocketLogger(createLogger("presence-socket"));
const errorHandler = new ErrorHandler(createLogger("socket-error-handler"));
const changeStatusSchema = z.object({
  status: z.nativeEnum(PRESENCE_STATUS),
});

const getPresenceSchema = z.object({
  userIds: z.array(z.string()).max(100, "Maximum 100 users per request"),
});

const getOnlineUsersSchema = z.object({
  limit: z.number().min(1).max(100).optional(),
  cursor: z.string().optional(),
});

interface AuthenticatedSocket extends Socket {
  data: {
    user: {
      _id: string;
    };
  };
}

export const registerPresenceHandlers = (
  io: Server,
  socket: AuthenticatedSocket,
  userId: string,
) => {
  const serviceLocator = ServiceLocator.getInstance();

  // Get presence manager from service locator
  let presenceManager: PresenceManager;

  try {
    presenceManager = serviceLocator.getPresenceManager();
  } catch (error) {
    if (error) {
      logger.error(socket.id, new Error("PresenceManager not available"));
      return;
    }
  }

  let sessionId: string | null = null;
  let heartbeatInterval: NodeJS.Timeout | null = null;

  socket.on("authenticate_presence", async (data, callback) => {
    try {
      logger.event(socket.id, "authenticate_presence", { userId });

      const deviceInfo = {
        type: "web" as const,
        userAgent: socket.handshake.headers["user-agent"],
        socketId: socket.id,
      };

      await presenceManager.processHeartbeat(
        userId,
        PRESENCE_STATUS.ONLINE,
        deviceInfo,
      );

      sessionId = await PresenceHistoryService.recordSession(
        userId,
        PRESENCE_STATUS.ONLINE,
        deviceInfo,
      );

      heartbeatInterval = setInterval(async () => {
        try {
          await presenceManager.processHeartbeat(
            userId,
            PRESENCE_STATUS.ONLINE,
            deviceInfo,
          );
        } catch (error) {
          logger.error(socket.id, error as Error);
        }
      }, 30000);
      socket.join(`presence:${userId}`);
      if (typeof callback === "function") {
        callback({
          success: true,
          userId,
          heartbeatInterval: 30000,
        });
      }
      logger.event(socket.id, "presence_authenticated", { userId });
    } catch (error) {
      if (error instanceof Error) {
        logger.error(socket.id, error);

        if (typeof callback === "function") {
          errorHandler.handleSocketError(error, socket);
          callback({
            success: false,
            error: error.message || "Authentication failed",
          });
        }
      }
    }
  });

  socket.on("heartbeat", async (data, callback) => {
    try {
      logger.event(socket.id, "heartbeat", { status: data?.status });
      const deviceInfo = {
        type: "web" as const,
        userAgent: socket.handshake.headers["user-agent"],
        socketId: socket.id,
      };
      await presenceManager.processHeartbeat(
        userId,
        data?.status || PRESENCE_STATUS.ONLINE,
        deviceInfo,
      );

      // Send confirmation to client
      if (typeof callback === "function") {
        callback({
          success: true,
          timestamp: new Date().toISOString(),
          status: data?.status || PRESENCE_STATUS.ONLINE,
        });
      }
    } catch (error) {
      if (error instanceof Error) {
        logger.error(socket.id, error);
        if (typeof callback === "function") {
          errorHandler.handleSocketError(error, socket);
          callback({
            success: false,
            error: error.message || "Failed to process heartbeat",
          });
        }
      }
    }
  });

  socket.on("change_status", async (data, callback) => {
    try {
      logger.event(socket.id, "change_status", data);
      let validateData;
      try {
        validateData = changeStatusSchema.parse(data);
      } catch (error) {
        if (error instanceof z.ZodError) {
          throw new ValidationError(
            error.errors.map((e) => e.message).join(", "),
          );
        }
        throw error;
      }

      const deviceInfo = {
        type: "web" as const,
        userAgent: socket.handshake.headers["user-agent"],
        socketId: socket.id,
      };
      await presenceManager.processHeartbeat(
        userId,
        validateData.status,
        deviceInfo,
      );

      if (typeof callback === "function") {
        callback({
          success: true,
          status: validateData.status,
          timestamp: new Date().toISOString(),
        });
      }

      logger.event(socket.id, "status_changed", {
        userId,
        status: validateData.status,
      });
    } catch (error) {
      if (error instanceof Error) {
        logger.error(socket.id, error);

        if (typeof callback === "function") {
          errorHandler.handleSocketError(error, socket);
          callback({
            success: false,
            error: error.message || "Failed to change status",
          });
        }
      }
    }
  });
  socket.on("get_presence", async (data, callback) => {
    try {
      logger.event(socket.id, "get_presence", {
        userCount: data?.userIds?.length,
      });

      // Validate the data
      let validatedData;
      try {
        validatedData = getPresenceSchema.parse(data);
      } catch (error) {
        if (error instanceof z.ZodError) {
          throw new ValidationError(
            error.errors.map((e) => e.message).join(", "),
          );
        }
        throw error;
      }

      const presenceMap = await presenceManager.getBulkPresence(
        validatedData.userIds,
      );
      const result: Record<string, PresenceStatus> = {};

      presenceMap.forEach((presence, userId) => {
        result[userId] = presence;
      });

      if (typeof callback === "function") {
        callback({
          success: true,
          presence: result,
        });
      }
    } catch (error) {
      if (error instanceof Error) {
        logger.error(socket.id, error);

        if (typeof callback === "function") {
          errorHandler.handleSocketError(error, socket);
          callback({
            success: false,
            error: error.message || "Failed to get presence data",
          });
        }
      }
    }
  });

  // Handle online users query
  socket.on("get_online_users", async (data, callback) => {
    try {
      logger.event(socket.id, "get_online_users", data);

      // Validate the data
      let validatedData;
      try {
        validatedData = getOnlineUsersSchema.parse(data || {});
      } catch (error) {
        if (error instanceof z.ZodError) {
          throw new ValidationError(
            error.errors.map((e) => e.message).join(", "),
          );
        }
        throw error;
      }

      const limit = validatedData.limit || 20;
      const cursor = validatedData.cursor || "0";

      const result = await presenceManager.getOnlineUsers(limit, cursor);

      if (typeof callback === "function") {
        callback({
          success: true,
          ...result,
        });
      }
    } catch (error) {
      if (error instanceof Error) {
        logger.error(socket.id, error);

        if (typeof callback === "function") {
          errorHandler.handleSocketError(error, socket);
          callback({
            success: false,
            error: error.message || "Failed to get online users",
          });
        }
      }
    }
  });

  // Handle ping for connection testing
  socket.on("ping", (callback) => {
    if (typeof callback === "function") {
      callback({
        success: true,
        timestamp: new Date().toISOString(),
      });
    }
  });

  // Handle disconnect
  socket.on("disconnect", async (reason) => {
    try {
      logger.event(socket.id, "disconnect", { reason, userId });

      // Set user offline
      await presenceManager.setUserOffline(userId);

      // End session
      if (sessionId) {
        await PresenceHistoryService.endSession(sessionId);
      }

      // Clear heartbeat interval
      if (heartbeatInterval) {
        clearInterval(heartbeatInterval);
      }

      logger.event(socket.id, "presence_disconnected", { userId });
    } catch (error) {
      logger.error(socket.id, error as Error);
    }
  });
};

const serverLogger = createLogger("presence-broadcast");
export function setupPresenceBroadcasting(
  io: Server,
  presenceManager: PresenceManager,
) {
  // Listen for presence broadcasts from PresenceManager
  presenceManager.on("broadcastPresence", ({ connections, presenceUpdate }) => {
    connections.forEach((connectionUserId: string) => {
      io.to(`presence:${connectionUserId}`).emit(
        "presence_update",
        presenceUpdate,
      );
    });
  });

  // Listen for user online events
  presenceManager.on("userOnline", (data) => {
    serverLogger.info(`Broadcasting user online: ${data.userId}`);
    io.emit("user_online", data);
  });

  // Listen for user offline events
  presenceManager.on("userOffline", (data) => {
    serverLogger.info(`Broadcasting user offline: ${data.userId}`);
    io.emit("user_offline", data);
  });

  // Listen for status change events
  presenceManager.on("statusChanged", (data) => {
    serverLogger.info(
      `Broadcasting status change: ${data.userId} from ${data.oldStatus} to ${data.newStatus}`,
    );
    // Broadcast to interested parties
    io.emit("status_changed", data);
  });
}
