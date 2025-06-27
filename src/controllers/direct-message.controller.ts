import { Response, NextFunction } from "express";
import { AuthenticatedRequest } from "../common/types/auth.type";
import { directMessageService } from "../services/direct-message.service";
import { createLogger } from "../common/logger";
import { z } from "zod";
import { UnauthorizedError, ValidationError } from "../common/errors";
import { ContentType } from "../models";

const logger = createLogger("direct-message-controller");

// Rich content validation schema (Plate.js Value format)
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

// Updated validation schemas with rich content support
const sendMessageSchema = z
  .object({
    content: z.string().min(1).max(2000),
    richContent: richContentSchema,
    contentType: z.nativeEnum(ContentType).optional(),
    receiverId: z.string().optional(),
    directMessageId: z.string().optional(),
    attachmentIds: z.array(z.string()).optional(),
    replyToId: z.string().optional(),
  })
  .refine((data) => data.receiverId || data.directMessageId, {
    message: "Either receiverId or directMessageId must be provided",
    path: ["receiverId", "directMessageId"],
  })
  .refine(
    (data) => {
      // If richContent is provided, validate content type consistency
      if (
        data.richContent &&
        data.contentType &&
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
      // If contentType is rich, richContent must be provided
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
      logger.debug("Processing send message request", {
        hasRichContent: !!req.body.richContent,
        contentType: req.body.contentType,
      });

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
      // Determine content type if not explicitly provided
      let contentType = validatedData.contentType;
      console.log("DEBUG - After validation:", {
        rawBody: req.body,
        validatedContentType: validatedData.contentType,
        validatedRichContent: !!validatedData.richContent,
        determinedContentType: contentType,
      });
      if (!contentType) {
        contentType = validatedData.richContent
          ? ContentType.RICH
          : ContentType.TEXT;
      }

      // Transform rich content to ensure all text fields are strings
      const processedRichContent = validatedData.richContent?.map((node) => ({
        ...node,
        children: node.children.map((child) => ({
          ...child,
          text: child.text || "", // Convert undefined to empty string
        })),
      }));

      const result = await directMessageService.sendMessage({
        senderId: userId,
        receiverId: validatedData.receiverId,
        directMessageId: validatedData.directMessageId,
        content: validatedData.content,
        richContent: processedRichContent,
        contentType,
        attachmentIds: validatedData.attachmentIds || [],
        replyToId: validatedData.replyToId,
      });

      logger.info("Message sent successfully", {
        messageId: result.message.messageId,
        contentType,
        hasRichContent: !!validatedData.richContent,
        hasAttachments: (validatedData.attachmentIds || []).length > 0,
      });

      res.status(201).json(result);
    } catch (error) {
      logger.error("Error sending message", { error });
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

      const result = await directMessageService.markMessagesAsRead(id, userId);
      res.json(result);
    } catch (error) {
      next(error);
    }
  }

  // New endpoint to get rich content statistics
  static async getRichContentStats(
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction,
  ) {
    try {
      const { id } = req.params;
      logger.debug(`Getting rich content statistics for DM: ${id}`);

      if (!req.user) {
        throw new UnauthorizedError("User not authenticated");
      }
      const userId = req.user._id.toString();

      // Verify user has access to this direct message
      await directMessageService.getDirectMessageById(id, userId);

      const stats = await directMessageService.getRichContentStats(id, userId);
      res.json(stats);
    } catch (error) {
      next(error);
    }
  }
}
