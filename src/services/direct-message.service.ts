// src/services/direct-message.service.ts - Enhanced for Phase 3
import { createLogger } from "../common/logger";
import { directMessageRepository } from "../repositories/direct-message.repository";
import { messageRepository } from "../repositories/message.repository";
import {
  NotFoundError,
  ForbiddenError,
  ValidationError,
} from "../common/errors";
import { DirectMessageInterface } from "../models";
import mongoose from "mongoose";
import { unreadMessagesService } from "./unread-messages.service";
import { userService } from "./user.service";
import { messageService } from "./message.service";
import { attachmentService } from "./attachment.service";
import {
  MAX_ATTACHMENTS_PER_MESSAGE,
  MAX_TOTAL_MESSAGE_SIZE,
} from "../constants";

const logger = createLogger("direct-message-service");

// Constants for Phase 3

export class DirectMessageService {
  private static instance: DirectMessageService;

  private constructor() {}

  static getInstance(): DirectMessageService {
    if (!DirectMessageService.instance) {
      DirectMessageService.instance = new DirectMessageService();
    }
    return DirectMessageService.instance;
  }

  async getOrCreateDirectMessage(userId1: string, userId2: string) {
    // Check if both users exist
    await userService.checkIfUsersExists([userId1, userId2]);

    let directMessage = await this.getDirectMessageByParticipantIds(
      userId1,
      userId2,
    );
    // If none exists, create a new one
    if (!directMessage) {
      logger.info(
        `Creating new direct message between users ${userId1} and ${userId2}`,
      );
      directMessage = await directMessageRepository.create({
        participantIds: [userId1, userId2].sort(),
        lastActivity: new Date(),
      });
    }

    return directMessage;
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
    if (
      !directMessage.participantIds.some(
        (id) =>
          id.toString() === userId ||
          (id instanceof mongoose.Types.ObjectId && id.equals(userId)),
      )
    ) {
      throw new ForbiddenError("You don't have access to this conversation");
    }

    return directMessage;
  }

  async getUserDirectMessages(userId: string) {
    const directMessages = await directMessageRepository.findAllByUserId(
      userId,
    );

    // For each DM, get the most recent message
    const directMessagesWithLastMessage = await Promise.all(
      directMessages.map(async (dm) => {
        const messages = await messageRepository.findByDirectMessageId(
          dm._id.toString(),
          { limit: 1 },
        );

        return {
          ...dm.toObject(),
          lastMessage: messages.length > 0 ? messages[0] : null,
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

  // Enhanced sendMessage method for Phase 3
  async sendMessage(data: {
    senderId: string;
    receiverId?: string;
    directMessageId?: string;
    content: string;
    attachmentIds?: string[];
    replyToId?: string;
  }) {
    const {
      senderId,
      receiverId,
      directMessageId,
      content,
      attachmentIds = [],
      replyToId,
    } = data;

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

    // Create the message with attachments
    const message = await messageService.createMessageWithAttachments({
      senderId,
      content,
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

    logger.info("Direct message sent with attachments", {
      messageId: message.messageId,
      dmId,
      senderId,
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
}

export const directMessageService = DirectMessageService.getInstance();
