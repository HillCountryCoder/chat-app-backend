// src/controllers/channel.controller.ts
import { Response, NextFunction } from "express";
import { AuthenticatedRequest } from "../common/types/auth.type";
import { channelService } from "../services/channel.service";
import { createLogger } from "../common/logger";
import { z } from "zod";
import { ValidationError, UnauthorizedError } from "../common/errors";
import { ChannelType, ContentType } from "../models";

const logger = createLogger("channel-controller");

// Validation schemas
const createChannelSchema = z.object({
  name: z.string().min(2).max(50),
  description: z.string().max(500).optional(),
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

const createThreadSchema = z.object({
  messageId: z.string(),
  content: z.string().min(1).max(2000),
  title: z.string().max(100).optional(),
});

const richContentSchema = z
  .array(
    z
      .object({
        id: z.string().optional(),
        type: z.string(),
        children: z.array(
          z
            .object({
              text: z.string().optional(),
            })
            .passthrough(), // Allow additional properties for formatting
        ),
      })
      .passthrough(), // Allow additional properties for node attributes
  )
  .optional();

const editMessageSchema = z
  .object({
    content: z.string().min(1).max(2000),
    richContent: richContentSchema,
    contentType: z.nativeEnum(ContentType).optional(),
  })
  .refine(
    (data) => {
      if (
        data.richContent &&
        data.content &&
        data.contentType !== ContentType.RICH
      ) {
        return false;
      }
      return true;
    },
    {
      message: "Content type must be 'rich' when rich content is provided",
      path: ["contentType"],
    },
  )
  .refine(
    (data) => {
      if (data.contentType === ContentType.RICH && !data.richContent) {
        return false;
      }
      return true;
    },
    {
      message: "Rich content must be provided when content type is 'rich'",
      path: ["richContent"],
    },
  );

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

      const channels = await channelService.getAllChannels(userId);
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

  // Thread related endpoints
  static async createThread(
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction,
  ) {
    try {
      const { id } = req.params; // Channel ID
      logger.debug(`Creating thread in channel ID: ${id}`);

      if (!req.user) {
        throw new UnauthorizedError("User not authenticated");
      }

      // Validate request body
      let validatedData;
      try {
        validatedData = createThreadSchema.parse(req.body);
      } catch (error) {
        if (error instanceof z.ZodError) {
          throw new ValidationError(
            error.errors.map((e) => e.message).join(", "),
          );
        }
        throw error;
      }

      const userId = req.user._id.toString();

      const result = await channelService.createThread({
        channelId: id,
        messageId: validatedData.messageId,
        senderId: userId,
        content: validatedData.content,
        title: validatedData.title,
      });

      res.status(201).json(result);
    } catch (error) {
      next(error);
    }
  }

  static async getThreads(
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction,
  ) {
    try {
      const { id } = req.params; // Channel ID
      logger.debug(`Getting threads for channel ID: ${id}`);

      if (!req.user) {
        throw new UnauthorizedError("User not authenticated");
      }

      const userId = req.user._id.toString();

      const threads = await channelService.getThreadsByChannelId(id, userId);
      res.json(threads);
    } catch (error) {
      next(error);
    }
  }

  static async getThreadById(
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction,
  ) {
    try {
      const { id, threadId } = req.params;
      logger.debug(`Getting thread ID: ${threadId} in channel ID: ${id}`);

      if (!req.user) {
        throw new UnauthorizedError("User not authenticated");
      }

      const userId = req.user._id.toString();

      const thread = await channelService.getThreadById(threadId, userId);
      res.json(thread);
    } catch (error) {
      next(error);
    }
  }

  static async getThreadMessages(
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction,
  ) {
    try {
      const { id, threadId } = req.params;
      logger.debug(
        `Getting messages for thread ID: ${threadId} in channel ID: ${id}`,
      );

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

      const messages = await channelService.getThreadMessages(
        threadId,
        userId,
        validatedQuery,
      );
      res.json(messages);
    } catch (error) {
      next(error);
    }
  }

  static async sendThreadMessage(
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction,
  ) {
    try {
      const { id, threadId } = req.params;
      logger.debug(
        `Sending message to thread ID: ${threadId} in channel ID: ${id}`,
      );

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

      const result = await channelService.sendThreadMessage({
        senderId: userId,
        threadId: threadId,
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
      logger.debug(`Marking channel messages as read: ${id}`);

      if (!req.user) {
        throw new UnauthorizedError("User not authenticated");
      }
      const userId = req.user._id.toString();

      const result = await channelService.markMessagesAsRead(id, userId);
      res.json(result);
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

  static async editMessage(
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction,
  ) {
    try {
      const { id, messageId } = req.params;
      logger.debug(`Editing message ${messageId} in channel ${id}`);

      if (!req.user) {
        throw new UnauthorizedError("User not authenticated");
      }

      // Validate request body
      let validatedData;
      try {
        validatedData = editMessageSchema.parse(req.body);
      } catch (error) {
        if (error instanceof z.ZodError) {
          throw new ValidationError(
            error.errors.map((e) => e.message).join(", "),
          );
        }
        throw error;
      }

      const userId = req.user._id.toString();

      // Determine content type if not explicitly provided
      let contentType = validatedData.contentType;
      if (!contentType) {
        contentType = validatedData.richContent
          ? ContentType.RICH
          : ContentType.TEXT;
      }

      const processedRichContent = validatedData.richContent?.map((node) => ({
        ...node,
        children: node.children.map((child) => ({
          ...child,
          text: child.text || "",
        })),
      }));

      const result = await channelService.editMessage({
        channelId: id,
        messageId,
        userId,
        content: validatedData.content,
        richContent: processedRichContent,
        contentType,
      });

      res.json(result);
    } catch (error) {
      next(error);
    }
  }
}
