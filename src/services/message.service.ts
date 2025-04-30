import { MessageInterface, Reaction } from "../models";
import { messageRepository } from "../repositories/message.repository";
import { NotFoundError } from "../common/errors";

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

  findReactionByEmoji(emoji: string, message: MessageInterface): Reaction {
    const reaction = message.reactions.find((r) => r.emoji === emoji);
    if (reaction) {
      return reaction;
    } else {
      throw new NotFoundError("reaction");
    }
  }
}
