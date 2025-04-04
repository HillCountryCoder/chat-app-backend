import { Server, Socket } from "socket.io";
import { createLogger, createSocketLogger } from "../common/logger";
import { directMessageService } from "../services/direct-message.service";
import { ErrorHandler } from "../common/errors";
import { ValidationError } from "../common/errors";
import { z } from "zod";
import mongoose from "mongoose";

const logger = createSocketLogger(createLogger("direct-message-socket"));
const errorHandler = new ErrorHandler(createLogger("socket-error-handler"));

const sendMessageSchema = z
  .object({
    content: z.string().min(1).max(2000),
    receiverId: z.string().optional(),
    directMessageId: z.string().optional(),
  })
  .refine((data) => data.receiverId || data.directMessageId, {
    message: "Either receiverId or directMessageId must be provided",
  });

export const registerDirectMessageHandlers = (
  io: Server,
  socket: Socket,
  userId: string,
) => {
  // When a user sends a new direct message
  socket.on("send_direct_message", async (data, callback) => {
    try {
      logger.event(socket.id, "send_direct_message", data);

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
};
