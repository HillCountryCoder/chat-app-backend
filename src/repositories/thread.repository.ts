// src/repositories/thread.repository.ts
import { Thread } from "../models/thread.model";
import { BaseRepository } from "./base.repository";

export class ThreadRepository extends BaseRepository<typeof Thread.prototype> {
  private static instance: ThreadRepository;

  private constructor() {
    super(Thread);
  }

  static getInstance(): ThreadRepository {
    if (!ThreadRepository.instance) {
      ThreadRepository.instance = new ThreadRepository();
    }
    return ThreadRepository.instance;
  }

  async findByChannelId(
    channelId: string,
  ): Promise<(typeof Thread.prototype)[]> {
    return this.find({ channelId });
  }

  async findByParentMessageId(
    messageId: string,
  ): Promise<typeof Thread.prototype | null> {
    return this.findOne({ parentMessageId: messageId });
  }

  async findByParticipant(
    userId: string,
  ): Promise<(typeof Thread.prototype)[]> {
    return this.find({ participantIds: userId });
  }
}

export const threadRepository = ThreadRepository.getInstance();
