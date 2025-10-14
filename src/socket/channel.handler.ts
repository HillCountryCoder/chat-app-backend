import { Server, Socket } from "socket.io";
import { createLogger, createSocketLogger } from "../common/logger";
import { channelService } from "../services/channel.service";
import { ErrorHandler } from "../common/errors";
import { ValidationError } from "../common/errors";
import { z } from "zod";
import { unreadMessagesService } from "../services/unread-messages.service";
import { MAX_ATTACHMENTS_PER_MESSAGE } from "../constants";
import { ContentType } from "../models";
import { runInTenantContext } from "../plugins/tenantPlugin";

const logger = createSocketLogger(createLogger("channel-socket"));
const errorHandler = new ErrorHandler(createLogger("socket-error-handler"));

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
    channelId: z.string(),
    attachmentIds: z
      .array(z.string())
      .max(MAX_ATTACHMENTS_PER_MESSAGE)
      .optional(),
    replyToId: z.string().optional(),
  })
  .refine((data) => data.channelId, {
    message: "channelId is required",
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
  tenantId: string, // ADD TENANT ID PARAMETER
) => {
  // Function to join all channels the user is a member of (tenant-scoped)
  const joinUserChannels = async () => {
    try {
      await runInTenantContext(tenantId, async () => {
        const channels = await channelService.getAllChannels(userId);
        channels.forEach((channel) => {
          // Use tenant-scoped room names
          const channelRoom = `tenant:${tenantId}:channel:${channel._id}`;
          socket.join(channelRoom);
          logger.event(socket.id, "joined_channel_room", {
            channelId: channel._id,
            tenantId,
          });
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
        hasRichContent: !!data.richContent,
        tenantId,
      });

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

      // Determine content type if not explicitly provided
      let contentType = validatedData.contentType;
      if (!contentType) {
        contentType = validatedData.richContent
          ? ContentType.RICH
          : ContentType.TEXT;
      }

      // Process the message within tenant context
      const result = await runInTenantContext(tenantId, async () => {
        return await channelService.sendMessage({
          senderId: userId,
          channelId: validatedData.channelId,
          content: validatedData.content,
          richContent: validatedData.richContent,
          contentType,
          attachmentIds: validatedData.attachmentIds || [],
          replyToId: validatedData.replyToId,
        });
      });

      // Emit to the TENANT-SCOPED channel room
      const channelRoom = `tenant:${tenantId}:channel:${validatedData.channelId}`;
      io.to(channelRoom).emit("new_channel_message", {
        message: result.message,
      });

      // Get channel members and notify (within tenant context)
      await runInTenantContext(tenantId, async () => {
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

          // Emit to the member's TENANT-SCOPED room
          io.to(`tenant:${tenantId}:user:${memberIdStr}`).emit(
            "unread_counts_update",
            unreadCounts,
          );
        }
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

      // Verify user has access to this channel (within tenant context)
      await runInTenantContext(tenantId, async () => {
        await channelService.getChannelById(channelId, userId);
      });

      // Join the TENANT-SCOPED channel room
      const channelRoom = `tenant:${tenantId}:channel:${channelId}`;
      socket.join(channelRoom);

      logger.event(socket.id, "joined_channel", { channelId, tenantId });

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

      // Leave the TENANT-SCOPED channel room
      const channelRoom = `tenant:${tenantId}:channel:${channelId}`;
      socket.leave(channelRoom);

      logger.event(socket.id, "left_channel", { channelId, tenantId });

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

      // Mark messages as read (within tenant context)
      await runInTenantContext(tenantId, async () => {
        await channelService.markMessagesAsRead(channelId, userId);
      });

      // Get updated unread counts (within tenant context)
      const unreadCounts = await runInTenantContext(tenantId, async () => {
        return await unreadMessagesService.getAllUnreadCounts(userId);
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

  socket.on("join_channel_room", async (data, callback) => {
    try {
      const { channelId } = data;

      // Verify user has access to this channel (within tenant context)
      await runInTenantContext(tenantId, async () => {
        await channelService.getChannelById(channelId, userId);
      });

      // Join the TENANT-SCOPED channel room
      const channelRoom = `tenant:${tenantId}:channel:${channelId}`;
      socket.join(channelRoom);

      logger.event(socket.id, "joined_channel_room", { channelId, tenantId });

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
    const channelRoom = `tenant:${tenantId}:channel:${channelId}`;
    socket.leave(channelRoom);
    logger.event(socket.id, "left_channel_room", { channelId, tenantId });
  });

  socket.on("send_thread_message", async (data, callback) => {
    try {
      logger.event(socket.id, "send_thread_message", {
        ...data,
        attachmentCount: data.attachmentIds?.length || 0,
        tenantId,
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

      // Process the thread message with attachments (within tenant context)
      const result = await runInTenantContext(tenantId, async () => {
        return await channelService.sendThreadMessage({
          senderId: userId,
          threadId: validatedData.threadId,
          content: validatedData.content,
          attachmentIds: validatedData.attachmentIds || [],
        });
      });

      // Emit to the TENANT-SCOPED thread room
      const threadRoom = `tenant:${tenantId}:thread:${validatedData.threadId}`;
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

      // Verify user has access to this thread (within tenant context)
      await runInTenantContext(tenantId, async () => {
        await channelService.getThreadById(threadId, userId);
      });

      // Join the TENANT-SCOPED thread room
      const threadRoom = `tenant:${tenantId}:thread:${threadId}`;
      socket.join(threadRoom);

      logger.event(socket.id, "joined_thread", { threadId, tenantId });

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

      // Leave the TENANT-SCOPED thread room
      const threadRoom = `tenant:${tenantId}:thread:${threadId}`;
      socket.leave(threadRoom);

      logger.event(socket.id, "left_thread", { threadId, tenantId });

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

  socket.on("edit_channel_message", async (data, callback) => {
    try {
      logger.event(socket.id, "edit_channel_message", { ...data, tenantId });
      const { channelId, messageId, content, richContent, contentType } = data;

      if (!channelId || !messageId || !content) {
        throw new ValidationError(
          "channelId, messageId, and content are required",
        );
      }

      // Edit message (within tenant context)
      const result = await runInTenantContext(tenantId, async () => {
        return await channelService.editMessage({
          channelId,
          messageId,
          userId,
          content,
          richContent,
          contentType,
        });
      });

      // Emit to the TENANT-SCOPED channel room
      const channelRoom = `tenant:${tenantId}:channel:${channelId}`;
      io.to(channelRoom).emit("message_updated", {
        message: result.message,
        channelId,
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
