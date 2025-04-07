import { Request, Response, NextFunction } from "express";
import { AuthenticatedRequest } from "../common/types/auth.type";
import { userService } from "../services/user.service";
import { createLogger } from "../common/logger";
import { z } from "zod";
import { ValidationError } from "../common/errors";

const logger = createLogger("user-controller");

const getUsersQuerySchema = z.object({
  search: z.string().optional(),
  page: z.coerce.number().positive().default(1),
  limit: z.coerce.number().positive().max(100).default(20),
});

export class UserController {
  static async getAllUsers(
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction,
  ) {
    try {
      logger.debug("Getting users list");
      let queryParams;
      try {
        queryParams = getUsersQuerySchema.parse(req.query);
      } catch (error) {
        if (error instanceof z.ZodError) {
          throw new ValidationError(
            error.errors.map((e) => e.message).join(", "),
          );
        }
        throw error;
      }
      const currentUserId = req.user?._id.toString();

      const paginatedUsers = await userService.getAllUsers({
        search: queryParams.search,
        page: queryParams.page,
        limit: queryParams.limit,
        currentUserId,
      });

      res.json(paginatedUsers);
    } catch (error) {
      next(error);
    }
  }
  static async getUserById(
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction,
  ) {
    try {
      const { id } = req.params;
      logger.debug(`Getting user with ID: ${id}`);

      const user = await userService.getUserById(id);

      // Don't send password hash to client
      res.json({
        _id: user._id,
        email: user.email,
        username: user.username,
        displayName: user.displayName,
        avatarUrl: user.avatarUrl,
        status: user.status,
        lastSeen: user.lastSeen,
        createdAt: user.createdAt,
      });
    } catch (error) {
      next(error);
    }
  }
}
