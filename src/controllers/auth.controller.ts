import { Request, Response, NextFunction } from "express";
import { AuthenticatedRequest } from "../common/types/auth.type";
import { userService } from "../services/user.service";
import { authService } from "../services/auth.service";
import {
  AuthInput,
  RegisterInput,
} from "../services/validation/auth.validation";
import { BadRequestError, UnauthorizedError } from "../common/errors";
import { createLogger } from "../common/logger";

const logger = createLogger("auth-controller");

export class AuthController {
  static async registerUser(req: Request, res: Response, next: NextFunction) {
    try {
      logger.debug("Processing registration request");

      const userData = req.body as RegisterInput;

      // Extract device info from request
      const deviceInfo = req.headers["user-agent"];
      const ipAddress = req.ip;
      const userAgent = req.headers["user-agent"];

      // Use enhanced method with device info
      const registeredUser = await userService.registerUserWithDeviceInfo(
        userData,
        deviceInfo,
        ipAddress,
        userAgent,
      );

      res.status(201).json({
        success: true,
        message: "User registered successfully",
        ...registeredUser,
      });
    } catch (error) {
      logger.error("Registration failed", { error });
      next(error);
    }
  }

  static async login(req: Request, res: Response, next: NextFunction) {
    try {
      logger.debug("Processing login request");

      const credentials = req.body as AuthInput;

      const isEmail = /^\S+@\S+\.\S+$/.test(credentials.identifier);

      const loginData = {
        email: isEmail ? credentials.identifier : undefined,
        username: !isEmail ? credentials.identifier : undefined,
        password: credentials.password,
        rememberMe: credentials.rememberMe || false,
      };

      // Extract device info from request
      const deviceInfo = req.headers["user-agent"];
      const ipAddress = req.ip;
      const userAgent = req.headers["user-agent"];

      // Use enhanced method with device info
      const loggedInUser = await userService.loginUserWithDeviceInfo(
        loginData,
        deviceInfo,
        ipAddress,
        userAgent,
      );

      res.status(200).json({
        success: true,
        message: "Login successful",
        ...loggedInUser,
      });
    } catch (error) {
      logger.error("Login failed", { error });
      next(error);
    }
  }
  static async refreshToken(req: Request, res: Response, next: NextFunction) {
    try {
      logger.debug("Processing token refresh request");

      const { refreshToken } = req.body;

      if (!refreshToken) {
        throw new BadRequestError("Refresh token is required");
      }

      const tokens = await authService.refreshAccessToken(refreshToken);

      logger.info("Token refreshed successfully", { userId: tokens.user._id });

      res.json({
        success: true,
        message: "Token refreshed successfully",
        user: {
          _id: tokens.user._id,
          username: tokens.user.username,
          email: tokens.user.email,
        },
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
      });
    } catch (error) {
      logger.error("Token refresh failed", { error });
      next(error);
    }
  }

  static async logout(
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction,
  ) {
    try {
      logger.debug("Processing logout request");

      const { refreshToken } = req.body;
      const user = req.user;

      if (refreshToken) {
        await authService.revokeRefreshToken(refreshToken);
      }

      logger.info("User logged out", { userId: user?._id });

      res.json({
        success: true,
        message: "Logged out successfully",
      });
    } catch (error) {
      logger.error("Logout failed", { error });
      next(error);
    }
  }

  static async logoutAll(
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction,
  ) {
    try {
      logger.debug("Processing logout all request");

      const user = req.user;

      if (!user) {
        throw new UnauthorizedError("User not authenticated");
      }

      await authService.revokeAllUserTokens(user._id.toString());

      logger.info("All user sessions revoked", { userId: user._id });

      res.json({
        success: true,
        message: "All sessions logged out successfully",
      });
    } catch (error) {
      logger.error("Logout all failed", { error });
      next(error);
    }
  }

  static async getCurrentUser(
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction,
  ) {
    try {
      logger.debug("Getting current user information");

      const user = req.user;

      if (!user) {
        throw new UnauthorizedError("User not authenticated");
      }

      // User is already attached to the request by auth middleware
      res.status(200).json({
        success: true,
        user: {
          _id: user._id,
          username: user.username,
          email: user.email,
          displayName: user.displayName,
          avatarUrl: user.avatarUrl,
          status: user.status,
        },
      });
    } catch (error) {
      logger.error("Get current user failed", { error });
      next(error);
    }
  }

  static async getActiveSessions(
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction,
  ) {
    try {
      logger.debug("Getting active sessions");

      const user = req.user;

      if (!user) {
        throw new UnauthorizedError("User not authenticated");
      }

      const sessions = await authService.getUserActiveSessions(
        user._id.toString(),
      );

      res.json({
        success: true,
        data: { sessions },
      });
    } catch (error) {
      logger.error("Get active sessions failed", { error });
      next(error);
    }
  }
}
