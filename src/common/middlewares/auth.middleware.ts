import { Request, Response, NextFunction } from "express";
import { authService } from "../../services/auth.service";
import { userService } from "../../services/user.service";
import { UnauthorizedError } from "../errors";
import { createLogger } from "../logger";
import { TenantAuthenticatedRequest } from "../types";
import { tenantContext } from "../../plugins/tenantPlugin";

const logger = createLogger("auth-middleware");

/**
 * Authentication Middleware
 *
 * This middleware:
 * 1. Verifies JWT token from Authorization header
 * 2. Fetches user from database
 * 3. Attaches user to req.user
 * 4. Sets tenant context from user's tenantId for database isolation
 *
 * Usage: Apply to all routes that need authentication
 */
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
      throw new UnauthorizedError("Access token is required");
    }

    // Verify token
    const decodedUser = authService.verifyToken(token);

    if (!decodedUser || !decodedUser._id) {
      throw new UnauthorizedError("Invalid access token");
    }

    // Get full user data from database
    const user = await userService.getUserById(decodedUser._id.toString());

    if (!user) {
      throw new UnauthorizedError("User not found");
    }

    if (!user.isActive) {
      throw new UnauthorizedError("User account is inactive");
    }

    // Attach user to request object
    (req as TenantAuthenticatedRequest).user = user;

    // CRITICAL: Set tenant context for database isolation
    // This ensures all subsequent database queries are automatically
    // filtered by the user's tenantId via the tenantIsolationPlugin
    return tenantContext.run({ tenantId: user.tenantId }, () => {
      (req as TenantAuthenticatedRequest).tenantId = user.tenantId;
      next();
    });
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
