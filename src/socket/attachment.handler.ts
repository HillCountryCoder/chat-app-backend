import { Server, Socket } from "socket.io";
import { createLogger, createSocketLogger } from "../common/logger";
import { z } from "zod";

const logger = createSocketLogger(createLogger("attachment-socket"));
const loggerWinston = createLogger("attachment-handler-logger");
const subscribeSchema = z.object({
  attachmentIds: z.array(z.string()).min(1).max(10),
});

export const registerAttachmentHandlers = (
  io: Server,
  socket: Socket,
  userId: string,
) => {
  socket.on("subscribe_attachment_updates", (data, callback) => {
    try {
      const { attachmentIds } = subscribeSchema.parse(data);

      // Join attachment-specific rooms for real-time updates
      attachmentIds.forEach((attachmentId: string) => {
        socket.join(`attachment:${attachmentId}`);
      });

      logger.event(socket.id, "subscribed_to_attachment_updates", {
        attachmentCount: attachmentIds.length,
      });

      if (typeof callback === "function") {
        callback({ success: true, subscribedTo: attachmentIds.length });
      }
    } catch (error) {
      if (error instanceof Error) {
        logger.error(socket.id, error);
        if (typeof callback === "function") {
          callback({
            success: false,
            error: error.message || "Failed to subscribe to attachment updates",
          });
        }
      }
    }
  });

  socket.on("unsubscribe_attachment_updates", (data, callback) => {
    try {
      const { attachmentIds } = subscribeSchema.parse(data);

      attachmentIds.forEach((attachmentId: string) => {
        socket.leave(`attachment:${attachmentId}`);
      });

      logger.event(socket.id, "unsubscribed_from_attachment_updates", {
        attachmentCount: attachmentIds.length,
      });

      if (typeof callback === "function") {
        callback({ success: true });
      }
    } catch (error) {
      if (error instanceof Error) {
        logger.error(socket.id, error);
        if (typeof callback === "function") {
          callback({ success: false, error: "Failed to unsubscribe" });
        }
      }
    }
  });
};

export const emitAttachmentStatusUpdate = (
  io: Server,
  attachmentId: string,
  uploadedBy: string,
  data: {
    status: string;
    errorDetails?: string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    metadata?: any;
    url: string;
    name: string;
    size: number;
  },
) => {
  const statusUpdate = {
    attachmentId,
    ...data,
  };

  // Emit to attachment-specific room
  io.to(`attachment:${attachmentId}`).emit(
    "attachment_status_update",
    statusUpdate,
  );

  // Also emit to user's room for general notifications
  io.to(`user:${uploadedBy}`).emit("attachment_processing_complete", {
    attachmentId,
    status: data.status,
    fileName: data.name,
  });

  loggerWinston.debug("Attachment status update emitted", {
    attachmentId,
    status: data.status,
    roomsNotified: [`attachment:${attachmentId}`, `user:${uploadedBy}`],
  });
};
