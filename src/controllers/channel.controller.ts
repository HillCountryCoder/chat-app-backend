import { Request, Response, NextFunction } from "express";
import { AuthenticatedRequest } from "../common/types/auth.type";
import { channelService } from "../services/channel.service";
import { createLogger } from "../common/logger";
import { z } from "zod";
import { ValidationError, UnauthorizedError } from "../common/errors";
import { ChannelType } from "../models";

const logger = createLogger("channel-controller");
const createChannelSchema = z.object({
  name: z.string().min(2).max(50),
  description: z.string().max(500).optional(),
  spaceId: z.string(),
  type: z
    .enum([ChannelType.TEXT, ChannelType.VOICE, ChannelType.ANNOUNCEMENT])
    .optional(),
  memberIds: z.array(z.string()).max(99), // Max 99 additional members (100 including creator)
});

const addMemberSchema = z.object({
  userId: z.string(),
});

const getMessagesSchema = z.object({
  limit: z.coerce.number().min(1).max(100).default(50),
  before: z.string().optional(),
  after: z.string().optional(),
});

const sendMessageSchema = z.object({
  content: z.string().min(1).max(2000),
});

export class ChannelController {
  static async createChannel(
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction,
  ) {
    try {
      logger.debug("Processing create channel request");

      if (!req.user) {
        throw new UnauthorizedError("User not authenticated");
      }
      // Validate request body
      let validatedData;
      try {
        validatedData = createChannelSchema.parse(req.body);
      } catch (error) {
        if (error instanceof z.ZodError) {
          throw new ValidationError(
            error.errors.map((e) => e.message).join(", "),
          );
        }
        throw error;
      }

      const userId = req.user._id.toString();

      const result = await channelService.createChannel(validatedData, userId);

      res.status(201).json(result);
    } catch (error) {
      next(error);
    }
  }

  static async getChannels(
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction,
  ) {
    try {
      logger.debug("Getting user channels");

      if (!req.user) {
        throw new UnauthorizedError("User not authenticated");
      }

      const userId = req.user._id.toString();

      const channels = await channelService.getChannelsByUserId(userId);
      res.json(channels);
    } catch (error) {
      next(error);
    }
  }
  static async getChannelById(
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction,
  ) {
    try {
      const { id } = req.params;
      logger.debug(`Getting channel with ID: ${id}`);

      if (!req.user) {
        throw new UnauthorizedError("User not authenticated");
      }

      const userId = req.user._id.toString();

      const channel = await channelService.getChannelById(id, userId);
      res.json(channel);
    } catch (error) {
      next(error);
    }
  }
  static async getChannelMembers(
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction,
  ) {
    try {
      const { id } = req.params;
      logger.debug(`Getting members for channel ID: ${id}`);

      if (!req.user) {
        throw new UnauthorizedError("User not authenticated");
      }

      const userId = req.user._id.toString();

      const members = await channelService.getChannelMembers(id, userId);
      res.json(members);
    } catch (error) {
      next(error);
    }
  }
  static async addMember(
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction,
  ) {
    try {
      const { id } = req.params;
      logger.debug(`Adding member to channel ID: ${id}`);

      if (!req.user) {
        throw new UnauthorizedError("User not authenticated");
      }

      // Validate request body
      let validatedData;
      try {
        validatedData = addMemberSchema.parse(req.body);
      } catch (error) {
        if (error instanceof z.ZodError) {
          throw new ValidationError(
            error.errors.map((e) => e.message).join(", "),
          );
        }
        throw error;
      }

      const userId = req.user._id.toString();

      const member = await channelService.addMemberToChannel(
        id,
        validatedData.userId,
        userId,
      );
      res.status(201).json(member);
    } catch (error) {
      next(error);
    }
  }
  static async removeMember(
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction,
  ) {
    try {
      const { id, userId } = req.params;
      logger.debug(`Removing member from channel ID: ${id}`);

      if (!req.user) {
        throw new UnauthorizedError("User not authenticated");
      }

      const currentUserId = req.user._id.toString();

      await channelService.removeMemberFromChannel(id, userId, currentUserId);
      res.status(204).end();
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
      logger.debug(`Getting messages for channel ID: ${id}`);

      if (!req.user) {
        throw new UnauthorizedError("User not authenticated");
      }

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

      const userId = req.user._id.toString();

      const messages = await channelService.getMessages(
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
      const { id } = req.params;
      logger.debug(`Sending message to channel ID: ${id}`);

      if (!req.user) {
        throw new UnauthorizedError("User not authenticated");
      }

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

      const userId = req.user._id.toString();

      const result = await channelService.sendMessage({
        senderId: userId,
        channelId: id,
        content: validatedData.content,
      });

      res.status(201).json(result);
    } catch (error) {
      next(error);
    }
  }
}
