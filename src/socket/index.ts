import { Server } from "socket.io";
import { createLogger, createSocketLogger } from "../common/logger";
import { socketAuthMiddleware } from "./middleware/auth.middleware";
import { ErrorHandler } from "../common/errors";
import { registerDirectMessageHandlers } from "./direct-message.handler";
import { registerChannelHandlers } from "./channel.handler";
import { registerAttachmentHandlers } from "./attachment.handler"; // Phase 3
import { Server as HttpServer } from "http";
import { unreadMessagesService } from "../services/unread-messages.service";
import { env } from "process";
import { registerMessageReactionHandlers } from "./message-reaction.handler";

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
  });

  socketServerInstance = io;

  // Socket authentication middleware
  io.use(socketAuthMiddleware);

  io.on("connection", (socket) => {
    try {
      const userId = socket.data.user._id.toString();

      socketLogger.connection(socket.id, userId);

      // Add user to their own room for direct messages
      const userRoom = `user:${userId}`;
      socket.join(userRoom);

      // Set online status
      socket.broadcast.emit("user_status_changed", {
        userId,
        status: "online",
      });

      // Register all handlers
      registerDirectMessageHandlers(io, socket, userId);
      registerChannelHandlers(io, socket, userId);
      registerMessageReactionHandlers(io, socket, userId);
      registerAttachmentHandlers(io, socket, userId);

      // Send initial unread counts
      async function sendInitialUnreadCounts() {
        try {
          const unreadCounts = await unreadMessagesService.getAllUnreadCounts(
            userId,
          );
          socket.emit("unread_counts_update", unreadCounts);
        } catch (error) {
          logger.error("Error sending initial unread counts", { error });
        }
      }

      sendInitialUnreadCounts();

      // Handle disconnection
      socket.on("disconnect", (reason) => {
        socketLogger.disconnection(socket.id, reason);

        socket.broadcast.emit("user_status_changed", {
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
