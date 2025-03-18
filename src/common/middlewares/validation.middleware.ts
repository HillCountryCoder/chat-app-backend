import { Request, Response, NextFunction } from "express";
import { ZodSchema } from "zod";
import { createLogger } from "../logger";

const logger = createLogger("validation-middleware");

export function validateRequest(
  schema: ZodSchema,
  source: "body" | "query" | "params" = "body",
) {
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      logger.debug(`Validating request ${source}`);

      const parsedData = schema.parse(req[source]);

      req[source] = parsedData;

      next();
    } catch (error) {
      next(error);
    }
  };
}
