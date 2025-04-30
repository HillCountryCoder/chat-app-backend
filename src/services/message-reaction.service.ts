import { MessageInterface, Reaction } from "../models";
import mongoose from "mongoose";
import { MessageService } from "./message.service";

export class MessageReactionService {
  private static instance: MessageReactionService;
  private readonly messageService: MessageService;
  private constructor() {
	this.messageService = MessageService.getInstance();
  }

  static getInstance(): MessageReactionService {
    if (!MessageReactionService.instance) {
      MessageReactionService.instance = new MessageReactionService();
    }
    return MessageReactionService.instance;
  }

  /**
   * Add a reaction to a message
   */
  async addReaction(
    messageId: string,
    userId: string,
    emoji: string,
  ): Promise<MessageInterface> {
    const message: MessageInterface =
      await this.messageService.getMessageByIdOrThrowError(messageId);

    const existingReaction = message.reactions.find(
      (reaction) =>
        reaction.emoji === emoji &&
        reaction.users.some(
          (id) =>
            id.toString() === userId ||
            (id instanceof mongoose.Types.ObjectId && id.equals(userId)),
        ),
    );
    if (existingReaction) {
      return message;
    }

    const reaction = this.messageService.findReactionByEmoji(emoji, message);

    if (reaction) {
      reaction.users.push(new mongoose.Types.ObjectId(userId));
      reaction.count = reaction.users.length;
    } else {
      message.reactions.push({
        emoji,
        count: 1,
        users: [new mongoose.Types.ObjectId(userId)],
      });
    }
    // Save and return updated message
    await message.save();
    return message;
  }
  /**
   * Remove a reaction from a message
   */
  async removeReaction(
    messageId: string,
    userId: string,
    emoji: string,
  ): Promise<MessageInterface> {
    const message = await this.messageService.getMessageByIdOrThrowError(
      messageId,
    );

    const reaction = this.messageService.findReactionByEmoji(emoji, message);

    if (!reaction) {
      return message;
    }

    const userIndex = reaction.users.findIndex(
      (id) =>
        id.toString() === userId ||
        (id instanceof mongoose.Types.ObjectId && id.equals(userId)),
    );

    if (userIndex === -1) {
      return message;
    }

    reaction.users.splice(userIndex, 1);
    reaction.count = reaction.users.length;

    if (reaction.count === 0) {
      message.reactions = message.reactions.filter((r) => r.emoji !== emoji);
    }

    // Save and return updated message
    await message.save();
    return message;
  }

  /**
   * Get all reactions for a message
   */
  async getReactions(messageId: string): Promise<Reaction[]> {
    const message = await this.messageService.getMessageByIdOrThrowError(
      messageId,
    );

    return message.reactions;
  }
}

export const messageReactionService = MessageReactionService.getInstance();
