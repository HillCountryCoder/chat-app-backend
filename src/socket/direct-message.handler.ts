import { Server, Socket } from "socket.io";
import { createLogger, createSocketLogger } from "../common/logger";
import { directMessageService } from "../services/direct-message.service";
import { ErrorHandler } from "../common/errors";
import { ValidationError } from "../common/errors";
import { z } from "zod";
import mongoose from "mongoose";
import { MAX_ATTACHMENTS_PER_MESSAGE } from "../constants";
import { ContentType } from "../models";

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
    richContent: plateValueSchema.optional(), // Use the schema directly
    contentType: z.nativeEnum(ContentType).optional(), // Add this
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
) => {
  // When a user sends a new direct message
  socket.on("send_direct_message", async (data, callback) => {
    try {
      logger.event(socket.id, "send_direct_message", {
        ...data,
        attachmentCount: data.attachmentIds?.length || 0,
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

      // Process the message
      const result = await directMessageService.sendMessage({
        senderId: userId,
        receiverId: validatedData.receiverId,
        directMessageId: validatedData.directMessageId,
        content: validatedData.content,
        richContent: validatedData.richContent, // Add this
        contentType: validatedData.contentType, // Add this
        attachmentIds: validatedData.attachmentIds || [],
        replyToId: validatedData.replyToId,
      });

      // Find the recipient (the other user in the conversation)
      const recipientId = result.directMessage.participantIds.find(
        (id: mongoose.Types.ObjectId | string) => {
          const idStr =
            id instanceof mongoose.Types.ObjectId ? id.toString() : id;
          return idStr !== userId;
        },
      );

      if (recipientId) {
        // Convert to string if it's an ObjectId
        const recipientIdStr =
          recipientId instanceof mongoose.Types.ObjectId
            ? recipientId.toString()
            : recipientId;

        // Emit to the recipient's room
        const recipientRoom = `user:${recipientIdStr}`;
        io.to(recipientRoom).emit("new_direct_message", {
          message: result.message,
          directMessage: result.directMessage,
        });

        // Get unread counts for the recipient
        const unreadCounts = await directMessageService.getUnreadCounts(
          recipientIdStr,
        );

        // Emit the unread counts to the recipient
        io.to(`user:${recipientIdStr}`).emit(
          "unread_counts_update",
          unreadCounts,
        );
      }

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

      // Mark messages as read
      await directMessageService.markMessagesAsRead(directMessageId, userId);

      // Get updated unread counts
      const unreadCounts = await directMessageService.getUnreadCounts(userId);

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
      logger.event(socket.id, "join_direct_message", data);
      const { directMessageId } = data;
      socket.join(`direct_message:${directMessageId}`);

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
    logger.event(socket.id, "leave_direct_message", data);
    const { directMessageId } = data;
    socket.leave(`direct_message:${directMessageId}`);
  });

  socket.on("subscribe_attachment_updates", (data, callback) => {
    try {
      const { attachmentIds } = data;
      if (!Array.isArray(attachmentIds)) {
        throw new ValidationError("attachmentIds must be an array");
      }
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

  socket.on("edit_direct_message", async (data, callback) => {
    try {
      logger.event(socket.id, "edit_direct_message", data);
      const { directMessageId, messageId, content, richContent, contentType } =
        data;

      if (!directMessageId || !messageId || !content) {
        throw new ValidationError(
          "directMessageId, messageId, and content are required",
        );
      }
      const result = await directMessageService.editMessage({
        directMessageId,
        messageId,
        userId,
        content,
        richContent,
        contentType,
      });

      // Emit to the direct message room
      io.to(`direct_message:${directMessageId}`).emit("message_updated", {
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
