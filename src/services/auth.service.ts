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
    // 🔥 NEW: Check if user already has a session from this device
    const existingSession = await RefreshToken.findOne({
      userId: user._id,
      userAgent: userAgent,
      ipAddress: ipAddress,
      expiresAt: { $gt: new Date() },
    });

    if (existingSession) {
      // 🔥 FIX: Reuse existing session instead of creating new one
      this.logger.info("Reusing existing session", {
        userId: user._id,
        sessionId: existingSession._id,
        rememberMe,
      });

      // Update existing session
      const expiresIn = rememberMe
        ? 30 * 24 * 60 * 60 * 1000
        : 7 * 24 * 60 * 60 * 1000;
      existingSession.expiresAt = new Date(Date.now() + expiresIn);
      existingSession.rememberMe = rememberMe;
      existingSession.lastUsed = new Date();
      await existingSession.save();

      return existingSession.token;
    }

    // Generate cryptographically secure random token
    const tokenValue = crypto.randomBytes(32).toString("hex");

    const expiresIn = rememberMe
      ? 30 * 24 * 60 * 60 * 1000
      : 7 * 24 * 60 * 60 * 1000; // 30 days or 7 days
    const expiresAt = new Date(Date.now() + expiresIn);

    // Store in database with rememberMe flag
    await RefreshToken.create({
      token: tokenValue,
      userId: user._id,
      deviceInfo,
      ipAddress,
      userAgent,
      expiresAt,
      rememberMe, // Add this field to track original preference
    });

    this.logger.info("New refresh token generated", {
      userId: user._id,
      expiresAt,
      rememberMe,
    });

    return tokenValue;
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
    await this.cleanupExpiredSessions(user._id.toString());

    const accessToken = this.generateAccessToken(user);
    const refreshToken = await this.generateRefreshToken(
      user,
      rememberMe,
      deviceInfo,
      ipAddress,
      userAgent,
    );

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
    // Find and validate refresh token
    const storedToken = await RefreshToken.findOne({
      token: refreshTokenValue,
      expiresAt: { $gt: new Date() },
    }).populate("userId");

    if (!storedToken) {
      this.logger.warn("Invalid or expired refresh token", {
        token: refreshTokenValue.substring(0, 8) + "...", // Only log first 8 chars for security
      });
      throw new UnauthorizedError("Invalid refresh token");
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const user = storedToken.userId as any; // Populated user
    if (!user) {
      this.logger.warn("User not found for refresh token", {
        token: refreshTokenValue.substring(0, 8) + "...",
      });
      throw new UnauthorizedError("User not found");
    }

    // Get original rememberMe preference from stored token
    const originalRememberMe = storedToken.rememberMe || false;

    // 🔥 FIX: Update existing token instead of creating new record
    const newTokenValue = crypto.randomBytes(32).toString("hex");

    // Update the existing record
    storedToken.token = newTokenValue;
    storedToken.lastUsed = new Date();

    // Optionally extend expiry if needed
    const expiresIn = originalRememberMe
      ? 30 * 24 * 60 * 60 * 1000
      : 7 * 24 * 60 * 60 * 1000;
    storedToken.expiresAt = new Date(Date.now() + expiresIn);

    await storedToken.save();

    // Generate new access token
    const newAccessToken = this.generateAccessToken(user);

    // 🔥 NEW: Clean up any expired sessions for this user
    await this.cleanupExpiredSessions(user._id.toString());

    this.logger.info("Access token refreshed", {
      userId: user._id,
      rememberMe: originalRememberMe,
      sessionId: storedToken._id,
    });

    return {
      accessToken: newAccessToken,
      refreshToken: newTokenValue, // Return the updated token
      user,
      expiresIn: originalRememberMe ? "30d" : "7d", // Keep for backward compatibility
      accessTokenExpiresIn: "15m",
      refreshTokenExpiresIn: originalRememberMe ? "30d" : "7d",
    };
  }

  // 🔥 NEW: Add cleanup method
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

  // 🔥 NEW: Add method to clean up duplicate sessions
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
    // 🔥 NEW: Clean up expired sessions before returning active ones
    await this.cleanupExpiredSessions(userId);

    return RefreshToken.find({
      userId,
      expiresAt: { $gt: new Date() },
    }).sort({ lastUsed: -1 });
  }
}

export const authService = AuthService.getInstance();
