import { createLogger } from "../common/logger";
import { attachmentRepository } from "../repositories/attachment.repository";
import { userRepository } from "../repositories/user.repository";
import { s3Service } from "./s3.service";
import {
  NotFoundError,
  BadRequestError,
  ForbiddenError,
} from "../common/errors";

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
    if (fileSize > AttachmentService.MAX_FILE_SIZE) {
      throw new BadRequestError(
        `File size exceeds maximum limit of ${
          AttachmentService.MAX_FILE_SIZE / (1024 * 1024)
        } MB`,
      );
    }
    // Check user storage quota (1GB default)
    const userStorageLimit = 1024 * 1024 * 1024; // 1GB
    const currentUsage = await attachmentRepository.getTotalSizeByUser(userId);

    if (currentUsage + fileSize > userStorageLimit) {
      throw new BadRequestError("Storage quota exceeded");
    }

    // Generate S3 upload URL(s)
    const uploadData = await s3Service.generateUploadUrl({
      userId,
      fileName,
      fileType,
      fileSize,
      hasClientThumbnail,
    });

    logger.info("Generated upload URL", {
      userId,
      fileName,
      fileType,
      fileSize,
      hasThumbnailUpload: !!uploadData.thumbnailUpload,
    });

    return {
      uploadId: uploadData.key, // Use S3 key as upload ID
      presignedUrl: uploadData.presignedUrl,
      cdnUrl: uploadData.cdnUrl,
      thumbnailUpload: uploadData.thumbnailUpload,
      metadata: {
        bucket: uploadData.bucket,
        key: uploadData.key,
        maxFileSize: fileSize,
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

    // Create attachment record
    const attachment = await attachmentRepository.create({
      name: fileName,
      url: cdnUrl,
      type: fileType,
      size: fileSize,
      uploadedBy: userId,
      status: "processing", // Will be updated by Lambda
      metadata: {
        s3: {
          bucket: s3Bucket,
          key: s3Key,
          contentType: fileType,
          eTag,
          encrypted: false, // For Phase 3
        },
      },
    });

    logger.info("Attachment upload completed", {
      attachmentId: attachment._id,
      userId,
      fileName,
      s3Key,
    });

    return attachment;
  }

  async updateStatus(data: {
    fileKey: string;
    status: "uploading" | "processing" | "ready" | "failed";
    errorDetails?: string;
    metadata?: any;
  }) {
    const { fileKey, status, errorDetails, metadata } = data;

    const attachment = await attachmentRepository.updateStatus(
      fileKey,
      status,
      metadata,
    );

    if (!attachment) {
      throw new NotFoundError("attachment with specified S3 key");
    }

    logger.info("Attachment status updated", {
      attachmentId: attachment._id,
      fileKey,
      status,
      errorDetails,
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

    // Delete thumbnail if exists (from thumbnail bucket)
    if (attachment.metadata.thumbnail) {
      try {
        // Use thumbnail bucket (separate from media bucket)
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

  // Method for calculating message attachment size
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
}

export const attachmentService = AttachmentService.getInstance();
