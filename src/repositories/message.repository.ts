import { Message, MessageInterface } from "../models";
import { BaseRepository } from "./base.repository";
import { Types } from "mongoose";

export class MessageRepository extends BaseRepository<
  typeof Message.prototype
> {
  private static instance: MessageRepository;

  private constructor() {
    super(Message);
  }

  static getInstance(): MessageRepository {
    if (!MessageRepository.instance) {
      MessageRepository.instance = new MessageRepository();
    }
    return MessageRepository.instance;
  }

  async findByDirectMessageId(
    directMessageId: string,
    options?: {
      limit?: number;
      before?: string;
      after?: string;
    },
  ): Promise<MessageInterface[]> {
    const query: any = {
      directMessageId: new Types.ObjectId(directMessageId),
    };

    if (options?.before) {
      query.createdAt = { $lt: new Date(options.before) };
    }

    if (options?.after) {
      query.createdAt = { ...query.createdAt, $gt: new Date(options.after) };
    }

    let findQuery = this.model.find(query).sort({ createdAt: -1 });

    if (options?.limit) {
      findQuery = findQuery.limit(options.limit);
    }

    return (
      await findQuery
        .populate({
          path: "senderId",
          select: "_id username displayName avatarUrl",
          model: "User",
        })
        .lean()
    ).map((message: any) => {
      // Create a sender field with the populated data and restore senderId to just the ID
      const result: MessageInterface = {
        ...message,
        sender: message.senderId,
        senderId: message.senderId._id,
        messageId: message._id.toString(),
        content: message.content,
        contentType: message.contentType,
        mentions: message.mentions || [],
        createdAt: message.createdAt,
        updatedAt: message.updatedAt,
      };
      return result;
    });
  }
  async findByChannelId(
    channelId: string,
    options?: {
      limit?: number;
      before?: string;
      after?: string;
    },
  ): Promise<MessageInterface[]> {
    const query: any = {
      channelId: new Types.ObjectId(channelId),
    };

    if (options?.before) {
      query.createdAt = { $lt: new Date(options.before) };
    }

    if (options?.after) {
      query.createdAt = { ...query.createdAt, $gt: new Date(options.after) };
    }

    let findQuery = this.model.find(query).sort({ createdAt: -1 });

    if (options?.limit) {
      findQuery = findQuery.limit(options.limit);
    }

    return (
      await findQuery
        .populate({
          path: "senderId",
          select: "_id username displayName avatarUrl",
          model: "User",
        })
        .lean()
    ).map((message: any) => {
      // Create a sender field with the populated data and restore senderId to just the ID
      const result: MessageInterface = {
        ...message,
        sender: message.senderId,
        senderId: message.senderId._id,
        messageId: message._id.toString(),
        content: message.content,
        contentType: message.contentType,
        mentions: message.mentions || [],
        createdAt: message.createdAt,
        updatedAt: message.updatedAt,
      };
      return result;
    });
  }
  async createMessage(message: {
    messageId: string;
    senderId: string;
    directMessageId?: string;
    channelId?: string;
    content: string;
    contentType?: string;
  }): Promise<MessageInterface> {
    return this.create(message);
  }
}

export const messageRepository = MessageRepository.getInstance();
