import { Server, Socket } from "socket.io";
import { createLogger, createSocketLogger } from "../common/logger";
import { z } from "zod";
import { attachmentRepository } from "../repositories";
import { runInTenantContext } from "../plugins/tenantPlugin";

const logger = createSocketLogger(createLogger("attachment-socket"));
const loggerWinston = createLogger("attachment-handler-logger");

const subscribeSchema = z.object({
  attachmentIds: z.array(z.string()).min(1).max(10),
  requestCurrentStatus: z.boolean().optional(),
});

export const registerAttachmentHandlers = (
  io: Server,
  socket: Socket,
  userId: string,
  tenantId: string,
) => {
  socket.on("subscribe_attachment_updates", async (data, callback) => {
    try {
      const { attachmentIds, requestCurrentStatus } =
        subscribeSchema.parse(data);

      // Join TENANT-SCOPED attachment-specific rooms for real-time updates
      attachmentIds.forEach((attachmentId: string) => {
        const attachmentRoom = `tenant:${tenantId}:attachment:${attachmentId}`;
        socket.join(attachmentRoom);
      });

      logger.event(socket.id, "subscribed_to_attachment_updates", {
        attachmentCount: attachmentIds.length,
        tenantId,
      });

      if (requestCurrentStatus) {
        try {
          // Fetch attachment statuses within tenant context
          const attachmentStatuses = await runInTenantContext(
            tenantId,
            async () => {
              return await Promise.all(
                attachmentIds.map(async (attachmentId) => {
                  try {
                    const attachment = await attachmentRepository.findById(
                      attachmentId,
                    );
                    return attachment
                      ? {
                          attachmentId,
                          status: attachment.status,
                          metadata: attachment.metadata,
                        }
                      : null;
                  } catch (error) {
                    loggerWinston.warn(
                      `Failed to get status for attachment ${attachmentId}:`,
                      error,
                    );
                    return null;
                  }
                }),
              );
            },
          );

          const validStatuses = attachmentStatuses.filter(Boolean);

          if (validStatuses.length > 0) {
            socket.emit("attachment_initial_status", {
              attachmentStatuses: validStatuses,
            });

            loggerWinston.debug("Sent initial attachment statuses", {
              socketId: socket.id,
              attachmentCount: validStatuses.length,
              tenantId,
            });
          }
        } catch (error) {
          loggerWinston.error(
            "Failed to fetch initial attachment statuses:",
            error,
          );
        }
      }

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

      // Leave TENANT-SCOPED attachment rooms
      attachmentIds.forEach((attachmentId: string) => {
        const attachmentRoom = `tenant:${tenantId}:attachment:${attachmentId}`;
        socket.leave(attachmentRoom);
      });

      logger.event(socket.id, "unsubscribed_from_attachment_updates", {
        attachmentCount: attachmentIds.length,
        tenantId,
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

/**
 * Emit attachment status update to TENANT-SCOPED rooms
 */
export const emitAttachmentStatusUpdate = (
  io: Server,
  tenantId: string,
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

  // Emit to TENANT-SCOPED attachment-specific room
  const attachmentRoom = `tenant:${tenantId}:attachment:${attachmentId}`;
  io.to(attachmentRoom).emit("attachment_status_update", statusUpdate);

  // Also emit to TENANT-SCOPED user's room for general notifications
  const userRoom = `tenant:${tenantId}:user:${uploadedBy}`;
  io.to(userRoom).emit("attachment_processing_complete", {
    attachmentId,
    status: data.status,
    fileName: data.name,
  });

  loggerWinston.debug("Attachment status update emitted", {
    attachmentId,
    status: data.status,
    tenantId,
    roomsNotified: [attachmentRoom, userRoom],
  });
};
