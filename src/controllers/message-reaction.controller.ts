import { Response, NextFunction } from "express";
import { AuthenticatedRequest } from "../common/types/auth.type";
import { messageReactionService } from "../services/message-reaction.service";
import { createLogger } from "../common/logger";
import { z } from "zod";
import { ValidationError, UnauthorizedError } from "../common/errors";

const logger = createLogger("message-reaction-controller");

const reactionSchema = z.object({
  emoji: z.string().min(1).max(10), // Limit emoji to reasonable length
});

export class MessageReactionController {
  static async addReaction(
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction,
  ) {
    try {
      const { id } = req.params; // messageId
      logger.debug(`Adding reaction to message ID: ${id}`);
      if (!req.user) {
        throw new UnauthorizedError("User not authenticated");
      }
      // Validate request body
      let validatedReaction;
      try {
        validatedReaction = reactionSchema.parse(req.body);
      } catch (error) {
        if (error instanceof z.ZodError) {
          throw new ValidationError(
            error.errors.map((e) => e.message).join(", "),
          );
        }
        throw error;
      }
      const userId = req.user._id.toString();
      const { emoji } = validatedReaction;

      const updatedMessage = await messageReactionService.addReaction(
        id,
        userId,
        emoji,
      );

      res.json({
        success: true,
        reactions: updatedMessage.reactions,
      });
    } catch (error) {
      next(error);
    }
  }
  static async removeReaction(
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction,
  ) {
    try {
      const { id, emoji } = req.params; // Message ID and emoji
      logger.debug(`Removing reaction ${emoji} from message ID: ${id}`);

      if (!req.user) {
        throw new UnauthorizedError("User not authenticated");
      }

      const userId = req.user._id.toString();

      const updatedMessage = await messageReactionService.removeReaction(
        id,
        userId,
        emoji,
      );

      res.json({
        success: true,
        reactions: updatedMessage.reactions,
      });
    } catch (error) {
      next(error);
    }
  }

  static async getReactions(
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction,
  ) {
    try {
      const { id } = req.params; // Message ID
      logger.debug(`Getting reactions for message ID: ${id}`);

      const reactions = await messageReactionService.getReactions(id);

      res.json(reactions);
    } catch (error) {
      next(error);
    }
  }
}
