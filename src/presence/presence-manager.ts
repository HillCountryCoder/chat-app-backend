import { createClient } from "redis";
import { EventEmitter } from "events";
import { createLogger } from "../common/logger";
import { UserConnection } from "./models/user-connection.model";
import { PRESENCE_STATUS } from "./constants";

const logger = createLogger("presence-manager");
export type DeviceInfo = {
  type: "web" | "mobile" | "desktop";
  userAgent?: string;
  socketId?: string;
};
export interface PresenceStatus {
  userId: string;
  status: PRESENCE_STATUS;
  lastSeen: Date;
  deviceInfo?: DeviceInfo;
}
export interface PresenceUpdate {
  userId: string;
  connectionStatus: "online" | "offline";
  userStatus?: PRESENCE_STATUS;
  timestamp: Date;
}

export class PresenceManager extends EventEmitter {
  private redis: ReturnType<typeof createClient>;
  private heartbeatInterval: number = 30000; // 30 seconds
  private timeoutWindow: number = 60000; // 60 seconds
  private cleanupInterval: NodeJS.Timeout;

  private heartbeatTimers: Map<string, NodeJS.Timeout> = new Map();

  constructor(redisClient: ReturnType<typeof createClient>) {
    super();
    this.redis = redisClient;

    this.cleanupInterval = setInterval(() => {
      this.cleanupExpiredPresence();
    }, 60000);
  }

  /**
   * Process incoming heartbeat from client
   */
  async processHeartbeat(
    userId: string,
    status: PRESENCE_STATUS,
    deviceInfo?: DeviceInfo,
  ): Promise<void> {
    try {
      const presenceKey = `presence:${userId}`;
      const now = new Date();

      const currentPresence = await this.getUserPresence(userId);
      const wasOffline =
        !currentPresence || currentPresence.status === "offline";
      const presenceData: PresenceStatus = {
        userId,
        status,
        lastSeen: now,
        deviceInfo,
      };

      await this.redis.setEx(
        presenceKey,
        Math.ceil(this.timeoutWindow / 1000),
        JSON.stringify(presenceData),
      );

      if (wasOffline) {
        logger.info(`User ${userId} came online`);
        this.emit("userOnline", { userId, status, timestamp: now });
        await this.broadcastPresenceChange(userId, "online", status);
      } else {
        // Just update status if it changed
        if (currentPresence && currentPresence.status !== status) {
          this.emit("statusChanged", {
            userId,
            oldStatus: currentPresence.status,
            newStatus: status,
            timestamp: now,
          });
          await this.broadcastPresenceChange(userId, "online", status);
        }
      }

      this.resetOfflineTimer(userId);
    } catch (error) {
      logger.error("Error processing heartbeat:", error);
    }
  }
  /**
   * Get user's current presence status
   */
  async getUserPresence(userId: string): Promise<PresenceStatus | null> {
    try {
      const presenceKey = `presence:${userId}`;
      const data = await this.redis.get(presenceKey);
      if (!data) {
        return null;
      }

      const presence: PresenceStatus = JSON.parse(data);
      presence.lastSeen = new Date(presence.lastSeen);

      return presence;
    } catch (error) {
      logger.error("Error getting user presence:", error);
      return null;
    }
  }

  /**
   * Get presence status for multiple users
   */

  async getBulkPresence(
    userIds: string[],
  ): Promise<Map<string, PresenceStatus>> {
    const presenceMap = new Map<string, PresenceStatus>();

    try {
      const multi = this.redis.multi();
      userIds.forEach((userId) => {
        multi.get(`presence:${userId}`);
      });

      const results = await multi.exec();
      results?.forEach((result, index) => {
        if (result && Array.isArray(result) && result.length > 1 && result[1]) {
          const presence: PresenceStatus = JSON.parse(result[1] as string);
          presence.lastSeen = new Date(presence.lastSeen);
          presenceMap.set(userIds[index], presence);
        }
      });
    } catch (error) {
      logger.error("Error getting bulk presence:", error);
    }
    return presenceMap;
  }

  /**
   * Mark user as offline (called when socket disconnects)
   */

  async setUserOffline(userId: string): Promise<void> {
    try {
      const presenceKey = `presence:${userId}`;
      const currentPresence = await this.getUserPresence(userId);

      if (currentPresence && currentPresence.status !== "offline") {
        const offlinePresence: PresenceStatus = {
          ...currentPresence,
          status: PRESENCE_STATUS.OFFLINE,
          lastSeen: new Date(),
        };

        // Store offline status for 24 hours for "last seen" functionality
        await this.redis.setEx(
          presenceKey,
          86400,
          JSON.stringify(offlinePresence),
        );

        logger.info(`User ${userId} went offline`);
        this.emit("userOffline", { userId, timestamp: new Date() });

        // Broadcast to user's connections
        await this.broadcastPresenceChange(userId, "offline");

        // Clear offline timer
        this.clearOfflineTimer(userId);
      }
    } catch (error) {
      logger.error("Error setting user offline:", error);
    }
  }

  async getOnlineUsers(
    limit: number = 100,
    cursor: string = "0",
  ): Promise<{
    users: PresenceStatus[];
    nextCursor: string;
  }> {
    try {
      const scanResult = await this.redis.scan(parseInt(cursor), {
        MATCH: `presence:*`,
        COUNT: limit,
      });

      const newCursor = scanResult.cursor.toString();
      const keys = scanResult.keys;
      logger.debug("🔍 Redis scan result:", {
        cursor: scanResult.cursor,
        keysFound: scanResult.keys.length,
        keys: scanResult.keys,
      });
      const onlineUsers: PresenceStatus[] = [];
      if (keys.length > 0) {
        const multi = this.redis.multi();
        keys.forEach((key) => multi.get(key));
        const results = await multi.exec();

        results?.forEach((result, index) => {
          if (result && Array.isArray(result) && result[1]) {
            try {
              const presence: PresenceStatus = JSON.parse(result[1] as string);
              if (presence.status !== "offline") {
                presence.lastSeen = new Date(presence.lastSeen);
                onlineUsers.push(presence);
              }
            } catch (e) {
              logger.error(`Failed to parse presence for ${keys[index]}:`, e);
            }
          } else if (typeof result === "string") {
            // Handle direct string case
            try {
              const presence: PresenceStatus = JSON.parse(result);
              if (presence.status !== "offline") {
                presence.lastSeen = new Date(presence.lastSeen);
                onlineUsers.push(presence);
              }
            } catch (e) {
              logger.error(`Failed to parse presence for ${keys[index]}:`, e);
            }
          }
        });
      }

      return {
        users: onlineUsers,
        nextCursor: newCursor,
      };
    } catch (error) {
      logger.error("Error getting online users:", error);
      return { users: [], nextCursor: "0" };
    }
  }
  /**
   * Reset offline timer for user
   */
  private resetOfflineTimer(userId: string): void {
    this.clearOfflineTimer(userId);

    const timer = setTimeout(async () => {
      await this.setUserOffline(userId);
    }, this.timeoutWindow);
    this.heartbeatTimers.set(userId, timer);
    logger.debug(`Reset offline timer for user ${userId}`);
  }

  /**
   * Clear offline timer for user
   */
  private clearOfflineTimer(userId: string): void {
    const existingTimer = this.heartbeatTimers.get(userId);
    if (existingTimer) {
      clearTimeout(existingTimer);
      this.heartbeatTimers.delete(userId);
    }
  }
  /**
   * Broadcast presence change to user's connections
   */
  private async broadcastPresenceChange(
    userId: string,
    connectionStatus: "online" | "offline",
    userStatus?: PRESENCE_STATUS,
  ): Promise<void> {
    try {
      const connections = await this.getUserConnections(userId);
      const presenceUpdate: PresenceUpdate = {
        userId,
        connectionStatus,
        userStatus,
        timestamp: new Date(),
      };
      // Emit to Socket.IO for real-time broadcast
      this.emit("broadcastPresence", { connections, presenceUpdate });
    } catch (error) {
      logger.error("Error broadcasting presence change:", error);
    }
  }
  /**
   * Get user's connections (friends, contacts, etc.)
   */
  private async getUserConnections(userId: string): Promise<string[]> {
    try {
      const connections = await UserConnection.find(
        { userId },
        "connectionId",
      ).lean();
      return connections.map((conn) => conn.connectionId);
    } catch (error) {
      logger.error("Error getting user connections:", error);
      return [];
    }
  }
  /**
   * Cleanup expired presence entries
   */
  private async cleanupExpiredPresence(): Promise<void> {
    try {
      const cursor = "0";
      const scanResult = await this.redis.scan(parseInt(cursor), {
        MATCH: "presence:*",
        COUNT: 1000,
      });
      const keys = scanResult.keys;

      // Add code to handle expired keys
      if (keys.length > 0) {
        logger.debug(
          `Found ${keys.length} presence keys to check for expiration`,
        );
        // Process the keys here
        for (const key of keys) {
          const ttl = await this.redis.ttl(key);
          if (ttl === -1) {
            await this.redis.expire(key, 84600); // Set default expiration to 24 hours
          }
        }
      }
    } catch (error) {
      logger.error("Error during presence cleanup:", error);
    }
  }

  /**
   * Get presence statistics for monitoring
   */
  async getPresenceStats(): Promise<{
    totalOnline: number;
    statusBreakdown: Record<string, number>;
    deviceBreakdown: Record<string, number>;
  }> {
    try {
      const onlineUsers = await this.getOnlineUsers(1000);
      const stats = {
        totalOnline: onlineUsers.users.length,
        statusBreakdown: {
          online: onlineUsers.users.filter((u) => u.status === "online").length,
          away: onlineUsers.users.filter((u) => u.status === "away").length,
          busy: onlineUsers.users.filter((u) => u.status === "busy").length,
        },
        deviceBreakdown: {
          web: onlineUsers.users.filter((u) => u.deviceInfo?.type === "web")
            .length,
          mobile: onlineUsers.users.filter(
            (u) => u.deviceInfo?.type === "mobile",
          ).length,
          desktop: onlineUsers.users.filter(
            (u) => u.deviceInfo?.type === "desktop",
          ).length,
        },
      };
      return stats;
    } catch (error) {
      logger.error("Error getting presence stats:", error);
      return {
        totalOnline: 0,
        statusBreakdown: { online: 0, away: 0, busy: 0 },
        deviceBreakdown: { web: 0, mobile: 0, desktop: 0 },
      };
    }
  }
  /**
   * Graceful shutdown
   */
  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }

    // Clear all heartbeat timers
    this.heartbeatTimers.forEach((timer) => clearTimeout(timer));
    this.heartbeatTimers.clear();

    this.removeAllListeners();
  }
}
