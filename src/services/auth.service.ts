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
    // Add validation for empty refresh token
    if (!refreshTokenValue) {
      this.logger.warn("No refresh token provided");
      throw new UnauthorizedError("Refresh token is required");
    }

    // Find and validate refresh token with more explicit expiry check
    const storedToken = await RefreshToken.findOne({
      token: refreshTokenValue,
    }).populate("userId");

    if (!storedToken) {
      this.logger.warn("Invalid refresh token - not found in database", {
        token: refreshTokenValue.substring(0, 8) + "...",
      });
      throw new UnauthorizedError("Invalid refresh token");
    }

    // Explicit expiry check with cleanup
    if (storedToken.expiresAt < new Date()) {
      this.logger.warn("Refresh token expired", {
        token: refreshTokenValue.substring(0, 8) + "...",
        expiresAt: storedToken.expiresAt,
        now: new Date(),
      });

      // Clean up expired token immediately
      await RefreshToken.deleteOne({ _id: storedToken._id });
      throw new UnauthorizedError("Invalid refresh token");
    }

    const user = storedToken.userId as any; // Populated user
    if (!user) {
      this.logger.error("User not found for refresh token", {
        token: refreshTokenValue.substring(0, 8) + "...",
        userId: storedToken.userId,
      });

      // Clean up orphaned token
      await RefreshToken.deleteOne({ _id: storedToken._id });
      throw new UnauthorizedError("Invalid refresh token");
    }

    try {
      // Get original rememberMe preference from stored token
      const originalRememberMe = storedToken.rememberMe || false;

      // Generate new token value
      const newTokenValue = crypto.randomBytes(32).toString("hex");

      // Update the existing record atomically
      const updateResult = await RefreshToken.updateOne(
        {
          _id: storedToken._id,
          expiresAt: { $gt: new Date() }, // Double-check it's still valid
        },
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

      // If update failed (token expired between checks), throw error
      if (updateResult.matchedCount === 0) {
        this.logger.warn("Refresh token expired during update", {
          token: refreshTokenValue.substring(0, 8) + "...",
        });
        throw new UnauthorizedError("Invalid refresh token");
      }

      // Generate new access token
      const newAccessToken = this.generateAccessToken(user);

      // Clean up any expired sessions for this user (non-blocking)
      this.cleanupExpiredSessions(user._id.toString()).catch((err) => {
        this.logger.warn("Failed to cleanup expired sessions", { error: err });
      });

      this.logger.info("Access token refreshed successfully", {
        userId: user._id,
        rememberMe: originalRememberMe,
        sessionId: storedToken._id,
      });

      return {
        accessToken: newAccessToken,
        refreshToken: newTokenValue,
        user,
        expiresIn: originalRememberMe ? "30d" : "7d",
        accessTokenExpiresIn: "15m",
        refreshTokenExpiresIn: originalRememberMe ? "30d" : "7d",
      };
    } catch (error) {
      this.logger.error("Failed to refresh access token", {
        error: error instanceof Error ? error.message : String(error),
        userId: user._id,
        tokenId: storedToken._id,
      });

      // If it's not already an UnauthorizedError, clean up and throw
      if (!(error instanceof UnauthorizedError)) {
        await RefreshToken.deleteOne({ _id: storedToken._id }).catch(
          (cleanupErr) => {
            this.logger.warn("Failed to cleanup token after error", {
              error: cleanupErr,
            });
          },
        );
        throw new UnauthorizedError("Invalid refresh token");
      }

      throw error;
    }
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
