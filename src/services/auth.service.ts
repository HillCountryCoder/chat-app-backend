// src/services/auth.service.ts
import jwt from "jsonwebtoken";
import { createLogger } from "../common/logger";
import winston from "winston";
import { UnauthorizedError } from "../common/errors";
import { env } from "../common/environment";
import { UserInterface as User } from "../models";
import { UserFromToken } from "../common/types";

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

  public generateToken(user: User): string {
    const payload = {
      _id: user._id,
      email: user.email,
      username: user.username,
    } as UserFromToken;

    return jwt.sign(payload, env.JWT_SECRET, {
      expiresIn: "1d",
    });
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
}

export const authService = AuthService.getInstance();
