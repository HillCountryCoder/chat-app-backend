/* eslint-disable @typescript-eslint/no-explicit-any */
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
import {
  EDIT_TIME_LIMIT,
  validateEditTimeLimit,
} from "./validation/message.validation";
import { runInTenantContext, tenantContext } from "../plugins/tenantPlugin";

const logger = createLogger("message-service");

// Type for Plate.js Value
type PlateValue = Array<{
  id?: string;
  type: string;
  children: Array<{ text: string; [key: string]: any }>;
  [key: string]: any;
}>;

export class MessageService {
  private static instance: MessageService;

  private constructor() {}

  static getInstance(): MessageService {
    if (!MessageService.instance) {
      MessageService.instance = new MessageService();
    }
    return MessageService.instance;
  }

  private getTenantId(): string {
    const context = tenantContext.getStore();
    if (!context?.tenantId) {
      throw new Error("Message operation attempted without tenant context");
    }
    return context.tenantId;
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

  // Updated method to support rich content
  async createMessageWithAttachments(data: {
    senderId: string;
    content: string;
    richContent?: PlateValue; // Add rich content support
    contentType?: ContentType; // Add content type
    attachmentIds?: string[];
    channelId?: string;
    directMessageId?: string;
    threadId?: string;
    replyToId?: string;
  }) {
    return runInTenantContext(this.getTenantId(), async () => {
      const tenantId = this.getTenantId();
      const {
        senderId,
        content,
        richContent,
        contentType,
        attachmentIds = [],
        channelId,
        directMessageId,
        threadId,
        replyToId,
      } = data;

      // Validate rich content if provided
      if (richContent) {
        this.validateRichContent(richContent);
      }

      // Determine content type automatically if not provided
      let finalContentType = contentType;
      if (!finalContentType) {
        finalContentType = richContent ? ContentType.RICH : ContentType.TEXT;
      }

      // Validate content type consistency
      if (richContent && finalContentType !== ContentType.RICH) {
        throw new ValidationError(
          "Content type must be 'rich' when rich content is provided",
        );
      }

      if (!richContent && finalContentType === ContentType.RICH) {
        throw new ValidationError(
          "Rich content must be provided when content type is 'rich'",
        );
      }

      // Calculate total attachment size if attachments provided
      let totalSize = 0;
      if (attachmentIds.length > 0) {
        // Validate all attachments are ready and owned by sender
        await this.validateAttachmentAccess(attachmentIds, senderId);

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
        richContent: richContent || undefined,
        contentType: finalContentType,
        attachments: attachmentIds,
        hasMedia: attachmentIds.length > 0,
        totalAttachmentSize: totalSize > 0 ? totalSize : undefined,
        replyToId,
        reactions: [],
        mentions: [],
      });

      logger.info("Created message with attachments", {
        messageId: message.messageId,
        contentType: finalContentType,
        hasRichContent: !!richContent,
        attachmentCount: attachmentIds.length,
        totalSize,
        tenantId,
      });

      return message;
    });
  }

  // Validate rich content format
  private validateRichContent(richContent: any): void {
    if (!Array.isArray(richContent)) {
      throw new ValidationError("Rich content must be an array");
    }

    // Validate each node in the rich content
    for (const node of richContent) {
      if (typeof node !== "object" || node === null) {
        throw new ValidationError("Each rich content node must be an object");
      }

      if (!node.type || typeof node.type !== "string") {
        throw new ValidationError("Each rich content node must have a type");
      }

      if (!Array.isArray(node.children)) {
        throw new ValidationError(
          "Each rich content node must have children array",
        );
      }

      // Validate children
      for (const child of node.children) {
        if (typeof child !== "object" || child === null) {
          throw new ValidationError("Each child must be an object");
        }

        // Text nodes must have text property
        if ("text" in child && typeof child.text !== "string") {
          throw new ValidationError(
            "Text nodes must have string text property",
          );
        }
      }
    }
  }

  // Helper method to extract plain text from rich content
  extractPlainTextFromRichContent(richContent: PlateValue): string {
    return richContent
      .map((node) =>
        node.children
          ?.map((child) => ("text" in child ? child.text : ""))
          .join(""),
      )
      .join("\n")
      .trim();
  }

  // Validate attachment access - helper method
  async validateAttachmentAccess(
    attachmentIds: string[],
    userId: string,
  ): Promise<void> {
    if (!attachmentIds.length) return;
    return runInTenantContext(this.getTenantId(), async () => {
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
    });
  }

  async populateMessageAttachments(messages: any[]) {
    if (!messages.length) return messages;

    return runInTenantContext(this.getTenantId(), async () => {
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
    return runInTenantContext(this.getTenantId(), async () => {
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
            select: "content richContent contentType senderId",
            populate: {
              path: "senderId",
              select: "displayName username",
            },
          },
        ],
      });
    });
  }

  // Get messages with rich content statistics
  async getRichContentStatistics(
    conversationId: string,
    type: "dm" | "channel" | "thread",
  ) {
    const matchStage: any = {};

    if (type === "dm") matchStage.directMessageId = conversationId;
    if (type === "channel") matchStage.channelId = conversationId;
    if (type === "thread") matchStage.threadId = conversationId;

    const stats = await messageRepository.aggregate([
      { $match: matchStage },
      {
        $group: {
          _id: null,
          totalMessages: { $sum: 1 },
          richMessages: {
            $sum: {
              $cond: [{ $eq: ["$contentType", "rich"] }, 1, 0],
            },
          },
          plainMessages: {
            $sum: {
              $cond: [{ $ne: ["$contentType", "rich"] }, 1, 0],
            },
          },
        },
      },
    ]);

    return stats.length > 0
      ? {
          ...stats[0],
          richContentPercentage:
            stats[0].totalMessages > 0
              ? (stats[0].richMessages / stats[0].totalMessages) * 100
              : 0,
        }
      : {
          totalMessages: 0,
          richMessages: 0,
          plainMessages: 0,
          richContentPercentage: 0,
        };
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
    return runInTenantContext(this.getTenantId(), async () => {
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
    });
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

  async editMessage(data: {
    messageId: string;
    userId: string;
    content: string;
    richContent?: any;
    contentType?: string;
    contextType: "direct_message" | "channel";
    contextId: string;
  }) {
    return runInTenantContext(this.getTenantId(), async () => {
      const tenantId = this.getTenantId();
      const {
        messageId,
        userId,
        content,
        richContent,
        contentType,
        contextType,
        contextId,
      } = data;

      // Get the message first
      const message = await messageRepository.findById(messageId);
      if (!message) {
        throw new NotFoundError("message");
      }

      // Check if user is the sender
      if (message.senderId.toString() !== userId) {
        throw new ForbiddenError("You can only edit your own messages");
      }

      // Check if message is within edit time limit
      if (!validateEditTimeLimit(message.createdAt)) {
        throw new ForbiddenError(
          `Messages can only be edited within ${
            EDIT_TIME_LIMIT / (1000 * 60 * 60)
          } hours of sending`,
        );
      }

      // Validate that the message belongs to the correct context
      if (
        contextType === "direct_message" &&
        message.directMessageId?.toString() !== contextId
      ) {
        throw new ForbiddenError(
          "Message does not belong to this direct message",
        );
      }
      if (
        contextType === "channel" &&
        message.channelId?.toString() !== contextId
      ) {
        throw new ForbiddenError("Message does not belong to this channel");
      }

      // Validate rich content if provided
      if (richContent) {
        this.validateRichContent(richContent);
      }

      // Determine final content type
      let finalContentType = contentType;
      if (!finalContentType) {
        finalContentType = richContent ? ContentType.RICH : ContentType.TEXT;
      }

      // Update the message
      const updateData = {
        content,
        richContent,
        contentType: finalContentType,
        editedAt: new Date(),
        isEdited: true,
      };

      const updatedMessage = await messageRepository.updateMessage(
        messageId,
        updateData,
      );
      if (!updatedMessage) {
        throw new NotFoundError("message");
      }

      logger.info("Message edited successfully", {
        messageId,
        userId,
        contextType,
        contextId,
        contentType: finalContentType,
        hasRichContent: !!richContent,
        tenantId,
      });

      return updatedMessage;
    });
  }
}

export const messageService = MessageService.getInstance();
