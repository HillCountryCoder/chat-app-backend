import { Server } from "socket.io";
import { createLogger, createSocketLogger } from "../common/logger";
import { socketAuthMiddleware } from "./middleware/auth.middleware";
import { ErrorHandler } from "../common/errors";
import { registerDirectMessageHandlers } from "./direct-message.handler";
import { registerChannelHandlers } from "./channel.handler";
import { registerAttachmentHandlers } from "./attachment.handler";
import { Server as HttpServer } from "http";
import { unreadMessagesService } from "../services/unread-messages.service";
import { env } from "process";
import { registerMessageReactionHandlers } from "./message-reaction.handler";
import {
  registerPresenceHandlers,
  setupPresenceBroadcasting,
} from "../presence/socket/presence.handler";
import { ServiceLocator } from "../common/service-locator";
import { runInTenantContext } from "../plugins/tenantPlugin";

const logger = createLogger("socket-server");
const socketLogger = createSocketLogger(logger);
const errorHandler = new ErrorHandler(logger);

let socketServerInstance: Server;

export const initializeSocketServer = (server: HttpServer) => {
  const io = new Server(server, {
    cors: {
      origin: env.CORS_ORIGIN
        ? env.CORS_ORIGIN.split(",").map((origin) => origin.trim())
        : "*",
      credentials: true,
    },
    path: process.env.SOCKET_PATH || "/socket.io",
    allowRequest: (req, callback) => {
      const origin = req.headers.origin;
      const allowedOrigins = [
        "https://chat-app-frontend-one-coral.vercel.app",
        "http://localhost:3000",
        "https://www.whatnextplease.com",
        "https://staging.whatnextplease.com",
      ];
      if (!origin) {
        return callback(null, true);
      }
      if (allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback("Not allowed by CORS", false);
      }
    },
  });

  logger.info("Initializing Socket.IO server with tenant isolation...");

  socketServerInstance = io;

  // Socket authentication middleware (runs after tenant middleware)
  io.use(socketAuthMiddleware);

  logger.info("Socket.IO server initialized with tenant isolation ✅");

  // Setup presence broadcasting
  const serviceLocator = ServiceLocator.getInstance();
  try {
    const presenceManager = serviceLocator.getPresenceManager();
    setupPresenceBroadcasting(io, presenceManager);
    logger.info("Presence broadcasting setup completed");
  } catch (error) {
    if (error instanceof Error) {
      logger.warn(
        "PresenceManager not available - presence features will be disabled",
      );
    }
  }

  // Main connection handler with TENANT-AWARE logic
  io.on("connection", (socket) => {
    try {
      // Extract userId from auth middleware
      const userId = socket.data.user._id.toString();

      // Extract tenantId from tenant middleware
      const tenantId = socket.data.tenantId;

      if (!tenantId) {
        throw new Error("Tenant ID not found in socket data");
      }

      socketLogger.connection(socket.id, userId, tenantId);

      // Join TENANT-SCOPED user room for direct messages
      const userRoom = `tenant:${tenantId}:user:${userId}`;
      socket.join(userRoom);

      // Broadcast online status to TENANT-SCOPED room
      socket.to(`tenant:${tenantId}`).emit("user_status_changed", {
        userId,
        status: "online",
      });

      // Register all handlers with tenantId
      registerDirectMessageHandlers(io, socket, userId, tenantId);
      registerChannelHandlers(io, socket, userId, tenantId);
      registerMessageReactionHandlers(io, socket, userId, tenantId);
      registerAttachmentHandlers(io, socket, userId, tenantId);
      registerPresenceHandlers(io, socket, userId);

      // Send initial unread counts (within tenant context)
      async function sendInitialUnreadCounts() {
        try {
          await runInTenantContext(tenantId, async () => {
            const unreadCounts = await unreadMessagesService.getAllUnreadCounts(
              userId,
            );
            socket.emit("unread_counts_update", unreadCounts);
          });
        } catch (error) {
          logger.error("Error sending initial unread counts", {
            error,
            userId,
            tenantId,
          });
        }
      }

      sendInitialUnreadCounts();

      // Handle disconnection
      socket.on("disconnect", (reason) => {
        socketLogger.disconnection(socket.id, reason);

        // Broadcast offline status to TENANT-SCOPED room
        socket.to(`tenant:${tenantId}`).emit("user_status_changed", {
          userId,
          status: "offline",
        });
      });
    } catch (error) {
      if (error instanceof Error) {
        socketLogger.error(socket.id, error);
        errorHandler.handleSocketError(error, socket);
        socket.disconnect(true);
      }
    }
  });

  logger.info("Socket.IO server initialized");
  return io;
};

export const getSocketServer = (): Server | null => {
  return socketServerInstance || null;
};
