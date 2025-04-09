// src/controllers/direct-message.controller.ts
import { Request, Response, NextFunction } from "express";
import { AuthenticatedRequest } from "../common/types/auth.type";
import { directMessageService } from "../services/direct-message.service";
import { createLogger } from "../common/logger";
import { z } from "zod";
import { UnauthorizedError, ValidationError } from "../common/errors";

const logger = createLogger("direct-message-controller");

// Validation schemas
const sendMessageSchema = z
  .object({
    content: z.string().min(1).max(2000),
    receiverId: z.string().optional(),
    directMessageId: z.string().optional(),
  })
  .refine((data) => data.receiverId || data.directMessageId, {
    message: "Either receiverId or directMessageId must be provided",
    path: ["receiverId", "directMessageId"],
  });

const getMessagesSchema = z.object({
  limit: z.coerce.number().min(1).max(100).default(50),
  before: z.string().optional(),
  after: z.string().optional(),
});

export class DirectMessageController {
  static async getDirectMessages(
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction,
  ) {
    try {
      logger.debug("Getting user direct messages");
      if (!req.user) {
        throw new UnauthorizedError("User not authenticated");
      }
      const userId = req.user._id.toString();

      const directMessages = await directMessageService.getUserDirectMessages(
        userId,
      );
      res.json(directMessages);
    } catch (error) {
      next(error);
    }
  }

  static async getDirectMessageById(
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction,
  ) {
    try {
      const { id } = req.params;
      if (!req.user) {
        throw new UnauthorizedError("User not authenticated");
      }
      const userId = req.user._id.toString();

      const directMessage = await directMessageService.getDirectMessageById(
        id,
        userId,
      );
      res.json(directMessage);
    } catch (error) {
      next(error);
    }
  }

  static async getMessages(
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction,
  ) {
    try {
      const { id } = req.params;
      if (!req.user) {
        throw new UnauthorizedError("User not authenticated");
      }
      const userId = req.user._id.toString();

      // Validate query parameters
      let validatedQuery;
      try {
        validatedQuery = getMessagesSchema.parse(req.query);
      } catch (error) {
        if (error instanceof z.ZodError) {
          throw new ValidationError(
            error.errors.map((e) => e.message).join(", "),
          );
        }
        throw error;
      }

      const messages = await directMessageService.getMessages(
        id,
        userId,
        validatedQuery,
      );
      res.json(messages);
    } catch (error) {
      next(error);
    }
  }

  static async sendMessage(
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction,
  ) {
    try {
      logger.debug("Processing send message request");

      // Validate request body
      let validatedData;
      try {
        validatedData = sendMessageSchema.parse(req.body);
      } catch (error) {
        if (error instanceof z.ZodError) {
          throw new ValidationError(
            error.errors.map((e) => e.message).join(", "),
          );
        }
        throw error;
      }
      if (!req.user) {
        throw new UnauthorizedError("User not authenticated");
      }
      const userId = req.user._id.toString();

      const result = await directMessageService.sendMessage({
        senderId: userId,
        receiverId: validatedData.receiverId,
        directMessageId: validatedData.directMessageId,
        content: validatedData.content,
      });

      res.status(201).json(result);
    } catch (error) {
      next(error);
    }
  }

  static async markAsRead(
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction,
  ) {
    try {
      const { id } = req.params;
      logger.debug(`Marking direct message as read: ${id}`);

      if (!req.user) {
        throw new UnauthorizedError("User not authenticated");
      }

      const userId = req.user._id.toString();
      const result = await directMessageService.markMessagesAsRead(
        id /* directMessageId */,
        userId,
      );
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
  static async getUnreadCounts(
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction,
  ) {
    try {
      logger.debug("Getting unread message counts");

      if (!req.user) {
        throw new UnauthorizedError("User not authenticated");
      }
      const userId = req.user._id.toString();

      const unreadCounts = await directMessageService.getUnreadCounts(userId);
      res.json(unreadCounts);
    } catch (error) {
      next(error);
    }
  }
}
