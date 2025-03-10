import { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";
import mongoose from "mongoose";
// import Redis from "redis";
import { createLogger } from "../logger";
import { ErrorHandler } from "../errors/error-handler";
import {
  InternalServerError,
  ValidationError,
  RedisError as AppRedisError,
} from "../errors/app-errors";
import { ErrorResponse, RequestContext } from "../errors/types";
import { MongoDBErrorMapper } from "../errors/mongodb-error-mapper";
import { BaseError } from "../errors/base-error";
import {
  AbortError,
  InterruptError,
  ParserError,
  RedisError,
  ReplyError,
} from "../errors/redis-error";

const logger = createLogger("error-middleware");
const errorHandler = new ErrorHandler(logger);

export const errorMiddleware = (
  error: Error | BaseError | any,
  req: Request,
  res: Response<ErrorResponse>,
  next: NextFunction,
) => {
  if (res.headersSent) {
    return next(error);
  }

  // Create request context for detailed error reporting
  const requestContext: RequestContext = {
    method: req.method,
    path: req.path,
    ip: req.ip,
    userAgent: req.get("user-agent"),
    userId: (req as any).user?.id,
  };

  try {
    logger.debug("Error caught in middleware", { error: error.name });

    // Handle Zod validation errors
    if (error instanceof ZodError) {
      const validationError = new ValidationError(
        error.errors.map((e) => e.message).join(", "),
        {
          errors: error.errors,
          requestContext,
        },
      );
      errorHandler.handleError(validationError, res);
      return;
    }

    // Handle MongoDB/Mongoose errors
    if (
      error instanceof mongoose.Error ||
      (error.name && error.name.startsWith("Mongo")) ||
      (error.code && (error.code === 11000 || error.code === 11001))
    ) {
      const resourceName = getResourceNameFromRequest(req);
      const mappedError = MongoDBErrorMapper.mapError(error, resourceName);
      mappedError.details = {
        ...(mappedError.details as object),
        requestContext,
      };
      errorHandler.handleError(mappedError, res);
      return;
    }

    // Handle Redis errors
    if (
      error instanceof RedisError ||
      error instanceof ReplyError ||
      error instanceof ParserError ||
      error instanceof AbortError ||
      error instanceof InterruptError
    ) {
      const redisError = new AppRedisError(
        error.message || "Redis operation failed",
        {
          name: error.name,
          command: (error as any).command,
          args: (error as any).args,
          requestContext,
        },
      );
      errorHandler.handleError(redisError, res);
      return;
    }

    // Handle custom BaseError instances
    if (error instanceof BaseError) {
      error.details = { ...(error.details as object), requestContext };
      errorHandler.handleError(error, res);
      return;
    }

    // Log the unhandled error type for debugging
    logger.warn({
      message: "Unhandled error type",
      errorType: error.constructor?.name,
      error: error,
    });

    // Handle unknown errors
    const serverError = new InternalServerError(
      "An unexpected error occurred",
      {
        error: error.message,
        stack: process.env.NODE_ENV === "development" ? error.stack : undefined,
        requestContext,
      },
    );
    errorHandler.handleError(serverError, res);
  } catch (handlerError) {
    // Failsafe: If error handling itself fails, return a basic 500 response
    logger.error("Error in error handling middleware:", handlerError);
    if (!res.headersSent) {
      res.status(500).json({
        code: "INTERNAL_SERVER_ERROR",
        status: 500,
        message: "An unexpected error occurred while processing the error",
      });
    }
  }
};

// Helper function to extract resource name from request path
function getResourceNameFromRequest(req: Request): string {
  const pathParts = req.path.split("/").filter(Boolean);
  // Return the first path segment as the resource name
  return pathParts[0] || "resource";
}
