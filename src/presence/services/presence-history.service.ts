/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  PresenceHistory,
  IPresenceHistory,
} from "../models/presence-history.model";
import { createLogger } from "../../common/logger";
import { runInTenantContext, tenantContext } from "../../plugins/tenantPlugin";

const logger = createLogger("presence-history-service");

export class PresenceHistoryService {
  private static getTenantId(): string {
    const context = tenantContext.getStore();
    if (!context?.tenantId) {
      throw new Error("Presence operation without tenant context");
    }
    return context.tenantId;
  }
  /**
   * Record a presence session
   */
  static async recordSession(
    userId: string,
    status: "online" | "away" | "busy",
    deviceInfo: any,
  ): Promise<string> {
    return runInTenantContext(this.getTenantId(), async () => {
      try {
        const session = new PresenceHistory({
          userId,
          status,
          sessionStart: new Date(),
          deviceInfo,
        });

        await session.save();
        logger.info(`Started presence session for user ${userId}`);
        return session._id.toString();
      } catch (error) {
        logger.error("Error recording presence session:", error);
        throw error;
      }
    });
  }
  /**
   * End a presence session
   */
  static async endSession(sessionId: string): Promise<void> {
    return runInTenantContext(this.getTenantId(), async () => {
      try {
        const session = await PresenceHistory.findById(sessionId);
        if (session && !session.sessionEnd) {
          session.sessionEnd = new Date();
          session.duration =
            session.sessionEnd.getTime() - session.sessionStart.getTime();
          await session.save();

          logger.info(
            `Ended presence session ${sessionId}, duration: ${session.duration}ms`,
          );
        }
      } catch (error) {
        logger.error("Error ending presence session:", error);
      }
    });
  }
  /**
   * Get user's presence history
   */
  static async getUserHistory(
    userId: string,
    options: {
      limit?: number;
      skip?: number;
      startDate?: Date;
      endDate?: Date;
    } = {},
  ): Promise<{
    history: IPresenceHistory[];
    total: number;
  }> {
    return runInTenantContext(this.getTenantId(), async () => {
      try {
        const { limit = 20, skip = 0, startDate, endDate } = options;

        const query: any = { userId };
        if (startDate || endDate) {
          query.sessionStart = {};
          if (startDate) query.sessionStart.$gte = startDate;
          if (endDate) query.sessionStart.$lte = endDate;
        }

        const [history, total] = await Promise.all([
          PresenceHistory.find(query)
            .sort({ sessionStart: -1 })
            .limit(limit)
            .skip(skip)
            .lean(),
          PresenceHistory.countDocuments(query),
        ]);

        return { history, total };
      } catch (error) {
        logger.error("Error getting user presence history:", error);
        return { history: [], total: 0 };
      }
    });
  }

  /**
   * Get presence analytics
   */
  static async getPresenceAnalytics(
    userId: string,
    startDate: Date,
    endDate: Date,
  ): Promise<{
    totalSessions: number;
    totalOnlineTime: number;
    averageSessionDuration: number;
    dailyBreakdown: Record<string, number>;
    statusBreakdown: Record<string, number>;
  }> {
    return runInTenantContext(this.getTenantId(), async () => {
      try {
        const sessions = await PresenceHistory.find({
          userId,
          sessionStart: { $gte: startDate, $lte: endDate },
          sessionEnd: { $exists: true },
        }).lean();

        const totalSessions = sessions.length;
        const totalOnlineTime = sessions.reduce(
          (sum, session) => sum + (session.duration || 0),
          0,
        );
        const averageSessionDuration =
          totalSessions > 0 ? totalOnlineTime / totalSessions : 0;

        // Daily breakdown
        const dailyBreakdown: Record<string, number> = {};
        const statusBreakdown: Record<string, number> = {};

        sessions.forEach((session) => {
          const day = session.sessionStart.toDateString();
          dailyBreakdown[day] =
            (dailyBreakdown[day] || 0) + (session.duration || 0);
          statusBreakdown[session.status] =
            (statusBreakdown[session.status] || 0) + 1;
        });

        return {
          totalSessions,
          totalOnlineTime,
          averageSessionDuration,
          dailyBreakdown,
          statusBreakdown,
        };
      } catch (error) {
        logger.error("Error getting presence analytics:", error);
        return {
          totalSessions: 0,
          totalOnlineTime: 0,
          averageSessionDuration: 0,
          dailyBreakdown: {},
          statusBreakdown: {},
        };
      }
    });
  }

  /**
   * Clean up old presence history (run daily)
   */
  static async cleanupOldHistory(daysToKeep: number = 90): Promise<number> {
    return runInTenantContext(this.getTenantId(), async () => {
      try {
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);

        const result = await PresenceHistory.deleteMany({
          sessionStart: { $lt: cutoffDate },
        });

        logger.info(
          `Cleaned up ${result.deletedCount} old presence history records`,
        );
        return result.deletedCount || 0;
      } catch (error) {
        logger.error("Error cleaning up presence history:", error);
        return 0;
      }
    });
  }

  /**
   * Get active sessions (sessions without end time)
   */
  static async getActiveSessions(): Promise<IPresenceHistory[]> {
    return runInTenantContext(this.getTenantId(), async () => {
      try {
        return await PresenceHistory.find({
          sessionEnd: { $exists: false },
        }).lean();
      } catch (error) {
        logger.error("Error getting active sessions:", error);
        return [];
      }
    });
  }

  /**
   * Get session statistics for monitoring
   */
  static async getSessionStats(): Promise<{
    activeSessions: number;
    totalSessionsToday: number;
    averageSessionLength: number;
  }> {
    return runInTenantContext(this.getTenantId(), async () => {
      try {
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const [activeSessions, todaySessions] = await Promise.all([
          PresenceHistory.countDocuments({
            sessionEnd: { $exists: false },
          }),
          PresenceHistory.find({
            sessionStart: { $gte: today },
            sessionEnd: { $exists: true },
          }).lean(),
        ]);

        const totalDuration = todaySessions.reduce(
          (sum, session) => sum + (session.duration || 0),
          0,
        );
        const averageSessionLength =
          todaySessions.length > 0 ? totalDuration / todaySessions.length : 0;

        return {
          activeSessions,
          totalSessionsToday: todaySessions.length,
          averageSessionLength,
        };
      } catch (error) {
        logger.error("Error getting session stats:", error);
        return {
          activeSessions: 0,
          totalSessionsToday: 0,
          averageSessionLength: 0,
        };
      }
    });
  }

  /**
   * Get user's current active session
   */
  static async getCurrentSession(
    userId: string,
  ): Promise<IPresenceHistory | null> {
    return runInTenantContext(this.getTenantId(), async () => {
      try {
        return await PresenceHistory.findOne({
          userId,
          sessionEnd: { $exists: false },
        }).lean();
      } catch (error) {
        logger.error("Error getting current session:", error);
        return null;
      }
    });
  }

  /**
   * Force end all active sessions for a user (cleanup on logout)
   */
  static async endAllUserSessions(userId: string): Promise<number> {
    return runInTenantContext(this.getTenantId(), async () => {
      try {
        const activeSessions = await PresenceHistory.find({
          userId,
          sessionEnd: { $exists: false },
        });

        const endTime = new Date();
        let endedCount = 0;

        for (const session of activeSessions) {
          session.sessionEnd = endTime;
          session.duration = endTime.getTime() - session.sessionStart.getTime();
          await session.save();
          endedCount++;
        }

        logger.info(`Ended ${endedCount} active sessions for user ${userId}`);
        return endedCount;
      } catch (error) {
        logger.error("Error ending user sessions:", error);
        return 0;
      }
    });
  }

  /**
   * Get presence summary for a date range
   */
  static async getPresenceSummary(
    startDate: Date,
    endDate: Date,
  ): Promise<{
    totalUsers: number;
    totalSessions: number;
    totalOnlineTime: number;
    peakConcurrentUsers: number;
    deviceBreakdown: Record<string, number>;
  }> {
    return runInTenantContext(this.getTenantId(), async () => {
      try {
        const sessions = await PresenceHistory.find({
          sessionStart: { $gte: startDate, $lte: endDate },
        }).lean();

        const uniqueUsers = new Set(sessions.map((s) => s.userId));
        const totalOnlineTime = sessions.reduce(
          (sum, session) => sum + (session.duration || 0),
          0,
        );

        // Device breakdown
        const deviceBreakdown: Record<string, number> = {};
        sessions.forEach((session) => {
          const deviceType = session.deviceInfo?.type || "unknown";
          deviceBreakdown[deviceType] = (deviceBreakdown[deviceType] || 0) + 1;
        });

        // TODO: Calculate peak concurrent users (requires more complex query)
        // For now, return approximate value
        const peakConcurrentUsers = Math.ceil(uniqueUsers.size * 0.3); // Rough estimate

        return {
          totalUsers: uniqueUsers.size,
          totalSessions: sessions.length,
          totalOnlineTime,
          peakConcurrentUsers,
          deviceBreakdown,
        };
      } catch (error) {
        logger.error("Error getting presence summary:", error);
        return {
          totalUsers: 0,
          totalSessions: 0,
          totalOnlineTime: 0,
          peakConcurrentUsers: 0,
          deviceBreakdown: {},
        };
      }
    });
  }
}
