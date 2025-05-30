/* eslint-disable @typescript-eslint/no-explicit-any */
// src/services/message.service.ts - Enhanced for Phase 3
import { ContentType, MessageInterface, Reaction } from "../models";
import { messageRepository } from "../repositories/message.repository";
import {
  BadRequestError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "../common/errors";
import { attachmentRepository } from "../repositories/attachment.repository";
import { v4 as uuidv4 } from "uuid";
import { createLogger } from "../common/logger";
import { attachmentService } from "./attachment.service";
import mongoose from "mongoose";

const logger = createLogger("message-service");

export class MessageService {
  private static instance: MessageService;

  private constructor() {}

  static getInstance(): MessageService {
    if (!MessageService.instance) {
      MessageService.instance = new MessageService();
    }
    return MessageService.instance;
  }

  async getMessageByIdOrThrowError(
    messageId: string,
  ): Promise<MessageInterface> {
    const message = await messageRepository.findById(messageId);
    if (!message) {
      throw new NotFoundError("message");
    }
    return message;
  }

  async getMessagesByIdsOrThrowError(
    messageIds: string[],
  ): Promise<MessageInterface[]> {
    const messages = await messageRepository.find({
      _id: { $in: messageIds },
    });
    if (!messages || messages.length === 0) {
      throw new NotFoundError("messages");
    }
    return messages;
  }

  findReactionByEmoji(message: MessageInterface, emoji: string): Reaction {
    const reaction = message.reactions.find((r) => r.emoji === emoji);
    if (reaction) {
      return reaction;
    } else {
      throw new NotFoundError("reaction");
    }
  }

  async createMessageWithAttachments(data: {
    senderId: string;
    content: string;
    attachmentIds?: string[];
    channelId?: string;
    directMessageId?: string;
    threadId?: string;
    replyToId?: string;
  }) {
    const {
      senderId,
      content,
      attachmentIds = [],
      channelId,
      directMessageId,
      threadId,
      replyToId,
    } = data;

    // Calculate total attachment size if attachments provided
    let totalSize = 0;
    if (attachmentIds.length > 0) {
      // Validate all attachments are ready and owned by sender
      this.validateAttachmentAccess(attachmentIds, senderId);

      totalSize = await this.calculateMessageSize(attachmentIds);
      if (totalSize <= 0) {
        throw new ValidationError(
          "Total attachment size must be greater than 0",
        );
      }
    }

    // Create message
    const message = await messageRepository.create({
      messageId: uuidv4(),
      senderId,
      channelId,
      directMessageId,
      threadId,
      content,
      contentType: ContentType.TEXT,
      attachments: attachmentIds,
      hasMedia: attachmentIds.length > 0,
      totalAttachmentSize: totalSize > 0 ? totalSize : undefined,
      replyToId,
      reactions: [],
      mentions: [],
    });

    logger.info("Created message with attachments", {
      messageId: message.messageId,
      attachmentCount: attachmentIds.length,
      totalSize,
    });

    return message;
  }

  // Validate attachment access - helper method
  async validateAttachmentAccess(
    attachmentIds: string[],
    userId: string,
  ): Promise<void> {
    if (!attachmentIds.length) return;

    const attachments = await attachmentRepository.findReadyAttachments(
      attachmentIds,
    );

    if (attachments.length !== attachmentIds.length) {
      throw new ValidationError(
        "Some attachments are not ready or don't exist",
      );
    }

    // Check ownership
    const unauthorizedAttachments = attachments.filter(
      (att) => att.uploadedBy.toString() !== userId,
    );
    if (unauthorizedAttachments.length > 0) {
      throw new ForbiddenError(
        "You don't have permission to use some of these attachments",
      );
    }
  }

  async populateMessageAttachments(messages: any[]) {
    if (!messages.length) return messages;

    // Get all attachment IDs from all messages
    const allAttachmentIds = messages
      .filter((msg) => msg.attachments?.length > 0)
      .flatMap((msg) =>
        msg.attachments.map((id: mongoose.Types.ObjectId) => id.toString()),
      );

    if (!allAttachmentIds.length) return messages;

    // Fetch all attachments in one query
    const attachmentsMap = new Map();
    const attachments = await attachmentRepository.find({
      _id: { $in: allAttachmentIds },
    });

    attachments.forEach((att) => {
      attachmentsMap.set(att._id.toString(), att);
    });

    // Populate messages with attachment data
    return messages.map((message) => {
      if (message.attachments?.length > 0) {
        const populatedAttachments = message.attachments
          .map((attId: mongoose.Types.ObjectId) =>
            attachmentsMap.get(attId.toString()),
          )
          .filter(Boolean);

        return {
          ...(message.toObject ? message.toObject() : message),
          attachments: populatedAttachments,
        };
      }
      return message.toObject ? message.toObject() : message;
    });
  }

  // Get media messages - enhanced for Phase 3
  async getMediaMessages(
    directMessageId?: string,
    channelId?: string,
    threadId?: string,
    options?: {
      limit?: number;
      before?: string;
      after?: string;
    },
  ) {
    const query: any = { hasMedia: true };

    if (directMessageId) query.directMessageId = directMessageId;
    if (channelId) query.channelId = channelId;
    if (threadId) query.threadId = threadId;

    if (options?.before) {
      query.createdAt = { $lt: new Date(options.before) };
    }
    if (options?.after) {
      query.createdAt = { ...query.createdAt, $gt: new Date(options.after) };
    }

    return messageRepository.findWithPopulate(query, {
      sort: { createdAt: -1 },
      limit: options?.limit,
      populate: [
        {
          path: "senderId",
          select: "_id username displayName avatarUrl",
        },
        {
          path: "replyTo",
          select: "content senderId",
          populate: {
            path: "senderId",
            select: "displayName username",
          },
        },
      ],
    });
  }

  // New method: Get attachment statistics
  async getAttachmentStatistics(
    conversationId: string,
    type: "dm" | "channel" | "thread",
  ) {
    const matchStage: any = { hasMedia: true };

    if (type === "dm") matchStage.directMessageId = conversationId;
    if (type === "channel") matchStage.channelId = conversationId;
    if (type === "thread") matchStage.threadId = conversationId;

    const stats = await messageRepository.aggregate([
      { $match: matchStage },
      {
        $group: {
          _id: null,
          totalMessages: { $sum: 1 },
          totalSize: { $sum: "$totalAttachmentSize" },
          totalFiles: { $sum: { $size: "$attachments" } },
          avgFilesPerMessage: { $avg: { $size: "$attachments" } },
        },
      },
    ]);

    return stats.length > 0
      ? stats[0]
      : {
          totalMessages: 0,
          totalSize: 0,
          totalFiles: 0,
          avgFilesPerMessage: 0,
        };
  }

  // New method: Get messages by attachment status
  async getMessagesByAttachmentStatus(
    conversationId: string,
    type: "dm" | "channel" | "thread",
    status: "ready" | "processing" | "failed",
  ) {
    // First get messages with attachments
    const query: any = { hasMedia: true };
    if (type === "dm") query.directMessageId = conversationId;
    if (type === "channel") query.channelId = conversationId;
    if (type === "thread") query.threadId = conversationId;

    const messages = await messageRepository.find(query);

    // Filter by attachment status
    const filteredMessages = [];
    for (const message of messages) {
      if (message.attachments.length > 0) {
        const attachments = await attachmentRepository.find({
          _id: { $in: message.attachments },
          status,
        });

        if (attachments.length > 0) {
          filteredMessages.push({
            ...message.toObject(),
            attachments,
          });
        }
      }
    }

    return filteredMessages;
  }

  setMessageContext(
    messageData: any,
    directMessageId?: string,
    channelId?: string,
    threadId?: string,
  ) {
    if (directMessageId) {
      messageData.directMessageId = directMessageId;
    } else if (channelId) {
      messageData.channelId = channelId;
    } else if (threadId) {
      messageData.threadId = threadId;
    } else {
      throw new BadRequestError(
        "Message must belong to a direct message, channel, or thread",
      );
    }

    return messageData;
  }

  async calculateMessageSize(attachmentIds: string[]): Promise<number> {
    if (!attachmentIds.length) return 0;
    return attachmentService.calculateMessageAttachmentSize(attachmentIds);
  }
}

export const messageService = MessageService.getInstance();
