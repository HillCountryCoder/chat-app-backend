import { Server, Socket } from "socket.io";
import { createLogger, createSocketLogger } from "../common/logger";
import { channelService } from "../services/channel.service";
import { ErrorHandler } from "../common/errors";
import { ValidationError } from "../common/errors";
import { z } from "zod";
import { unreadMessagesService } from "../services/unread-messages.service";
import { MAX_ATTACHMENTS_PER_MESSAGE } from "../constants";

const logger = createSocketLogger(createLogger("channel-socket"));
const errorHandler = new ErrorHandler(createLogger("socket-error-handler"));

const sendMessageSchema = z.object({
  content: z.string().min(1).max(2000),
  channelId: z.string(),
  attachmentIds: z
    .array(z.string())
    .max(MAX_ATTACHMENTS_PER_MESSAGE)
    .optional(),
  replyToId: z.string().optional(),
});

const sendThreadMessageSchema = z.object({
  content: z.string().min(1).max(2000),
  threadId: z.string(),
  attachmentIds: z
    .array(z.string())
    .max(MAX_ATTACHMENTS_PER_MESSAGE)
    .optional(),
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
      logger.event(socket.id, "send_channel_message", {
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
      const result = await channelService.sendMessage({
        senderId: userId,
        channelId: validatedData.channelId,
        content: validatedData.content,
        attachmentIds: validatedData.attachmentIds || [],
        replyToId: validatedData.replyToId,
      });

      // Emit to the channel room
      const channelRoom = `channel:${validatedData.channelId}`;
      io.to(channelRoom).emit("new_channel_message", {
        message: result.message,
      });
      const channelMembers = await channelService.getChannelMembers(
        validatedData.channelId,
        userId,
      );
      const membersToNotify = channelMembers.filter(
        (member) => member.userId.toString() !== userId,
      );

      for (const member of membersToNotify) {
        const memberIdStr = member.userId.toString();

        // Get updated unread counts for this member
        const unreadCounts = await unreadMessagesService.getAllUnreadCounts(
          memberIdStr,
        );

        // Emit to the member's room
        io.to(`user:${memberIdStr}`).emit("unread_counts_update", unreadCounts);
      }

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
  socket.on("mark_channel_read", async (data, callback) => {
    try {
      const { channelId } = data;

      // Mark messages as read
      await channelService.markMessagesAsRead(channelId, userId);

      // Get updated unread counts
      const unreadCounts = await unreadMessagesService.getAllUnreadCounts(
        userId,
      );

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
  socket.on("join_channel_room", async (data, callback) => {
    try {
      const { channelId } = data;

      // Verify user has access to this channel
      await channelService.getChannelById(channelId, userId);

      // Join the channel room
      const channelRoom = `channel:${channelId}`;
      socket.join(channelRoom);

      logger.event(socket.id, "joined_channel_room", { channelId });

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
            error: error.message || "Failed to join channel room",
          });
        }
      }
    }
  });

  socket.on("leave_channel_room", async (data) => {
    const { channelId } = data;
    const channelRoom = `channel:${channelId}`;
    socket.leave(channelRoom);
    logger.event(socket.id, "left_channel_room", { channelId });
  });

  socket.on("send_thread_message", async (data, callback) => {
    try {
      logger.event(socket.id, "send_thread_message", {
        ...data,
        attachmentCount: data.attachmentIds?.length || 0,
      });

      // Validate the data
      let validatedData;
      try {
        validatedData = sendThreadMessageSchema.parse(data);
      } catch (error) {
        if (error instanceof z.ZodError) {
          throw new ValidationError(
            error.errors.map((e) => e.message).join(", "),
          );
        }
        throw error;
      }

      // Process the thread message with attachments
      const result = await channelService.sendThreadMessage({
        senderId: userId,
        threadId: validatedData.threadId,
        content: validatedData.content,
        attachmentIds: validatedData.attachmentIds || [],
      });

      // Emit to the thread room
      const threadRoom = `thread:${validatedData.threadId}`;
      io.to(threadRoom).emit("new_thread_message", {
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
            error: error.message || "Failed to send thread message",
          });
        }
      }
    }
  });

  socket.on("join_thread", async (data, callback) => {
    try {
      const { threadId } = data;

      // Verify user has access to this thread
      await channelService.getThreadById(threadId, userId);

      // Join the thread room
      const threadRoom = `thread:${threadId}`;
      socket.join(threadRoom);

      logger.event(socket.id, "joined_thread", { threadId });

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
            error: error.message || "Failed to join thread",
          });
        }
      }
    }
  });

  // Handle leaving a thread
  socket.on("leave_thread", async (data, callback) => {
    try {
      const { threadId } = data;

      // Leave the thread room
      const threadRoom = `thread:${threadId}`;
      socket.leave(threadRoom);

      logger.event(socket.id, "left_thread", { threadId });

      if (typeof callback === "function") {
        callback({ success: true });
      }
    } catch (error) {
      if (error instanceof Error) {
        logger.error(socket.id, error);

        if (typeof callback === "function") {
          callback({
            success: false,
            error: error.message || "Failed to leave thread",
          });
        }
      }
    }
  });
};
