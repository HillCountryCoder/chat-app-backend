import { Request, Response, NextFunction } from "express";
import { AuthenticatedRequest } from "../common/types/auth.type";
import { attachmentService } from "../services/attachment.service";
import { createLogger } from "../common/logger";
import { ValidationError, UnauthorizedError } from "../common/errors";
import { z } from "zod";

const logger = createLogger("attachment-controller");

// Validation schemas
const uploadUrlSchema = z.object({
  fileName: z.string().min(1).max(255),
  fileType: z
    .string()
    .regex(
      /^[a-zA-Z0-9][a-zA-Z0-9!#$&\-^_]*\/[a-zA-Z0-9][a-zA-Z0-9!#$&\-^_.]*$/,
    ),
  fileSize: z
    .number()
    .positive()
    .max(25 * 1024 * 1024), // 25MB limit
});

const completeUploadSchema = z.object({
  fileName: z.string(),
  fileType: z.string(),
  fileSize: z.number().positive(),
  cdnUrl: z.string().url(),
  s3Bucket: z.string(),
  s3Key: z.string(),
  eTag: z.string().optional(),
});

const statusUpdateSchema = z.object({
  fileKey: z.string(),
  status: z.enum(["uploading", "processing", "ready", "failed"]),
  errorDetails: z.string().optional(),
  source: z.string().optional(),
  metadata: z
    .object({
      thumbnail: z
        .object({
          s3Key: z.string(),
          url: z.string(),
          width: z.number(),
          height: z.number(),
        })
        .optional(),
      compression: z
        .object({
          algorithm: z.enum(["webp", "h264", "none"]),
          quality: z.number(),
          compressionRatio: z.number(),
        })
        .optional(),
    })
    .optional(),
});

export class AttachmentController {
  static async generateUploadUrl(
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction,
  ) {
    try {
      logger.debug("Generating upload URL");

      if (!req.user) {
        throw new UnauthorizedError("User not authenticated");
      }

      // Validate request body
      let validatedData;
      try {
        validatedData = uploadUrlSchema.parse(req.body);
      } catch (error) {
        if (error instanceof z.ZodError) {
          throw new ValidationError(
            error.errors.map((e) => e.message).join(", "),
          );
        }
        throw error;
      }

      const userId = req.user._id.toString();

      const result = await attachmentService.generateUploadUrl({
        userId,
        ...validatedData,
      });

      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }

  static async completeUpload(
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction,
  ) {
    try {
      logger.debug("Completing file upload");

      if (!req.user) {
        throw new UnauthorizedError("User not authenticated");
      }

      // Validate request body
      let validatedData;
      try {
        validatedData = completeUploadSchema.parse(req.body);
      } catch (error) {
        if (error instanceof z.ZodError) {
          throw new ValidationError(
            error.errors.map((e) => e.message).join(", "),
          );
        }
        throw error;
      }

      const userId = req.user._id.toString();

      const attachment = await attachmentService.completeUpload({
        userId,
        ...validatedData,
      });

      res.status(201).json(attachment);
    } catch (error) {
      next(error);
    }
  }

  static async updateStatus(req: Request, res: Response, next: NextFunction) {
    try {
      logger.debug("Received attachment status update");

      // Validate request body
      let validatedData;
      try {
        validatedData = statusUpdateSchema.parse(req.body);
      } catch (error) {
        if (error instanceof z.ZodError) {
          throw new ValidationError(
            error.errors.map((e) => e.message).join(", "),
          );
        }
        throw error;
      }

      const attachment = await attachmentService.updateStatus(validatedData);

      logger.info("Attachment status updated", {
        attachmentId: attachment._id,
        fileKey: validatedData.fileKey,
        status: validatedData.status,
        source: validatedData.source || "unknown",
      });

      res.status(200).json({
        success: true,
        attachment,
      });
    } catch (error) {
      next(error);
    }
  }

  static async getDownloadUrl(
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction,
  ) {
    try {
      const { id } = req.params;
      logger.debug(`Getting download URL for attachment: ${id}`);

      if (!req.user) {
        throw new UnauthorizedError("User not authenticated");
      }

      const userId = req.user._id.toString();

      const result = await attachmentService.getDownloadUrl(id, userId);

      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }

  static async deleteAttachment(
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction,
  ) {
    try {
      const { id } = req.params;
      logger.debug(`Deleting attachment: ${id}`);

      if (!req.user) {
        throw new UnauthorizedError("User not authenticated");
      }

      const userId = req.user._id.toString();

      const result = await attachmentService.deleteAttachment(id, userId);

      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }

  static async getUserAttachments(
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction,
  ) {
    try {
      logger.debug("Getting user attachments");

      if (!req.user) {
        throw new UnauthorizedError("User not authenticated");
      }

      const userId = req.user._id.toString();

      const result = await attachmentService.getUserAttachments(userId);

      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }
}
