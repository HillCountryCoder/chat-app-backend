import { Request, Response, NextFunction } from "express";
import { authService } from "../../services/auth.service";
import { userService } from "../../services/user.service";
import { UnauthorizedError } from "../errors";
import { createLogger } from "../logger";
import { AuthenticatedRequest } from "../types";

const logger = createLogger("auth-middleware");

export const authMiddleware = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const authHeader = req.headers.authorization;
    const token = authHeader?.startsWith("Bearer ")
      ? authHeader.substring(7).trim()
      : null;

    if (!token) {
      throw new UnauthorizedError("Access token is required"); // ENSURE: Message matches test
    }

    // Verify token
    const decodedUser = authService.verifyToken(token);

    if (!decodedUser || !decodedUser._id) {
      throw new UnauthorizedError("Invalid access token"); // ENSURE: Message matches test
    }

    // Get full user data from database
    const user = await userService.getUserById(decodedUser._id.toString());

    // Attach user to request object
    (req as AuthenticatedRequest).user = user;

    next();
  } catch (error) {
    logger.error("Authentication failed", { error });

    // Ensure consistent error response
    if (error instanceof UnauthorizedError) {
      next(error);
    } else {
      next(new UnauthorizedError("Authentication failed"));
    }
  }
};
