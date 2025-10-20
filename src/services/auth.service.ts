/* eslint-disable @typescript-eslint/no-explicit-any */
import jwt from "jsonwebtoken";
import crypto from "crypto";
import { createLogger } from "../common/logger";
import winston from "winston";
import { UnauthorizedError } from "../common/errors";
import { env } from "../common/environment";
import { UserInterface as User } from "../models";
import { UserFromToken } from "../common/types";
import {
  RefreshToken,
  RefreshTokenInterface,
} from "../models/refresh-token.model";
import rateLimit from "express-rate-limit";
import { runInTenantContext } from "../plugins/tenantPlugin";

// Add this rate limiter for refresh endpoint
export const refreshTokenLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 5, // Limit each IP to 5 refresh requests per windowMs
  message: {
    success: false,
    error: {
      status: 429,
      code: "TOO_MANY_REQUESTS",
      message: "Too many refresh attempts, please try again later",
    },
  },
  standardHeaders: true,
  legacyHeaders: false,
  // Skip rate limiting for successful requests
  skipSuccessfulRequests: true,
});

const logger = createLogger("auth-service");

export class AuthService {
  private static instance: AuthService;
  private logger: winston.Logger;

  private constructor(logger: winston.Logger) {
    this.logger = logger;
  }

  public static getInstance(): AuthService {
    if (!AuthService.instance) {
      AuthService.instance = new AuthService(logger);
    }
    return AuthService.instance;
  }

  public generateAccessToken(user: User): string {
    const payload = {
      _id: user._id,
      email: user.email,
      username: user.username,
      tenantId: user.tenantId,
    } as UserFromToken;

    return jwt.sign(payload, env.JWT_SECRET, {
      expiresIn: "15m",
      issuer: "chat-app",
      audience: "chat-app-users",
    });
  }

  public async generateRefreshToken(
    user: User,
    rememberMe: boolean = false,
    deviceInfo?: string,
    ipAddress?: string,
    userAgent?: string,
  ): Promise<string> {
    return runInTenantContext(user.tenantId, async () => {
      const existingSession = await RefreshToken.findOne({
        userId: user._id,
        userAgent: userAgent,
        ipAddress: ipAddress,
        expiresAt: { $gt: new Date() },
      });

      if (existingSession) {
        this.logger.info("Reusing existing session", {
          userId: user._id,
          sessionId: existingSession._id,
          rememberMe,
          tenantId: user.tenantId,
        });

        const expiresIn = rememberMe
          ? 30 * 24 * 60 * 60 * 1000
          : 7 * 24 * 60 * 60 * 1000;
        existingSession.expiresAt = new Date(Date.now() + expiresIn);
        existingSession.rememberMe = rememberMe;
        existingSession.lastUsed = new Date();
        await existingSession.save();

        return existingSession.token;
      }

      // ✅ Generate JWT refresh token with embedded tenantId
      const expiresIn = rememberMe
        ? 30 * 24 * 60 * 60 * 1000
        : 7 * 24 * 60 * 60 * 1000;
      const expiresAt = new Date(Date.now() + expiresIn);

      const tokenValue = jwt.sign(
        {
          userId: user._id.toString(),
          tenantId: user.tenantId,
          type: "refresh",
        },
        env.JWT_REFRESH_SECRET || env.JWT_SECRET,
        {
          expiresIn: rememberMe ? "30d" : "7d",
          jwtid: crypto.randomBytes(16).toString("hex"),
        },
      );

      logger.debug("Generating refresh token", {
        userId: user._id,
        tenantId: user.tenantId,
      });
      await RefreshToken.create({
        tenantId: user.tenantId,
        token: tokenValue,
        userId: user._id,
        deviceInfo,
        ipAddress,
        userAgent,
        expiresAt,
        rememberMe,
      });

      this.logger.info("New refresh token generated", {
        userId: user._id,
        expiresAt,
        rememberMe,
        tenantId: user.tenantId,
      });

      return tokenValue;
    });
  }

  public async generateTokenPair(
    user: User,
    rememberMe: boolean = false,
    deviceInfo?: string,
    ipAddress?: string,
    userAgent?: string,
  ): Promise<{
    accessToken: string;
    refreshToken: string;
    expiresIn: string;
    accessTokenExpiresIn: string;
    refreshTokenExpiresIn: string;
  }> {
    // 🔥 NEW: Clean up expired sessions for this user before creating new ones
    await runInTenantContext(user.tenantId, async () => {
      await this.cleanupExpiredSessions(user._id.toString());
    });
    const accessToken = this.generateAccessToken(user);
    const refreshToken = await this.generateRefreshToken(
      user,
      rememberMe,
      deviceInfo,
      ipAddress,
      userAgent,
    );
    logger.debug("We have a suspected to catch");

    return {
      accessToken,
      refreshToken,
      expiresIn: rememberMe ? "30d" : "7d", // Keep for backward compatibility
      accessTokenExpiresIn: "15m",
      refreshTokenExpiresIn: rememberMe ? "30d" : "7d",
    };
  }

  public async refreshAccessToken(refreshTokenValue: string): Promise<{
    accessToken: string;
    refreshToken: string;
    user: User;
    expiresIn: string;
    accessTokenExpiresIn: string;
    refreshTokenExpiresIn: string;
  }> {
    if (!refreshTokenValue) {
      this.logger.warn("No refresh token provided");
      throw new UnauthorizedError("Refresh token is required");
    }

    // ✅ Decode JWT to extract tenantId (no DB query)
    let decoded: any;
    try {
      decoded = jwt.verify(
        refreshTokenValue,
        env.JWT_REFRESH_SECRET || env.JWT_SECRET,
      ) as any;
    } catch (error) {
      this.logger.warn("Invalid refresh token JWT", { error });
      throw new UnauthorizedError("Invalid refresh token");
    }

    const { tenantId, userId } = decoded;

    if (!tenantId || !userId) {
      this.logger.error(
        "Invalid refresh token format - missing tenantId or userId",
      );
      throw new UnauthorizedError("Invalid refresh token");
    }

    // ✅ Now query WITH tenant context
    return runInTenantContext(tenantId, async () => {
      const storedToken = await RefreshToken.findOne({
        token: refreshTokenValue,
      }).populate("userId");

      if (!storedToken) {
        this.logger.warn("Invalid refresh token - not found in database");
        throw new UnauthorizedError("Invalid refresh token");
      }

      if (storedToken.expiresAt < new Date()) {
        this.logger.warn("Refresh token expired", {
          expiresAt: storedToken.expiresAt,
          now: new Date(),
        });
        await RefreshToken.deleteOne({ _id: storedToken._id });
        throw new UnauthorizedError("Invalid refresh token");
      }

      const user = storedToken.userId as any;
      if (!user) {
        this.logger.error("User not found for refresh token");
        await RefreshToken.deleteOne({ _id: storedToken._id });
        throw new UnauthorizedError("Invalid refresh token");
      }

      // Verify tenantId matches
      if (user.tenantId !== tenantId) {
        this.logger.error("Tenant mismatch in refresh token", {
          tokenTenant: tenantId,
          userTenant: user.tenantId,
        });
        throw new UnauthorizedError("Invalid refresh token");
      }

      // Generate new refresh token
      const originalRememberMe = storedToken.rememberMe || false;
      const newTokenValue = jwt.sign(
        {
          userId: user._id.toString(),
          tenantId: user.tenantId,
          type: "refresh",
        },
        env.JWT_REFRESH_SECRET || env.JWT_SECRET,
        {
          expiresIn: originalRememberMe ? "30d" : "7d",
          jwtid: crypto.randomBytes(16).toString("hex"),
        },
      );

      await RefreshToken.updateOne(
        { _id: storedToken._id },
        {
          token: newTokenValue,
          lastUsed: new Date(),
          expiresAt: new Date(
            Date.now() +
              (originalRememberMe
                ? 30 * 24 * 60 * 60 * 1000
                : 7 * 24 * 60 * 60 * 1000),
          ),
        },
      );

      const newAccessToken = this.generateAccessToken(user);

      this.cleanupExpiredSessions(user._id.toString()).catch((err) => {
        this.logger.warn("Failed to cleanup expired sessions", { error: err });
      });

      this.logger.info("Access token refreshed successfully", {
        userId: user._id,
        tenantId: user.tenantId,
        rememberMe: originalRememberMe,
      });

      return {
        accessToken: newAccessToken,
        refreshToken: newTokenValue,
        user,
        expiresIn: originalRememberMe ? "30d" : "7d",
        accessTokenExpiresIn: "15m",
        refreshTokenExpiresIn: originalRememberMe ? "30d" : "7d",
      };
    });
  }

  public async cleanupExpiredSessions(userId?: string): Promise<void> {
    const query = userId
      ? { userId, expiresAt: { $lt: new Date() } }
      : { expiresAt: { $lt: new Date() } };

    const result = await RefreshToken.deleteMany(query);

    if (result.deletedCount > 0) {
      this.logger.info("Cleaned up expired sessions", {
        userId,
        deletedCount: result.deletedCount,
      });
    }
  }

  public async cleanupDuplicateSessions(userId: string): Promise<void> {
    // Get all sessions for user grouped by device
    const sessions = await RefreshToken.find({
      userId,
      expiresAt: { $gt: new Date() },
    }).sort({ lastUsed: -1 });

    // Group by device (userAgent + ipAddress)
    const deviceGroups = new Map<string, RefreshTokenInterface[]>();

    sessions.forEach((session) => {
      const deviceKey = `${session.userAgent}-${session.ipAddress}`;
      if (!deviceGroups.has(deviceKey)) {
        deviceGroups.set(deviceKey, []);
      }
      deviceGroups.get(deviceKey)!.push(session);
    });

    // For each device group, keep only the most recent session
    for (const [deviceKey, deviceSessions] of deviceGroups) {
      if (deviceSessions.length > 1) {
        // Keep the first (most recent due to sort), remove the rest
        const sessionsToDelete = deviceSessions.slice(1);
        const deleteIds = sessionsToDelete.map((s) => s._id);

        await RefreshToken.deleteMany({ _id: { $in: deleteIds } });

        this.logger.info("Cleaned up duplicate sessions for device", {
          userId,
          deviceKey,
          deletedCount: sessionsToDelete.length,
        });
      }
    }
  }

  public verifyToken(token: string): UserFromToken {
    if (!token) {
      this.logger.warn("No token provided");
      throw new UnauthorizedError("No token provided");
    }

    try {
      return jwt.verify(token, env.JWT_SECRET) as UserFromToken;
    } catch (error) {
      this.logger.warn("Invalid token", { error });
      throw new UnauthorizedError("Invalid token");
    }
  }

  public async revokeRefreshToken(refreshTokenValue: string): Promise<void> {
    await RefreshToken.deleteOne({ token: refreshTokenValue });
    this.logger.info("Refresh token revoked", {
      token: refreshTokenValue.substring(0, 8) + "...",
    });
  }

  public async revokeAllUserTokens(userId: string): Promise<void> {
    const result = await RefreshToken.deleteMany({ userId });
    this.logger.info("All user tokens revoked", {
      userId,
      count: result.deletedCount,
    });
  }

  public async getUserActiveSessions(
    userId: string,
  ): Promise<RefreshTokenInterface[]> {
    await this.cleanupExpiredSessions(userId);

    return RefreshToken.find({
      userId,
      expiresAt: { $gt: new Date() },
    }).sort({ lastUsed: -1 });
  }
}

export const authService = AuthService.getInstance();
