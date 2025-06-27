/* eslint-disable @typescript-eslint/no-explicit-any */
// Updated direct-message.service.ts with Rich Content Support
import mongoose from "mongoose";
import { DirectMessageInterface } from "../models/direct-message.model";
import { ContentType } from "../models/message.model";
import { directMessageRepository } from "../repositories/direct-message.repository";
import { messageRepository } from "../repositories/message.repository";
import { unreadMessagesService } from "./unread-messages.service";
import { messageService } from "./message.service";
import { attachmentService } from "./attachment.service";
import {
  NotFoundError,
  ForbiddenError,
  ValidationError,
} from "../common/errors";
import { createLogger } from "../common/logger";
import { userService } from "./user.service";

const logger = createLogger("direct-message-service");

// Constants for Phase 3 validations
const MAX_ATTACHMENTS_PER_MESSAGE = 10;
const MAX_TOTAL_MESSAGE_SIZE = 25 * 1024 * 1024; // 25MB

// Type for Plate.js Value
type PlateValue = Array<{
  id?: string;
  type: string;
  children: Array<{ text: string; [key: string]: any }>;
  [key: string]: any;
}>;

export class DirectMessageService {
  private static instance: DirectMessageService;

  private constructor() {}

  static getInstance(): DirectMessageService {
    if (!DirectMessageService.instance) {
      DirectMessageService.instance = new DirectMessageService();
    }
    return DirectMessageService.instance;
  }

  async getDirectMessageById(
    directMessageId: string,
    userId: string,
  ): Promise<DirectMessageInterface> {
    const directMessage = await directMessageRepository.findById(
      directMessageId,
    );

    if (!directMessage) {
      throw new NotFoundError("direct message");
    }

    // Check if user is a participant
    const isParticipant = directMessage.participantIds.some(
      (id) => id.toString() === userId,
    );

    if (!isParticipant) {
      throw new ForbiddenError("Access denied to this direct message");
    }

    return directMessage;
  }

  async getUserDirectMessages(userId: string): Promise<any[]> {
    const directMessages = await directMessageRepository.findAllByUserId(
      userId,
    );

    // Get the last message for each direct message with populated attachments
    const directMessagesWithLastMessage = await Promise.all(
      directMessages.map(async (dm) => {
        const messages = await messageRepository.findByDirectMessageId(
          dm._id.toString(),
          { limit: 1 },
        );

        // Populate attachments for the last message if it exists
        const populatedMessages =
          await messageService.populateMessageAttachments(messages);

        return {
          ...dm.toObject(),
          lastMessage:
            populatedMessages.length > 0 ? populatedMessages[0] : null,
        };
      }),
    );

    return directMessagesWithLastMessage;
  }

  async getMessages(
    directMessageId: string,
    userId: string,
    options?: {
      limit?: number;
      before?: string;
      after?: string;
    },
  ) {
    // Verify user has access to this direct message
    await this.getDirectMessageById(directMessageId, userId);

    // Get messages with populated attachments
    const messages = await messageRepository.findByDirectMessageId(
      directMessageId,
      options,
    );

    // Populate attachments for messages that have them
    return await messageService.populateMessageAttachments(messages);
  }

  private async getOrCreateDirectMessage(
    senderId: string,
    receiverId: string,
  ): Promise<DirectMessageInterface> {
    // Check if a direct message already exists between these users
    const userIDs = [senderId, receiverId];
    await userService.checkIfUsersExists(userIDs);
    const existingDirectMessage =
      await directMessageRepository.findByParticipants(senderId, receiverId);

    if (existingDirectMessage) {
      return existingDirectMessage;
    }

    // Create a new direct message
    const newDirectMessage = await directMessageRepository.create({
      participantIds: [
        new mongoose.Types.ObjectId(senderId),
        new mongoose.Types.ObjectId(receiverId),
      ],
    });

    return newDirectMessage;
  }

  // Updated sendMessage method with rich content support
  async sendMessage(data: {
    senderId: string;
    receiverId?: string;
    directMessageId?: string;
    content: string;
    richContent?: PlateValue;
    contentType?: ContentType;
    attachmentIds?: string[];
    replyToId?: string;
  }) {
    const {
      senderId,
      receiverId,
      directMessageId,
      content,
      richContent,
      contentType,
      attachmentIds = [],
      replyToId,
    } = data;

    logger.debug("Sending direct message", {
      senderId,
      hasRichContent: !!richContent,
      contentType,
      attachmentCount: attachmentIds.length,
    });

    // Phase 3 validations
    await this.validateMessageWithAttachments(attachmentIds, senderId);

    let dmId = directMessageId;

    // If directMessageId isn't provided but receiverId is, get or create a direct message
    if (!dmId && receiverId) {
      const directMessage = await this.getOrCreateDirectMessage(
        senderId,
        receiverId,
      );
      dmId = directMessage._id.toString();
    }

    if (!dmId) {
      throw new Error("Either directMessageId or receiverId must be provided");
    }

    // Verify the direct message exists and the sender is a participant
    const directMessage = await this.getDirectMessageById(dmId, senderId);

    // Create the message with attachments and rich content
    const message = await messageService.createMessageWithAttachments({
      senderId,
      content,
      richContent,
      contentType,
      attachmentIds,
      directMessageId: dmId,
      replyToId,
    });

    // Update the lastActivity timestamp of the direct message
    await directMessageRepository.update(dmId, {
      lastActivity: new Date(),
    });

    // Increment unread count for all participants except the sender
    await unreadMessagesService.incrementUnreadCount(
      "dm",
      dmId,
      senderId,
      directMessage.participantIds.map((id) =>
        id instanceof mongoose.Types.ObjectId ? id.toString() : id,
      ),
    );

    logger.info("Direct message sent successfully", {
      messageId: message.messageId,
      dmId,
      senderId,
      contentType: message.contentType,
      hasRichContent: !!richContent,
      attachmentCount: attachmentIds.length,
      hasMedia: message.hasMedia,
      totalAttachmentSize: message.totalAttachmentSize,
    });

    return {
      message,
      directMessage,
    };
  }

  // Phase 3 validation method
  private async validateMessageWithAttachments(
    attachmentIds: string[],
    senderId: string,
  ): Promise<void> {
    if (!attachmentIds.length) return;

    // Check attachment count limit
    if (attachmentIds.length > MAX_ATTACHMENTS_PER_MESSAGE) {
      throw new ValidationError(
        `Cannot attach more than ${MAX_ATTACHMENTS_PER_MESSAGE} files per message`,
      );
    }

    // Validate attachment access and calculate total size
    await messageService.validateAttachmentAccess(attachmentIds, senderId);

    const totalSize = await attachmentService.calculateMessageAttachmentSize(
      attachmentIds,
    );

    if (totalSize > MAX_TOTAL_MESSAGE_SIZE) {
      throw new ValidationError(
        `Total attachment size (${Math.round(
          totalSize / 1024 / 1024,
        )}MB) exceeds limit of ${MAX_TOTAL_MESSAGE_SIZE / 1024 / 1024}MB`,
      );
    }
  }

  async markMessagesAsRead(directMessageId: string, userId: string) {
    await this.getDirectMessageById(directMessageId, userId);

    await unreadMessagesService.markAsRead(userId, "dm", directMessageId);

    return { success: true };
  }

  async getUnreadCounts(userId: string) {
    return unreadMessagesService.getAllUnreadCounts(userId);
  }

  async getDirectMessageByParticipantIds(userId1: string, userId2: string) {
    const directMessage = await directMessageRepository.findByParticipants(
      userId1,
      userId2,
    );

    return directMessage;
  }

  // Enhanced media messages for Phase 3
  async getMediaMessages(
    directMessageId: string,
    userId: string,
    options?: {
      limit?: number;
      before?: string;
      after?: string;
    },
  ) {
    // Verify user has access to this direct message
    await this.getDirectMessageById(directMessageId, userId);

    // Get only messages with media
    const mediaMessages = await messageService.getMediaMessages(
      directMessageId,
      undefined,
      undefined,
      options,
    );

    // Populate attachment details
    return await messageService.populateMessageAttachments(mediaMessages);
  }

  // New method for Phase 3: Get attachment statistics
  async getAttachmentStats(directMessageId: string, userId: string) {
    await this.getDirectMessageById(directMessageId, userId);

    return await messageService.getAttachmentStatistics(directMessageId, "dm");
  }

  // New method: Get rich content statistics
  async getRichContentStats(directMessageId: string, userId: string) {
    await this.getDirectMessageById(directMessageId, userId);

    return await messageService.getRichContentStatistics(directMessageId, "dm");
  }
}

export const directMessageService = DirectMessageService.getInstance();
