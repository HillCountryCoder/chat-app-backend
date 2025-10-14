import { createLogger } from "../common/logger";
import { redisClient } from "../common/redis/client";
import { tenantContext } from "../plugins/tenantPlugin";
const logger = createLogger("unread-messages-service");

export class UnreadMessagesService {
  private static instance: UnreadMessagesService;

  private constructor() {}
  static getInstance(): UnreadMessagesService {
    if (!UnreadMessagesService.instance) {
      UnreadMessagesService.instance = new UnreadMessagesService();
    }
    return UnreadMessagesService.instance;
  }
  /**
   * Get Redis key for user unread messages in a direct message
   */
  private getDirectMessageUnreadKey(
    userId: string,
    directMessageId: string,
  ): string {
    const tenantId = this.getTenantId();
    return `tenant:${tenantId}:unread:dm:${userId}:${directMessageId}`;
  }
  /**
   * Get Redis key for user unread messages in a channel
   */
  private getChannelUnreadKey(userId: string, channelId: string): string {
    const tenantId = this.getTenantId();
    return `tenant:${tenantId}:unread:channel:${userId}:${channelId}`;
  }
  /**
   * Increment unread count for all recipients of a message
   * @param messageType 'dm' | 'channel'
   * @param messageId Direct message ID or channel ID
   * @param senderId User who sent the message
   * @param recipientIds Users who should receive the unread count
   */
  async incrementUnreadCount(
    messageType: "dm" | "channel",
    messageId: string,
    senderId: string,
    recipientIds: string[],
  ): Promise<void> {
    try {
      const pipeline = redisClient.multi();
      const recipients = recipientIds.filter((id) => id !== senderId);
      for (const recipientId of recipients) {
        const key =
          messageType === "dm"
            ? this.getDirectMessageUnreadKey(recipientId, messageId)
            : this.getChannelUnreadKey(recipientId, messageId);

        pipeline.incr(key);
        // Set expiration time to 30 days
        pipeline.expire(key, 60 * 60 * 24 * 30);
      }
      await pipeline.exec();
    } catch (error) {
      logger.error("Error incrementing unread count", { error });
      throw error;
    }
  }
  /**
   * Get unread count for a specific conversation
   */
  async getUnreadCount(
    userId: string,
    messageType: "dm" | "channel",
    messageId: string,
  ): Promise<number> {
    try {
      const key =
        messageType === "dm"
          ? this.getDirectMessageUnreadKey(userId, messageId)
          : this.getChannelUnreadKey(userId, messageId);

      const count = await redisClient.get(key);
      return count ? parseInt(count, 10) : 0;
    } catch (error) {
      logger.error("Error getting unread count", { error });
      return 0;
    }
  }

  /**
   * Get unread counts for all conversations of a user
   */
  async getAllUnreadCounts(userId: string): Promise<{
    directMessages: Record<string, number>;
    channels: Record<string, number>;
  }> {
    try {
      const dmPattern = this.getDirectMessageUnreadKey(userId, "*");
      const channelPattern = this.getChannelUnreadKey(userId, "*");

      const dmKeys = await redisClient.keys(dmPattern);
      const channelKeys = await redisClient.keys(channelPattern);

      const directMessages: Record<string, number> = {};
      const channels: Record<string, number> = {};

      // Get values for direct messages
      if (dmKeys.length > 0) {
        const dmValues = await redisClient.mGet(dmKeys);

        dmKeys.forEach((key, index) => {
          // Extract the directMessageId from the key
          const parts = key.split(":");
          const directMessageId = parts[5];
          const count = parseInt(dmValues[index] || "0", 10);
          directMessages[directMessageId] = count;
        });
      }
      // Get values for channels
      if (channelKeys.length > 0) {
        // INFO: mGet gets all key values for given keys at once, if any key value is not there returns nil
        const channelValues = await redisClient.mGet(channelKeys);

        channelKeys.forEach((key, index) => {
          // Extract the channelId from the key
		  const parts = key.split(":")
          const channelId = parts[5];
          const count = parseInt(channelValues[index] || "0", 10);
          channels[channelId] = count;
        });
      }

      return { directMessages, channels };
    } catch (error) {
      logger.error("Error getting all unread counts", { error });
      return { directMessages: {}, channels: {} };
    }
  }

  /**
   * Mark messages as read for a specific conversation
   */
  async markAsRead(
    userId: string,
    messageType: "dm" | "channel",
    messageId: string,
  ): Promise<void> {
    try {
      const key =
        messageType === "dm"
          ? this.getDirectMessageUnreadKey(userId, messageId)
          : this.getChannelUnreadKey(userId, messageId);
      await redisClient.del(key);
    } catch (error) {
      logger.error("Error marking messages as read", { error });
      throw error;
    }
  }

  /**
   * Get the total unread count for a user
   */
  async getTotalUnreadCount(userId: string): Promise<number> {
    try {
      const { directMessages, channels } = await this.getAllUnreadCounts(
        userId,
      );
      const directMessageTotal = Object.values(directMessages).reduce(
        (sum, count) => sum + count,
        0,
      );
      const channelTotal = Object.values(channels).reduce(
        (sum, count) => sum + count,
        0,
      );

      return directMessageTotal + channelTotal;
    } catch (error) {
      logger.error("Error getting total unread count", { error });
      return 0;
    }
  }

  private getTenantId(): string {
    const context = tenantContext.getStore();
    if (!context?.tenantId) {
      throw new Error("Operation attempted without tenant context");
    }
    return context.tenantId;
  }
}
export const unreadMessagesService = UnreadMessagesService.getInstance();
