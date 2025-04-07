import { DirectMessage, DirectMessageInterface } from "../models";
import { BaseRepository } from "./base.repository";

export class DirectMessageRepository extends BaseRepository<DirectMessageInterface> {
  private static instance: DirectMessageRepository;

  private constructor() {
    super(DirectMessage);
  }

  static getInstance(): DirectMessageRepository {
    if (!DirectMessageRepository.instance) {
      DirectMessageRepository.instance = new DirectMessageRepository();
    }
    return DirectMessageRepository.instance;
  }

  async findByParticipants(
    userId1: string,
    userId2: string,
  ): Promise<DirectMessageInterface | null> {
    const sortedParticipantIds = [userId1, userId2].sort();

    return this.findOne({
      participantIds: { $all: sortedParticipantIds },
      $expr: { $eq: [{ $size: "$participantIds" }, 2] },
    });
  }

  async findAllByUserId(userId: string): Promise<DirectMessageInterface[]> {
    return this.find({
      participantIds: userId,
    });
  }
}

export const directMessageRepository = DirectMessageRepository.getInstance();
