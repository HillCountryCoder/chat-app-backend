// src/controllers/auth.controller.ts
import { Request, Response, NextFunction } from "express";
import { AuthenticatedRequest } from "../common/types/auth.type";
import { userService } from "../services/user.service";
import {
  LoginInput,
  RegisterInput,
} from "../services/validation/auth.validation";
import { createLogger } from "../common/logger";

const logger = createLogger("auth-controller");

export class AuthController {
  static async registerUser(req: Request, res: Response, next: NextFunction) {
    try {
      logger.debug("Processing registration request");

      // The request body is already validated by the middleware
      const userData = req.body as RegisterInput;

      const registeredUser = await userService.registerUser(userData);
      res.status(201).json(registeredUser);
    } catch (error) {
      next(error);
    }
  }

  static async login(req: Request, res: Response, next: NextFunction) {
    try {
      logger.debug("Processing login request");

      // The request body is already validated by the middleware
      const credentials = req.body as LoginInput;

      const loggedInUser = await userService.loginUser(credentials);
      res.status(200).json(loggedInUser);
    } catch (error) {
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

      // User is already attached to the request by auth middleware
      res.status(200).json({ user: req.user });
    } catch (error) {
      next(error);
    }
  }
}
