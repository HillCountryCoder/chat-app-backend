import { ChannelMember, ChannelMemberInterface } from "../models";
import { BaseRepository } from "./base.repository";

export class ChannelMemberRepository extends BaseRepository<ChannelMemberInterface> {
  private static instance: ChannelMemberRepository;

  private constructor() {
    super(ChannelMember);
  }

  static getInstance(): ChannelMemberRepository {
    if (!ChannelMemberRepository.instance) {
      ChannelMemberRepository.instance = new ChannelMemberRepository();
    }
    return ChannelMemberRepository.instance;
  }

  async findByChannelId(
    channelId: string,
  ): Promise<(typeof ChannelMember.prototype)[]> {
    return this.find({ channelId });
  }

  async findByUserId(
    userId: string,
  ): Promise<(typeof ChannelMember.prototype)[]> {
    return this.find({ userId });
  }

  async findMembership(
    channelId: string,
    userId: string,
  ): Promise<typeof ChannelMember.prototype | null> {
    return this.findOne({ channelId, userId });
  }

  async deleteOne(filter: any): Promise<boolean> {
    const result = await this.model.deleteOne(filter);
    return result.deletedCount > 0;
  }

  async countDocuments(filter: any): Promise<number> {
    return this.model.countDocuments(filter);
  }

  async updateNotificationPreference(
    channelId: string,
    userId: string,
    preference: string,
  ): Promise<typeof ChannelMember.prototype | null> {
    return this.findOneAndUpdate(
      { channelId, userId },
      { notificationPreference: preference },
    );
  }

  async findOneAndUpdate(
    filter: any,
    update: any,
  ): Promise<typeof ChannelMember.prototype | null> {
    return this.model.findOneAndUpdate(filter, update, { new: true });
  }
}

export const channelMemberRepository = ChannelMemberRepository.getInstance();
