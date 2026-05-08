import { DirectMessage, DirectMessageInterface } from "../models";
import mongoose from "mongoose";
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
      deletedBy: { $nin: [new mongoose.Types.ObjectId(userId)] },
    });
  }

  async deleteForUser(
    dmId: string,
    userId: string,
  ): Promise<DirectMessageInterface | null> {
    return this.model.findByIdAndUpdate(
      dmId,
      {
        $addToSet: { deletedBy: new mongoose.Types.ObjectId(userId) },
        $set: { [`deletedAt.${userId}`]: new Date() },
      },
      { new: true },
    );
  }

  async restoreForUser(
    dmId: string,
    userId: string,
  ): Promise<DirectMessageInterface | null> {
    return this.model.findByIdAndUpdate(
      dmId,
      {
        $pull: { deletedBy: new mongoose.Types.ObjectId(userId) },
        $unset: { [`deletedAt.${userId}`]: "" },
      },
      { new: true },
    );
  }

  async restoreForParticipants(
    dmId: string,
    userIds: string[],
  ): Promise<DirectMessageInterface | null> {
    if (!userIds.length) {
      return this.findById(dmId);
    }

    return this.model.findByIdAndUpdate(
      dmId,
      {
        $pull: {
          deletedBy: {
            $in: userIds.map((id) => new mongoose.Types.ObjectId(id)),
          },
        },
      },
      { new: true },
    );
  }
}

export const directMessageRepository = DirectMessageRepository.getInstance();
