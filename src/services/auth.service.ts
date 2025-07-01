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
    // Generate cryptographically secure random token
    const tokenValue = crypto.randomBytes(32).toString("hex");

    const expiresIn = rememberMe
      ? 30 * 24 * 60 * 60 * 1000
      : 7 * 24 * 60 * 60 * 1000; // 30 days or 7 days
    const expiresAt = new Date(Date.now() + expiresIn);

    // Store in database
    await RefreshToken.create({
      token: tokenValue,
      userId: user._id,
      deviceInfo,
      ipAddress,
      userAgent,
      expiresAt,
    });

    this.logger.info("Refresh token generated", {
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
  ): Promise<{ accessToken: string; refreshToken: string; expiresIn: string }> {
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
      expiresIn: rememberMe ? "30d" : "7d",
    };
  }

  public async refreshAccessToken(refreshTokenValue: string): Promise<{
    accessToken: string;
    refreshToken: string;
    user: User;
  }> {
    // Find and validate refresh token
    const storedToken = await RefreshToken.findOne({
      token: refreshTokenValue,
      expiresAt: { $gt: new Date() },
    }).populate("userId");

    if (!storedToken) {
      this.logger.warn("Invalid or expired refresh token", {
        token: refreshTokenValue,
      });
      throw new UnauthorizedError("Invalid refresh token");
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const user = storedToken.userId as any; // Populated user
    if (!user) {
      this.logger.warn("User not found for refresh token", {
        token: refreshTokenValue,
      });
      throw new UnauthorizedError("User not found");
    }

    // Update last used timestamp
    storedToken.lastUsed = new Date();
    await storedToken.save();

    // Generate new access token
    const newAccessToken = this.generateAccessToken(user);

    // Optionally rotate refresh token (recommended for security)
    const newRefreshToken = await this.generateRefreshToken(
      user,
      true, // Assume remember me if they're using refresh token
      storedToken.deviceInfo,
      storedToken.ipAddress,
      storedToken.userAgent,
    );

    // Remove old refresh token
    await RefreshToken.deleteOne({ _id: storedToken._id });

    this.logger.info("Access token refreshed", { userId: user._id });

    return {
      accessToken: newAccessToken,
      refreshToken: newRefreshToken,
      user,
    };
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
    this.logger.info("Refresh token revoked", { token: refreshTokenValue });
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
    return RefreshToken.find({
      userId,
      expiresAt: { $gt: new Date() },
    }).sort({ lastUsed: -1 });
  }
}

export const authService = AuthService.getInstance();
