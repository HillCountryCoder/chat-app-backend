import { Channel, ChannelInterface } from "../models";
import { BaseRepository } from "./base.repository";

export class ChannelRepository extends BaseRepository<ChannelInterface> {
  private static instance: ChannelRepository;

  private constructor() {
    super(Channel);
  }

  static getInstance(): ChannelRepository {
    if (!ChannelRepository.instance) {
      ChannelRepository.instance = new ChannelRepository();
    }
    return ChannelRepository.instance;
  }

  async findBySpaceId(spaceId: string): Promise<(typeof Channel.prototype)[]> {
    return this.find({ spaceId, isArchived: false });
  }

  async findActiveChannels(): Promise<(typeof Channel.prototype)[]> {
    return this.find({ isArchived: false });
  }

  async archiveChannel(
    channelId: string,
  ): Promise<typeof Channel.prototype | null> {
    return this.update(channelId, { isArchived: true });
  }

  async deleteOne(filter: any): Promise<boolean> {
    const result = await this.model.deleteOne(filter);
    return result.deletedCount > 0;
  }

  async countDocuments(filter: any): Promise<number> {
    return this.model.countDocuments(filter);
  }
}
export const channelRepository = ChannelRepository.getInstance();
