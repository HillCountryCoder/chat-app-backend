import { createLogger } from "../common/logger";
import { directMessageRepository } from "../repositories/direct-message.repository";
import { messageRepository } from "../repositories/message.repository";
import { userRepository } from "../repositories/user.repository";
import { NotFoundError, ForbiddenError } from "../common/errors";
import { v4 as uuidv4 } from "uuid";
import { ContentType, DirectMessageInterface } from "../models";
import mongoose from "mongoose";
import { unreadMessagesService } from "./unread-messages.service";

const logger = createLogger("direct-message-service");

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
    const [user1, user2] = await Promise.all([
      userRepository.findById(userId1),
      userRepository.findById(userId2),
    ]);

    if (!user1 || !user2) {
      throw new NotFoundError("user");
    }

    // Look for existing direct message
    let directMessage = await directMessageRepository.findByParticipants(
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

    // Get messages
    return messageRepository.findByDirectMessageId(directMessageId, options);
  }

  async sendMessage(data: {
    senderId: string;
    receiverId?: string;
    directMessageId?: string;
    content: string;
    replyToId?: string;
  }) {
    let directMessageId = data.directMessageId;

    // If directMessageId isn't provided but receiverId is, get or create a direct message
    if (!directMessageId && data.receiverId) {
      const directMessage = await this.getOrCreateDirectMessage(
        data.senderId,
        data.receiverId,
      );
      directMessageId = directMessage._id.toString();
    }

    if (!directMessageId) {
      throw new Error("Either directMessageId or receiverId must be provided");
    }

    const directMessage = await this.getDirectMessageById(
      directMessageId,
      data.senderId,
    );

    const messageId = `${Date.now()}_${uuidv4()}`;
    // Validate reply message exists
    if (data.replyToId) {
      const replyMessage = await messageRepository.findById(data.replyToId);
      if (
        !replyMessage ||
        replyMessage.directMessageId?.toString() !== directMessageId
      ) {
        throw new Error("Invalid reply message");
      }
    }
    // Create the message
    const message = await messageRepository.createMessage({
      messageId,
      senderId: data.senderId,
      directMessageId,
      content: data.content,
      contentType: ContentType.TEXT,
      replyToId: data.replyToId,
    });

    const messageDocument = await messageRepository.findById(
      message._id.toString(),
    );
    const populatedMessage = await messageDocument?.populate({
      path: "replyTo",
      select: "content senderId",
      populate: {
        path: "senderId",
        select: "displayName",
      },
    });
    const populatedMessageWithSenderId = await populatedMessage.populate({
      path: "senderId",
      select: "_id username displayName avatarUrl",
    });
    // Update the lastActivity timestamp of the direct message
    await directMessageRepository.update(directMessageId, {
      lastActivity: new Date(),
    });

    // Increment unread count for all participants except the sender
    await unreadMessagesService.incrementUnreadCount(
      "dm",
      directMessageId,
      data.senderId,
      directMessage.participantIds.map((id) =>
        id instanceof mongoose.Types.ObjectId ? id.toString() : id,
      ),
    );

    return {
      message: populatedMessageWithSenderId,
      directMessage,
    };
  }

  async markMessagesAsRead(directMessageId: string, userId: string) {
    await this.getDirectMessageById(directMessageId, userId);

    await unreadMessagesService.markAsRead(userId, "dm", directMessageId);

    return { success: true };
  }

  async getUnreadCounts(userId: string) {
    return unreadMessagesService.getAllUnreadCounts(userId);
  }
}

export const directMessageService = DirectMessageService.getInstance();
