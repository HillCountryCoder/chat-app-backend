import { Request, Response, NextFunction } from "express";
import { UnauthorizedError } from "../errors";
import { env } from "../environment";
import { createLogger } from "../logger";

const logger = createLogger("api-key-middleware");

export function apiKeyMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    const apiKey = req.headers["x-api-key"];
    
    // Skip API key check in development if no key is configured
    if (env.NODE_ENV === "development" && !env.API_KEY) {
      logger.warn("API key check skipped in development mode");
      return next();
    }

    if (!apiKey || apiKey !== env.API_KEY) {
      logger.warn("Invalid API key provided");
      throw new UnauthorizedError("Invalid API key");
    }

    next();
  } catch (error) {
    next(error);
  }
}
