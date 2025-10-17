import { Server, Socket } from "socket.io";
import { createLogger, createSocketLogger } from "../common/logger";
import { directMessageService } from "../services/direct-message.service";
import { ErrorHandler } from "../common/errors";
import { ValidationError } from "../common/errors";
import { z } from "zod";
import mongoose from "mongoose";
import { MAX_ATTACHMENTS_PER_MESSAGE } from "../constants";
import { ContentType } from "../models";
import { runInTenantContext } from "../plugins/tenantPlugin";

const logger = createSocketLogger(createLogger("direct-message-socket"));
const errorHandler = new ErrorHandler(createLogger("socket-error-handler"));

// Define the PlateValue schema using Zod
const plateValueSchema = z.array(
  z
    .object({
      id: z.string().optional(),
      type: z.string(),
      children: z.array(
        z
          .object({
            text: z.string(),
          })
          .catchall(z.any()),
      ),
    })
    .catchall(z.any()),
);

const sendMessageSchema = z
  .object({
    content: z.string().min(1).max(2000),
    richContent: plateValueSchema.optional(),
    contentType: z.nativeEnum(ContentType).optional(),
    receiverId: z.string().optional(),
    directMessageId: z.string().optional(),
    attachmentIds: z
      .array(z.string())
      .max(MAX_ATTACHMENTS_PER_MESSAGE)
      .optional(),
    replyToId: z.string().optional(),
  })
  .refine((data) => data.receiverId || data.directMessageId, {
    message: "Either receiverId or directMessageId must be provided",
  })
  .refine(
    (data) => {
      if (
        data.richContent &&
        data.contentType &&
        data.contentType !== ContentType.RICH
      ) {
        return false;
      }
      return true;
    },
    {
      message: "Content type must be 'rich' when rich content is provided",
      path: ["contentType"],
    },
  )
  .refine(
    (data) => {
      if (data.contentType === ContentType.RICH && !data.richContent) {
        return false;
      }
      return true;
    },
    {
      message: "Rich content must be provided when content type is 'rich'",
      path: ["richContent"],
    },
  );

export const registerDirectMessageHandlers = (
  io: Server,
  socket: Socket,
  userId: string,
  tenantId: string,
) => {
  // When a user sends a new direct message
  socket.on("send_direct_message", async (data, callback) => {
    try {
      logger.event(socket.id, "send_direct_message", {
        ...data,
        attachmentCount: data.attachmentIds?.length || 0,
        tenantId,
      });

      // Validate the data
      let validatedData;
      try {
        validatedData = sendMessageSchema.parse(data);
      } catch (error) {
        if (error instanceof z.ZodError) {
          throw new ValidationError(
            error.errors.map((e) => e.message).join(", "),
          );
        }
        throw error;
      }

      // Process the message within tenant context
      const result = await runInTenantContext(tenantId, async () => {
        return await directMessageService.sendMessage({
          senderId: userId,
          receiverId: validatedData.receiverId,
          directMessageId: validatedData.directMessageId,
          content: validatedData.content,
          richContent: validatedData.richContent,
          contentType: validatedData.contentType,
          attachmentIds: validatedData.attachmentIds || [],
          replyToId: validatedData.replyToId,
        });
      });

      // Find the recipient (the other user in the conversation)
      const recipientId = result.directMessage.participantIds.find(
        (id: mongoose.Types.ObjectId | string) => {
          const idStr =
            id instanceof mongoose.Types.ObjectId ? id.toString() : id;
          return idStr !== userId;
        },
      );
      const senderRoom = `tenant:${tenantId}:user:${userId}`;
      io.to(senderRoom).emit("new_direct_message", {
        message: result.message,
        directMessage: result.directMessage,
      });

      if (recipientId) {
        const recipientIdStr =
          recipientId instanceof mongoose.Types.ObjectId
            ? recipientId.toString()
            : recipientId;

        const recipientRoom = `tenant:${tenantId}:user:${recipientIdStr}`;
        io.to(recipientRoom).emit("new_direct_message", {
          message: result.message,
          directMessage: result.directMessage,
        });

        // Get unread counts for recipient
        await runInTenantContext(tenantId, async () => {
          const unreadCounts = await directMessageService.getUnreadCounts(
            recipientIdStr,
          );
          io.to(recipientRoom).emit("unread_counts_update", unreadCounts);
        });
      }
      const dmRoom = `tenant:${tenantId}:direct_message:${result.directMessage._id}`;
      io.to(dmRoom).emit("new_direct_message", {
        message: result.message,
        directMessage: result.directMessage,
      });

      // Send confirmation to sender
      if (typeof callback === "function") {
        callback({
          success: true,
          message: result.message,
          directMessage: result.directMessage,
        });
      }
    } catch (error) {
      if (error instanceof Error) {
        logger.error(socket.id, error);

        if (typeof callback === "function") {
          errorHandler.handleSocketError(error, socket);
          callback({
            success: false,
            error: error.message || "Failed to send message",
          });
        }
      }
    }
  });

  socket.on("mark_dm_read", async (data, callback) => {
    try {
      const { directMessageId } = data;

      // Mark messages as read (within tenant context)
      await runInTenantContext(tenantId, async () => {
        await directMessageService.markMessagesAsRead(directMessageId, userId);
      });

      // Get updated unread counts (within tenant context)
      const unreadCounts = await runInTenantContext(tenantId, async () => {
        return await directMessageService.getUnreadCounts(userId);
      });

      // Send back to the client
      socket.emit("unread_counts_update", unreadCounts);

      if (typeof callback === "function") {
        callback({ success: true });
      }
    } catch (error) {
      if (error instanceof Error) {
        logger.error(socket.id, error);

        if (typeof callback === "function") {
          errorHandler.handleSocketError(error, socket);
          callback({
            success: false,
            error: error.message || "Failed to mark messages as read",
          });
        }
      }
    }
  });

  socket.on("join_direct_message", (data, callback) => {
    try {
      logger.event(socket.id, "join_direct_message", { ...data, tenantId });
      const { directMessageId } = data;

      // Join TENANT-SCOPED direct message room
      const dmRoom = `tenant:${tenantId}:direct_message:${directMessageId}`;
      socket.join(dmRoom);

      if (typeof callback === "function") {
        callback({ success: true });
      }
    } catch (error) {
      if (error instanceof Error) {
        logger.error(socket.id, error);
        if (typeof callback === "function") {
          callback({ success: false, error: "Failed to join room" });
        }
      }
    }
  });

  socket.on("leave_direct_message", (data) => {
    logger.event(socket.id, "leave_direct_message", { ...data, tenantId });
    const { directMessageId } = data;

    // Leave TENANT-SCOPED direct message room
    const dmRoom = `tenant:${tenantId}:direct_message:${directMessageId}`;
    socket.leave(dmRoom);
  });

  socket.on("subscribe_attachment_updates", (data, callback) => {
    try {
      const { attachmentIds } = data;
      if (!Array.isArray(attachmentIds)) {
        throw new ValidationError("attachmentIds must be an array");
      }

      // Join TENANT-SCOPED attachment-specific rooms for real-time updates
      attachmentIds.forEach((attachmentId: string) => {
        const attachmentRoom = `tenant:${tenantId}:attachment:${attachmentId}`;
        socket.join(attachmentRoom);
      });

      logger.event(socket.id, "subscribed_to_attachment_updates", {
        attachmentCount: attachmentIds.length,
        tenantId,
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

  socket.on("edit_direct_message", async (data, callback) => {
    try {
      logger.event(socket.id, "edit_direct_message", { ...data, tenantId });
      const { directMessageId, messageId, content, richContent, contentType } =
        data;

      if (!directMessageId || !messageId || !content) {
        throw new ValidationError(
          "directMessageId, messageId, and content are required",
        );
      }

      // Edit message (within tenant context)
      const result = await runInTenantContext(tenantId, async () => {
        return await directMessageService.editMessage({
          directMessageId,
          messageId,
          userId,
          content,
          richContent,
          contentType,
        });
      });

      // Emit to the TENANT-SCOPED direct message room
      const dmRoom = `tenant:${tenantId}:direct_message:${directMessageId}`;
      io.to(dmRoom).emit("message_updated", {
        message: result.message,
        directMessageId,
      });

      // Send confirmation to sender
      if (typeof callback === "function") {
        callback({
          success: true,
          message: result.message,
        });
      }
    } catch (error) {
      if (error instanceof Error) {
        logger.error(socket.id, error);

        if (typeof callback === "function") {
          errorHandler.handleSocketError(error, socket);
          callback({
            success: false,
            error: error.message || "Failed to edit message",
          });
        }
      }
    }
  });
};
