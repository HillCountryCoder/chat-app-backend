import { Server, Socket } from "socket.io";
import { createLogger, createSocketLogger } from "../common/logger";
import { channelService } from "../services/channel.service";
import { ErrorHandler } from "../common/errors";
import { ValidationError } from "../common/errors";
import { z } from "zod";

const logger = createSocketLogger(createLogger("channel-socket"));
const errorHandler = new ErrorHandler(createLogger("socket-error-handler"));

const sendMessageSchema = z.object({
  content: z.string().min(1).max(2000),
  channelId: z.string(),
});

export const registerChannelHandlers = (
  io: Server,
  socket: Socket,
  userId: string,
) => {
  // Function to join all channels the user is a member of
  const joinUserChannels = async () => {
    try {
      const channels = await channelService.getAllChannels(userId);
      channels.forEach((channel) => {
        const channelRoom = `channel:${channel._id}`;
        socket.join(channelRoom);
        logger.event(socket.id, "joined_channel_room", {
          channelId: channel._id,
        });
      });
    } catch (error) {
      logger.error(
        socket.id,
        error instanceof Error ? error : new Error("Unknown error"),
      );
    }
  };

  // Call this immediately when socket connects
  joinUserChannels();

  // When user sends a message to channel
  socket.on("send_channel_message", async (data, callback) => {
    try {
      logger.event(socket.id, "send_channel_message", data);

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
      const result = await channelService.sendMessage({
        senderId: userId,
        channelId: validatedData.channelId,
        content: validatedData.content,
      });

      // Emit to the channel room
      const channelRoom = `channel:${validatedData.channelId}`;
      io.to(channelRoom).emit("new_channel_message", {
        message: result.message,
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
            error: error.message || "Failed to send message",
          });
        }
      }
    }
  });

  // Handle user joining a channel
  socket.on("join_channel", async (data, callback) => {
    try {
      const { channelId } = data;

      // Verify user has access to this channel
      await channelService.getChannelById(channelId, userId);

      // Join the channel room
      const channelRoom = `channel:${channelId}`;
      socket.join(channelRoom);

      logger.event(socket.id, "joined_channel", { channelId });

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
            error: error.message || "Failed to join channel",
          });
        }
      }
    }
  });

  // Handle user leaving a channel
  socket.on("leave_channel", async (data, callback) => {
    try {
      const { channelId } = data;

      // Leave the channel room
      const channelRoom = `channel:${channelId}`;
      socket.leave(channelRoom);

      logger.event(socket.id, "left_channel", { channelId });

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
            error: error.message || "Failed to leave channel",
          });
        }
      }
    }
  });
};
