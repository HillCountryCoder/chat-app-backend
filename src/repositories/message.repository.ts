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
  ): Promise<(typeof Message.prototype)[]> {
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
    ).map((message) => {
      // Create a sender field with the populated data and restore senderId to just the ID
      const result = {
        ...message,
        sender: message.senderId,
        senderId: message.senderId._id,
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
