import { Server, Socket } from "socket.io";
import { createLogger, createSocketLogger } from "../common/logger";
import { messageReactionService } from "../services/message-reaction.service";
import { ErrorHandler } from "../common/errors";
import { ValidationError } from "../common/errors";
import { z } from "zod";
import { messageService } from "../services/message.service";

const logger = createSocketLogger(createLogger("message-reaction-socket"));
const errorHandler = new ErrorHandler(createLogger("socket-error-handler"));
const reactionSchema = z.object({
  messageId: z.string(),
  emoji: z.string().min(1).max(10),
});

export const registerMessageReactionHandlers = (
  io: Server,
  socket: Socket,
  userId: string,
) => {
  socket.on("add_reaction", async (data, callback) => {
    try {
      logger.event(socket.id, "add_reaction", data);
      let validatedReaction;
      try {
        validatedReaction = reactionSchema.parse(data);
      } catch (error) {
        if (error instanceof z.ZodError) {
          throw new ValidationError(
            error.errors.map((e) => e.message).join(", "),
          );
        }
        throw error;
      }
      // Process the reaction
      const { messageId, emoji } = validatedReaction;
      const message = await messageReactionService.addReaction(
        messageId,
        userId,
        emoji,
      );

      // Find the message to determine which room to emit to
      const fullMessage = await messageService.getMessageByIdOrThrowError(
        messageId,
      );
      if (fullMessage) {
        // Determine the room based on message type (direct message or channel)
        if (fullMessage.directMessageId) {
          const directMessageRoom = `direct_message:${fullMessage.directMessageId}`;
          io.to(directMessageRoom).emit("message_reaction_updated", {
            messageId,
            reactions: message.reactions,
          });
        } else if (fullMessage.channelId) {
          const channelRoom = `channel:${fullMessage.channelId}`;
          io.to(channelRoom).emit("message_reaction_updated", {
            messageId,
            reactions: message.reactions,
          });
        }
      }
      // Send confirmation to sender
      if (typeof callback === "function") {
        callback({
          success: true,
          reactions: message.reactions,
        });
      }
    } catch (error) {
      if (error instanceof Error) {
        logger.error(socket.id, error);

        if (typeof callback === "function") {
          errorHandler.handleSocketError(error, socket);
          callback({
            success: false,
            error: error.message || "Failed to add reaction",
          });
        }
      }
    }
  });
  socket.on("remove_reaction", async (data, callback) => {
    try {
      logger.event(socket.id, "remove_reaction", data);

      // Validate the data
      let validatedData;
      try {
        validatedData = reactionSchema.parse(data);
      } catch (error) {
        if (error instanceof z.ZodError) {
          throw new ValidationError(
            error.errors.map((e) => e.message).join(", "),
          );
        }
        throw error;
      }

      // Process the reaction removal
      const { messageId, emoji } = validatedData;
      const message = await messageReactionService.removeReaction(
        messageId,
        userId,
        emoji,
      );

      // Find the message to determine which room to emit to
      const fullMessage = await messageService.getMessageByIdOrThrowError(messageId);

      if (fullMessage) {
        // Determine the room based on message type (direct message or channel)
        if (fullMessage.directMessageId) {
          const directMessageRoom = `direct_message:${fullMessage.directMessageId}`;
          io.to(directMessageRoom).emit("message_reaction_updated", {
            messageId,
            reactions: message.reactions,
          });
        } else if (fullMessage.channelId) {
          const channelRoom = `channel:${fullMessage.channelId}`;
          io.to(channelRoom).emit("message_reaction_updated", {
            messageId,
            reactions: message.reactions,
          });
        }
      }

      // Send confirmation to sender
      if (typeof callback === "function") {
        callback({
          success: true,
          reactions: message.reactions,
        });
      }
    } catch (error) {
      if (error instanceof Error) {
        logger.error(socket.id, error);

        if (typeof callback === "function") {
          errorHandler.handleSocketError(error, socket);
          callback({
            success: false,
            error: error.message || "Failed to remove reaction",
          });
        }
      }
    }
  });
};
