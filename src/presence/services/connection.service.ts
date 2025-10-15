import { createLogger } from "../../common/logger";
import { runInTenantContext, tenantContext } from "../../plugins/tenantPlugin";
import { CONNECTION_TYPE } from "../constants";
import {
  UserConnection,
  IUserConnection,
} from "../models/user-connection.model";

const logger = createLogger("connection-service");
type ConnectionQuery = {
  userId?: string;
  tenantId?: string;
  connectionId?: string;
  connectionType?:
    | CONNECTION_TYPE.DIRECT_MESSAGE
    | CONNECTION_TYPE.CHANNEL_MEMBER;
  directMessageId?: string;
  channelId?: string;
  $or?: Array<{
    userId?: string;
    tenantId?: string;
    connectionId?: string;
  }>;
};
export class ConnectionService {
  private static getTenantId(): string {
    const context = tenantContext.getStore();
    if (!context?.tenantId) {
      throw new Error("Connection operation without tenant context");
    }
    return context.tenantId;
  }
  /**
   * Add connection when users start a direct message
   */
  static async addDirectMessageConnection(
    userId1: string,
    userId2: string,
    directMessageId: string,
  ): Promise<void> {
    return runInTenantContext(this.getTenantId(), async () => {
      try {
        const connections = [
          {
            userId: userId1,
            connectionId: userId2,
            connectionType: CONNECTION_TYPE.DIRECT_MESSAGE as const,
            directMessageId,
          },
          {
            userId: userId2,
            connectionId: userId1,
            connectionType: CONNECTION_TYPE.DIRECT_MESSAGE as const,
            directMessageId,
          },
        ];

        await UserConnection.insertMany(connections, { ordered: false });
        logger.info(`Added DM connection between ${userId1} and ${userId2}`);
      } catch (error: unknown) {
        const mongoError = error as { code?: number };
        if (mongoError.code !== 11000) {
          // Ignore duplicate key errors
          logger.error("Error adding DM connection:", error);
          throw error;
        }
      }
    });
  }

  /**
   * Add connections when users join a channel
   */
  static async addChannelMemberConnections(
    channelId: string,
    memberIds: string[],
  ): Promise<void> {
    return runInTenantContext(this.getTenantId(), async () => {
      try {
        const connections: IUserConnection[] = [];

        // Create connections between all members in the channel
        for (let i = 0; i < memberIds.length; i++) {
          for (let j = i + 1; j < memberIds.length; j++) {
            connections.push(
              {
                userId: memberIds[i],
                connectionId: memberIds[j],
                connectionType: CONNECTION_TYPE.CHANNEL_MEMBER,
                channelId,
              } as IUserConnection,
              {
                userId: memberIds[j],
                connectionId: memberIds[i],
                connectionType: CONNECTION_TYPE.CHANNEL_MEMBER,
                channelId,
              } as IUserConnection,
            );
          }
        }

        if (connections.length > 0) {
          await UserConnection.insertMany(connections, { ordered: false });
        }

        logger.info(
          `Added ${memberIds.length} members to channel ${channelId}`,
        );
      } catch (error: unknown) {
        const mongoError = error as { code?: number };
        if (mongoError.code !== 11000) {
          logger.error("Error adding channel members:", error);
          throw error;
        }
      }
    });
  }

  /**
   * Generic method to add any type of connection (backward compatibility)
   */
  static async addConnection(
    userId: string,
    connectionId: string,
    type: CONNECTION_TYPE.DIRECT_MESSAGE | CONNECTION_TYPE.CHANNEL_MEMBER,
    contextId?: string, // directMessageId or channelId
  ): Promise<void> {
    return runInTenantContext(this.getTenantId(), async () => {
      try {
        const connectionData: ConnectionQuery = {
          userId,
          tenantId: this.getTenantId(),
          connectionId,
          connectionType: type,
        };

        // Add context ID based on type
        if (type === CONNECTION_TYPE.DIRECT_MESSAGE && contextId) {
          connectionData.directMessageId = contextId;
        } else if (type === "channel_member" && contextId) {
          connectionData.channelId = contextId;
        }

        // Add bidirectional connection
        const connections = [
          connectionData,
          {
            userId: connectionId,
            connectionId: userId,
            connectionType: type,
            ...(type === CONNECTION_TYPE.DIRECT_MESSAGE &&
              contextId && { directMessageId: contextId }),
            ...(type === "channel_member" &&
              contextId && { channelId: contextId }),
          },
        ];

        await UserConnection.insertMany(connections, { ordered: false });
        logger.info(
          `Added ${type} connection between ${userId} and ${connectionId}`,
        );
      } catch (error: unknown) {
        const mongoError = error as { code?: number };
        if (mongoError.code !== 11000) {
          logger.error("Error adding connection:", error);
          throw error;
        }
      }
    });
  }

  /**
   * Remove connection between two users
   */
  static async removeConnection(
    userId: string,
    connectionId: string,
    type?: CONNECTION_TYPE.DIRECT_MESSAGE | CONNECTION_TYPE.CHANNEL_MEMBER,
    contextId?: string, // directMessageId or channelId
  ): Promise<void> {
    return runInTenantContext(this.getTenantId(), async () => {
      const tenantId = this.getTenantId();
      try {
        const query: ConnectionQuery = {
          $or: [
            { userId, tenantId, connectionId },
            { userId: connectionId, connectionId: userId },
          ],
        };

        if (type) {
          query.connectionType = type;
        }

        if (contextId) {
          if (type === CONNECTION_TYPE.DIRECT_MESSAGE) {
            query.directMessageId = contextId;
          } else if (type === "channel_member") {
            query.channelId = contextId;
          }
        }

        await UserConnection.deleteMany(query);
        logger.info(
          `Removed ${
            type || "any"
          } connection between ${userId} and ${connectionId}`,
        );
      } catch (error) {
        logger.error("Error removing connection:", error);
        throw error;
      }
    });
  }

  /**
   * Remove connection when direct message is deleted (optional)
   */
  static async removeDirectMessageConnection(
    directMessageId: string,
  ): Promise<void> {
    return runInTenantContext(this.getTenantId(), async () => {
      try {
        await UserConnection.deleteMany({
          directMessageId,
          connectionType: CONNECTION_TYPE.DIRECT_MESSAGE,
          tenantId: this.getTenantId(),
        });

        logger.info(`Removed DM connections for ${directMessageId}`);
      } catch (error) {
        logger.error("Error removing DM connection:", error);
        throw error;
      }
    });
  }

  /**
   * Remove member from channel
   */
  static async removeChannelMember(
    channelId: string,
    memberId: string,
  ): Promise<void> {
    return runInTenantContext(this.getTenantId(), async () => {
      try {
        await UserConnection.deleteMany({
          channelId,
          connectionType: "channel_member",
          $or: [
            { userId: memberId },
            { tenantId: this.getTenantId() },
            { connectionId: memberId },
          ],
        });

        logger.info(`Removed member ${memberId} from channel ${channelId}`);
      } catch (error) {
        logger.error("Error removing channel member:", error);
        throw error;
      }
    });
  }

  /**
   * Get all connections for a user (for presence broadcasting)
   */
  static async getUserConnections(
    userId: string,
    type?: CONNECTION_TYPE.DIRECT_MESSAGE | CONNECTION_TYPE.CHANNEL_MEMBER,
  ): Promise<string[]> {
    return runInTenantContext(this.getTenantId(), async () => {
      try {
        const query: ConnectionQuery = { userId, tenantId: this.getTenantId() };
        if (type) {
          query.connectionType = type;
        }

        const connections = await UserConnection.find(
          query,
          "connectionId",
        ).lean();
        return [...new Set(connections.map((conn) => conn.connectionId))];
      } catch (error) {
        logger.error("Error getting user connections:", error);
        return [];
      }
    });
  }

  /**
   * Get all members of a channel
   */
  static async getChannelMembers(channelId: string): Promise<string[]> {
    return runInTenantContext(this.getTenantId(), async () => {
      try {
        const connections = await UserConnection.find(
          {
            channelId,
            connectionType: "channel_member",
            tenantId: this.getTenantId(),
          },
          "userId",
        ).lean();

        return [...new Set(connections.map((conn) => conn.userId))];
      } catch (error) {
        logger.error("Error getting channel members:", error);
        return [];
      }
    });
  }

  /**
   * Get connections for channel members (alias for backward compatibility)
   */
  static async getChannelConnections(channelId: string): Promise<string[]> {
    return this.getChannelMembers(channelId);
  }

  /**
   * Get users in direct message with specific user
   */
  static async getDirectMessageConnections(userId: string): Promise<string[]> {
    return runInTenantContext(this.getTenantId(), async () => {
      try {
        const connections = await UserConnection.find(
          {
            userId,
            connectionType: CONNECTION_TYPE.DIRECT_MESSAGE,
            tenantId: this.getTenantId(),
          },
          "connectionId",
        ).lean();

        return connections.map((conn) => conn.connectionId);
      } catch (error) {
        logger.error("Error getting DM connections:", error);
        return [];
      }
    });
  }

  /**
   * Check if two users are connected
   */
  static async areUsersConnected(
    userId: string,
    connectionId: string,
    type?: CONNECTION_TYPE.DIRECT_MESSAGE | CONNECTION_TYPE.CHANNEL_MEMBER,
  ): Promise<boolean> {
    return runInTenantContext(this.getTenantId(), async () => {
      try {
        const query: {
          userId: string;
          tenantId: string;
          connectionId: string;
          connectionType?:
            | CONNECTION_TYPE.DIRECT_MESSAGE
            | CONNECTION_TYPE.CHANNEL_MEMBER;
        } = { userId, connectionId, tenantId: this.getTenantId() };
        if (type) {
          query.connectionType = type;
        }

        const connection = await UserConnection.findOne(query).lean();
        return !!connection;
      } catch (error) {
        logger.error("Error checking user connection:", error);
        return false;
      }
    });
  }

  /**
   * Check if users are connected via direct message
   */
  static async areUsersInDirectMessage(
    userId: string,
    connectionId: string,
  ): Promise<boolean> {
    return this.areUsersConnected(
      userId,
      connectionId,
      CONNECTION_TYPE.DIRECT_MESSAGE,
    );
  }

  /**
   * Check if users are connected via channel
   */
  static async areUsersInSameChannel(
    userId: string,
    connectionId: string,
    channelId?: string,
  ): Promise<boolean> {
    return runInTenantContext(this.getTenantId(), async () => {
      try {
        const query: {
          userId: string;
          connectionId: string;
          connectionType: CONNECTION_TYPE;
          channelId?: string;
        } = {
          userId,
          connectionId,
          connectionType: CONNECTION_TYPE.CHANNEL_MEMBER,
        };

        if (channelId) {
          query.channelId = channelId;
        }

        const connection = await UserConnection.findOne(query).lean();
        return !!connection;
      } catch (error) {
        logger.error("Error checking channel connection:", error);
        return false;
      }
    });
  }

  /**
   * Get connection details between users
   */
  static async getConnectionDetails(
    userId: string,
    connectionId: string,
  ): Promise<IUserConnection[]> {
    return runInTenantContext(this.getTenantId(), async () => {
      try {
        const connections = await UserConnection.find({
          userId,
          connectionId,
        }).lean();

        return connections;
      } catch (error) {
        logger.error("Error getting connection details:", error);
        return [];
      }
    });
  }

  /**
   * Get all direct message connections for a user with details
   */
  static async getUserDirectMessageConnections(
    userId: string,
  ): Promise<IUserConnection[]> {
    return runInTenantContext(this.getTenantId(), async () => {
      try {
        const connections = await UserConnection.find({
          userId,
          connectionType: CONNECTION_TYPE.DIRECT_MESSAGE,
        }).lean();

        return connections;
      } catch (error) {
        logger.error("Error getting user DM connections:", error);
        return [];
      }
    });
  }

  /**
   * Get all channel connections for a user with details
   */
  static async getUserChannelConnections(
    userId: string,
  ): Promise<IUserConnection[]> {
    return runInTenantContext(this.getTenantId(), async () => {
      try {
        const connections = await UserConnection.find({
          userId,
          connectionType: "channel_member",
        }).lean();

        return connections;
      } catch (error) {
        logger.error("Error getting user channel connections:", error);
        return [];
      }
    });
  }

  /**
   * Get channels where two users are both members
   */
  static async getSharedChannels(
    userId1: string,
    userId2: string,
  ): Promise<string[]> {
    return runInTenantContext(this.getTenantId(), async () => {
      try {
        // Get all channels for user1
        const user1Channels = await UserConnection.find(
          {
            userId: userId1,
            connectionType: "channel_member",
          },
          "channelId",
        ).lean();

        // Get all channels for user2
        const user2Channels = await UserConnection.find(
          {
            userId: userId2,
            connectionType: "channel_member",
          },
          "channelId",
        ).lean();

        const user1ChannelIds = user1Channels.map((c) => c.channelId);
        const user2ChannelIds = user2Channels.map((c) => c.channelId);

        // Find intersection
        const sharedChannels = user1ChannelIds.filter(
          (channelId) => channelId && user2ChannelIds.includes(channelId),
        );

        // Filter out any undefined values to ensure string[] type
        return [...new Set(sharedChannels)].filter(
          (channelId): channelId is string => channelId !== undefined,
        );
      } catch (error) {
        logger.error("Error getting shared channels:", error);
        return [];
      }
    });
  }

  /**
   * Get connection statistics for a user
   */
  static async getUserConnectionStats(userId: string): Promise<{
    totalConnections: number;
    directMessageConnections: number;
    channelConnections: number;
    uniqueChannels: number;
  }> {
    return runInTenantContext(this.getTenantId(), async () => {
      try {
        const [dmConnections, channelConnections] = await Promise.all([
          UserConnection.countDocuments({
            userId,
            connectionType: CONNECTION_TYPE.DIRECT_MESSAGE,
          }),
          UserConnection.find(
            {
              userId,
              connectionType: "channel_member",
            },
            "channelId",
          ).lean(),
        ]);

        const uniqueChannels = [
          ...new Set(channelConnections.map((c) => c.channelId)),
        ].length;

        return {
          totalConnections: dmConnections + channelConnections.length,
          directMessageConnections: dmConnections,
          channelConnections: channelConnections.length,
          uniqueChannels,
        };
      } catch (error) {
        logger.error("Error getting user connection stats:", error);
        return {
          totalConnections: 0,
          directMessageConnections: 0,
          channelConnections: 0,
          uniqueChannels: 0,
        };
      }
    });
  }

  /**
   * Clean up orphaned connections (connections without valid DM or channel)
   */
  static async cleanupOrphanedConnections(): Promise<number> {
    try {
      // This would require checking against your DirectMessage and Channel models
      // For now, return 0 - implement based on your specific models
      logger.info(
        "Cleanup orphaned connections - implement based on your models",
      );
      return 0;
    } catch (error) {
      logger.error("Error cleaning up orphaned connections:", error);
      return 0;
    }
  }

  /**
   * Bulk add channel members (more efficient for large channels)
   */
  static async bulkAddChannelMembers(
    channelId: string,
    memberIds: string[],
  ): Promise<void> {
    // Use the existing addChannelMemberConnections method
    return this.addChannelMemberConnections(channelId, memberIds);
  }

  /**
   * Add single member to existing channel (handles existing members)
   */
  static async addMemberToChannel(
    channelId: string,
    newMemberId: string,
  ): Promise<void> {
    return runInTenantContext(this.getTenantId(), async () => {
      try {
        // Get existing members
        const existingMembers = await this.getChannelMembers(channelId);

        // Add connections between new member and all existing members
        const connections: IUserConnection[] = [];

        existingMembers.forEach((existingMemberId) => {
          if (existingMemberId !== newMemberId) {
            connections.push(
              {
                userId: newMemberId,
                connectionId: existingMemberId,
                connectionType: "channel_member",
                channelId,
              } as IUserConnection,
              {
                userId: existingMemberId,
                connectionId: newMemberId,
                connectionType: "channel_member",
                channelId,
              } as IUserConnection,
            );
          }
        });

        if (connections.length > 0) {
          await UserConnection.insertMany(connections, { ordered: false });
        }

        logger.info(`Added member ${newMemberId} to channel ${channelId}`);
      } catch (error: unknown) {
        const mongoError = error as { code?: number };
        if (mongoError.code !== 11000) {
          logger.error("Error adding member to channel:", error);
          throw error;
        }
      }
    });
  }

  // Legacy method aliases for backward compatibility
  static async addChannelMembers(
    channelId: string,
    memberIds: string[],
  ): Promise<void> {
    return this.addChannelMemberConnections(channelId, memberIds);
  }
}
