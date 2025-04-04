import { createLogger } from "../common/logger";
import { directMessageRepository } from "../repositories/direct-message.repository";
import { messageRepository } from "../repositories/message.repository";
import { userRepository } from "../repositories/user.repository";
import { NotFoundError, ForbiddenError } from "../common/errors";
import { v4 as uuidv4 } from "uuid";
import { ContentType, DirectMessage } from "../models";
import mongoose from "mongoose";

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
  ): Promise<typeof DirectMessage.prototype> {
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
    return directMessageRepository.findAllByUserId(userId);
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

    // Verify the direct message exists and the sender is a participant
    const directMessage = await this.getDirectMessageById(
      directMessageId,
      data.senderId,
    );

    // Create a unique messageId
    const messageId = `${Date.now()}_${uuidv4()}`;

    // Create the message
    const message = await messageRepository.createMessage({
      messageId,
      senderId: data.senderId,
      directMessageId,
      content: data.content,
      contentType: ContentType.TEXT,
    });

    // Update the lastActivity timestamp of the direct message
    await directMessageRepository.update(directMessageId, {
      lastActivity: new Date(),
    });

    return {
      message,
      directMessage,
    };
  }
}

export const directMessageService = DirectMessageService.getInstance();
