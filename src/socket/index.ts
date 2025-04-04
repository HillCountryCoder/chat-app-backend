// src/socket/index.ts
import { Server } from "socket.io";
import { createLogger, createSocketLogger } from "../common/logger";
import { socketAuthMiddleware } from "./middleware/auth.middleware";
import { ErrorHandler } from "../common/errors";
import { registerDirectMessageHandlers } from "./direct-message.handler";
import { Server as HttpServer } from "http";

const logger = createLogger("socket-server");
const socketLogger = createSocketLogger(logger);
const errorHandler = new ErrorHandler(logger);


export const initializeSocketServer = (server: HttpServer) => {
  const io = new Server(server, {
    cors: {
      origin: process.env.CORS_ORIGIN || "*",
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
