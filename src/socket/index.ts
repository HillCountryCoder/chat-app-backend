import { Server } from "socket.io";
import { createLogger, createSocketLogger } from "../common/logger";
import { socketAuthMiddleware } from "./middleware/auth.middleware";
import { ErrorHandler } from "../common/errors";
import { registerDirectMessageHandlers } from "./direct-message.handler";
import { registerChannelHandlers } from "./channel.handler";
import { Server as HttpServer } from "http";
import { unreadMessagesService } from "../services/unread-messages.service";
import { env } from "../common/environment";
import { registerMessageReactionHandlers } from "./message-reaction.handler";
const logger = createLogger("socket-server");
const socketLogger = createSocketLogger(logger);
const errorHandler = new ErrorHandler(logger);

export const initializeSocketServer = (server: HttpServer) => {
  const io = new Server(server, {
    cors: {
      origin:
        env.CORS_ORIGIN === "*"
          ? [
              "http://localhost:3000",
              "https://chat-app-frontend-one-coral.vercel.app",
            ]
          : env.CORS_ORIGIN,
      credentials: true,
    },
    path: process.env.SOCKET_PATH || "/socket.io",
  });

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

      // Register handlers
      registerDirectMessageHandlers(io, socket, userId);
      registerChannelHandlers(io, socket, userId);
      registerMessageReactionHandlers(io, socket, userId);

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

      // Send initial unread counts after connection
      sendInitialUnreadCounts();

      // Handle disconnection
      socket.on("disconnect", (reason) => {
        socketLogger.disconnection(socket.id, reason);

        // Set offline status
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
