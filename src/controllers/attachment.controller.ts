import { Request, Response, NextFunction } from "express";
import { createLogger } from "../common/logger";
import { ValidationError } from "../common/errors";
import { z } from "zod";

const logger = createLogger("attachment-controller");

// Validation schema for status updates from Lambda
const statusUpdateSchema = z.object({
  fileKey: z.string(),
  status: z.enum(["uploading", "processing", "ready", "failed"]),
  errorDetails: z.string().optional(),
  source: z.string().optional()
});

export class AttachmentController {
  static async updateStatus(
    req: Request,
    res: Response,
    next: NextFunction,
  ) {
    try {
      logger.debug("Received attachment status update");

      // Validate request body
      let validatedData;
      try {
        validatedData = statusUpdateSchema.parse(req.body);
      } catch (error) {
        if (error instanceof z.ZodError) {
          throw new ValidationError(error.errors.map(e => e.message).join(", "));
        }
        throw error;
      }

      // Log the status update (we'll implement DB updates in Phase 2)
      logger.info("Attachment status update", {
        fileKey: validatedData.fileKey,
        status: validatedData.status,
        source: validatedData.source || "unknown"
      });

      // Send successful response
      res.status(200).json({
        success: true,
        message: "Status update received"
      });
    } catch (error) {
      next(error);
    }
  }
}
