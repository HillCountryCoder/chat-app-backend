import { createLogger } from "../common/logger";
import { attachmentRepository } from "../repositories/attachment.repository";
import { userRepository } from "../repositories/user.repository";
import { s3Service } from "./s3.service";
import { fileValidationService } from "./file-validation.service";
import crypto from 'crypto';
import {
  NotFoundError,
  BadRequestError,
  ForbiddenError,
} from "../common/errors";
import { USER_STORAGE_LIMIT } from "../constants";
import { tenantContext } from "../plugins/tenantPlugin";
const logger = createLogger("attachment-service");

export class AttachmentService {
  private static instance: AttachmentService;
  private static readonly MAX_FILE_SIZE = 1024 * 1024 * 25; // 25mb

  private constructor() {}

  static getInstance(): AttachmentService {
    if (!AttachmentService.instance) {
      AttachmentService.instance = new AttachmentService();
    }
    return AttachmentService.instance;
  }

  async generateUploadUrl(data: {
    userId: string;
    fileName: string;
    fileType: string;
    fileSize: number;
    hasClientThumbnail?: boolean;
  }) {
    const { userId, fileName, fileType, fileSize, hasClientThumbnail } = data;

    // Validate user exists
    const user = await userRepository.findById(userId);
    if (!user) {
      throw new NotFoundError("user");
    }

    await fileValidationService.quickValidate({
      fileName,
      fileType,
      fileSize,
    });

    // Check user storage quota (1GB default)
    const userStorageLimit = USER_STORAGE_LIMIT;
    const currentUsage = await attachmentRepository.getTotalSizeByUser(userId);

    if (currentUsage + fileSize > userStorageLimit) {
      throw new BadRequestError("Storage quota exceeded");
    }
    const s3Key = this.generateS3Key(userId, fileName);

    // Generate S3 upload URL(s)
    const uploadData = await s3Service.generateUploadUrlWithKey({
      key: s3Key,
      fileType,
      fileSize,
      hasClientThumbnail,
    });

    logger.info("Generated upload URL with validation", {
      userId,
      tenantId: this.getTenantId(),
      fileName,
      fileType,
      fileSize,
      s3Key: uploadData.key,
      hasThumbnailUpload: !!uploadData.thumbnailUpload,
    });

    return {
      uploadId: uploadData.key,
      presignedUrl: uploadData.presignedUrl,
      cdnUrl: uploadData.cdnUrl,
      thumbnailUpload: uploadData.thumbnailUpload,
      metadata: {
        bucket: uploadData.bucket,
        key: uploadData.key,
        maxFileSize: fileSize,
        validated: true,
      },
    };
  }

  async completeUpload(data: {
    userId: string;
    fileName: string;
    fileType: string;
    fileSize: number;
    cdnUrl: string;
    s3Bucket: string;
    s3Key: string;
    eTag?: string;
  }) {
    const {
      userId,
      fileName,
      fileType,
      fileSize,
      cdnUrl,
      s3Bucket,
      s3Key,
      eTag,
    } = data;

    // Validate user exists
    const user = await userRepository.findById(userId);
    if (!user) {
      throw new NotFoundError("user");
    }

    try {
      const fileMetadata = await s3Service.getFileMetadata(s3Bucket, s3Key);

      // Additional validation: file size should match what was uploaded
      if (fileMetadata.ContentLength !== fileSize) {
        logger.warn("File size mismatch", {
          expectedSize: fileSize,
          actualSize: fileMetadata.ContentLength,
          s3Key,
        });
        // Don't throw error, just log - S3 might have different size due to encoding
      }

      // Optional: Download first few bytes for magic number validation
      // This adds security but also latency - you can enable/disable based on needs
      if (process.env.ENABLE_DEEP_VALIDATION === "true") {
        const fileBuffer = await s3Service.getFileHead(s3Bucket, s3Key, 1024); // First 1KB
        await fileValidationService.fullValidate({
          fileName,
          fileType,
          fileSize,
          fileBuffer,
        });
      }
    } catch (error) {
      logger.error("File verification failed during complete upload", {
        s3Bucket,
        s3Key,
        userId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw new BadRequestError("File upload verification failed");
    }

    // Create attachment record - file is confirmed to exist and be valid
    const attachment = await attachmentRepository.create({
      name: fileName,
      url: cdnUrl,
      type: fileType,
      size: fileSize,
      uploadedBy: userId,
      status: "ready",
      metadata: {
        s3: {
          bucket: s3Bucket,
          key: s3Key,
          contentType: fileType,
          eTag,
          encrypted: false,
        },
        validation: {
          validatedAt: new Date(),
          method: "backend-validation",
          deepValidation: process.env.ENABLE_DEEP_VALIDATION === "true",
        },
      },
    });

    logger.info("Attachment upload completed with backend validation", {
      attachmentId: attachment._id,
      userId,
      fileName,
      s3Key,
      status: attachment.status,
    });

    return attachment;
  }

  async getAttachment(attachmentId: string, userId: string) {
    const attachment = await attachmentRepository.findById(attachmentId);

    if (!attachment) {
      throw new NotFoundError("attachment");
    }

    // Check if user has access (uploader for now, will expand for message access)
    if (attachment.uploadedBy.toString() !== userId) {
      throw new ForbiddenError("You don't have access to this attachment");
    }

    return attachment;
  }

  async getDownloadUrl(attachmentId: string, userId: string) {
    const attachment = await this.getAttachment(attachmentId, userId);

    if (attachment.status !== "ready") {
      throw new BadRequestError("Attachment is not ready for download");
    }

    const downloadUrl = await s3Service.generateDownloadUrl(
      attachment.metadata.s3.bucket,
      attachment.metadata.s3.key,
    );

    logger.info("Generated download URL", {
      attachmentId,
      userId,
      tenantId: this.getTenantId(),
    });

    return {
      downloadUrl,
      fileName: attachment.name,
      fileType: attachment.type,
      fileSize: attachment.size,
    };
  }

  async deleteAttachment(attachmentId: string, userId: string) {
    const attachment = await this.getAttachment(attachmentId, userId);

    // Delete from S3
    await s3Service.deleteFile(
      attachment.metadata.s3.bucket,
      attachment.metadata.s3.key,
    );

    // Delete thumbnail if exists
    if (attachment.metadata.thumbnail) {
      try {
        const thumbnailBucket =
          process.env.THUMBNAIL_BUCKET_NAME || attachment.metadata.s3.bucket;
        await s3Service.deleteFile(
          thumbnailBucket,
          attachment.metadata.thumbnail.s3Key,
        );
      } catch (error) {
        if (error instanceof Error) {
          logger.warn("Failed to delete thumbnail", {
            attachmentId,
            thumbnailKey: attachment.metadata.thumbnail.s3Key,
            error: error.message,
          });
        }
      }
    }

    // Delete from database
    await attachmentRepository.delete(attachmentId);

    logger.info("Attachment deleted", {
      attachmentId,
      userId,
      tenantId: this.getTenantId(),
    });

    return { success: true };
  }

  async getUserAttachments(userId: string) {
    const attachments = await attachmentRepository.findByUploader(userId);

    return {
      attachments,
      totalCount: attachments.length,
      totalSize: await attachmentRepository.getTotalSizeByUser(userId),
    };
  }

  async calculateMessageAttachmentSize(
    attachmentIds: string[],
  ): Promise<number> {
    if (!attachmentIds.length) return 0;

    const attachments = await attachmentRepository.findReadyAttachments(
      attachmentIds,
    );
    return attachments.reduce(
      (total, attachment) => total + attachment.size,
      0,
    );
  }
  private getTenantId(): string {
    const context = tenantContext.getStore();
    if (!context?.tenantId) {
      throw new Error("Attachment operation attempted without tenant context");
    }
    return context.tenantId;
  }

  // ADD new method for tenant-scoped S3 keys
  private generateS3Key(userId: string, fileName: string): string {
    const tenantId = this.getTenantId();
    const randomId = crypto.randomBytes(16).toString("hex");
    const sanitizedFileName = fileName.replace(/[^a-zA-Z0-9.-]/g, "_");

    // Include tenantId in S3 path
    return `tenants/${tenantId}/users/${userId}/${randomId}/${sanitizedFileName}`;
  }
}

export const attachmentService = AttachmentService.getInstance();
