/* eslint-disable @typescript-eslint/no-explicit-any */
import crypto from "crypto";
import { Attachment } from "../../models";

export interface TestFileData {
  fileName: string;
  fileType: string;
  fileSize: number;
  content?: Buffer;
}

export class AttachmentTestHelper {
  /**
   * Create test file data for different file types
   */
  static createTestFileData(
    type: "image" | "video" | "document" | "large",
  ): TestFileData {
    switch (type) {
      case "image":
        return {
          fileName: "test-image.jpg",
          fileType: "image/jpeg",
          fileSize: 1024 * 500, // 500KB
          content: crypto.randomBytes(1024 * 500),
        };

      case "video":
        return {
          fileName: "test-video.mp4",
          fileType: "video/mp4",
          fileSize: 1024 * 1024 * 5, // 5MB
          content: crypto.randomBytes(1024 * 1024 * 5),
        };

      case "document":
        return {
          fileName: "test-document.pdf",
          fileType: "application/pdf",
          fileSize: 1024 * 100, // 100KB
          content: crypto.randomBytes(1024 * 100),
        };

      case "large":
        return {
          fileName: "large-file.zip",
          fileType: "application/zip",
          fileSize: 1024 * 1024 * 20, // 20MB
          content: crypto.randomBytes(1024 * 1024 * 20),
        };

      default:
        throw new Error(`Unknown file type: ${type}`);
    }
  }

  /**
   * Create a test attachment in the database
   */
  static async createTestAttachment(
    userId: string,
    options: Partial<any> = {},
  ) {
    const defaultAttachment = {
      name: "test-file.jpg",
      url: "https://cdn.domain.com/test-file.jpg",
      type: "image/jpeg",
      size: 1024,
      uploadedBy: userId,
      status: "ready",
      metadata: {
        s3: {
          bucket: "test-bucket",
          key: `users/${userId}/test-file.jpg`,
          contentType: "image/jpeg",
          encrypted: false,
        },
      },
    };

    return await Attachment.create({ ...defaultAttachment, ...options });
  }

  /**
   * Generate multiple test attachments for a user
   */
  static async createMultipleTestAttachments(userId: string, count: number) {
    const attachments = [];

    for (let i = 0; i < count; i++) {
      const attachment = await this.createTestAttachment(userId, {
        name: `test-file-${i}.jpg`,
        url: `https://cdn.domain.com/test-file-${i}.jpg`,
        size: 1024 * (i + 1),
        metadata: {
          s3: {
            bucket: "test-bucket",
            key: `users/${userId}/test-file-${i}.jpg`,
            contentType: "image/jpeg",
            encrypted: false,
          },
        },
      });
      attachments.push(attachment);
    }

    return attachments;
  }

  /**
   * Create attachment with different statuses for testing
   */
  static async createAttachmentsWithStatuses(userId: string) {
    const statuses = ["uploading", "processing", "ready", "failed"];
    const attachments = [];

    for (const status of statuses) {
      const attachment = await this.createTestAttachment(userId, {
        name: `${status}-file.jpg`,
        status: status,
      });
      attachments.push(attachment);
    }

    return attachments;
  }

  /**
   * Simulate file upload to S3 (for real tests)
   */
  static async simulateS3Upload(presignedUrl: string, fileData: TestFileData) {
    const response = await fetch(presignedUrl, {
      method: "PUT",
      body: fileData.content,
      headers: {
        "Content-Type": fileData.fileType,
      },
    });

    if (!response.ok) {
      throw new Error(
        `S3 upload failed: ${response.status} ${response.statusText}`,
      );
    }

    return {
      success: true,
      eTag: response.headers.get("etag")?.replace(/"/g, ""),
    };
  }

  /**
   * Wait for processing with timeout
   */
  static async waitForProcessing(
    attachmentId: string,
    maxWaitMs: number = 30000,
  ) {
    const startTime = Date.now();

    while (Date.now() - startTime < maxWaitMs) {
      const attachment = await Attachment.findById(attachmentId);

      if (!attachment) {
        throw new Error("Attachment not found");
      }

      if (attachment.status === "ready" || attachment.status === "failed") {
        return attachment;
      }

      await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    throw new Error(`Attachment processing timeout after ${maxWaitMs}ms`);
  }

  /**
   * Calculate expected storage usage for attachments
   */
  static calculateExpectedUsage(attachments: any[]) {
    return attachments
      .filter((att) => att.status === "ready")
      .reduce((total, att) => total + att.size, 0);
  }

  /**
   * Generate test S3 key with proper format
   */
  static generateTestS3Key(userId: string, fileName: string) {
    const randomId = crypto.randomBytes(16).toString("hex");
    const sanitizedFileName = fileName.replace(/[^a-zA-Z0-9.-]/g, "_");
    return `users/${userId}/${randomId}/${sanitizedFileName}`;
  }

  /**
   * Create realistic attachment metadata
   */
  static createAttachmentMetadata(
    bucket: string,
    key: string,
    options: any = {},
  ) {
    const baseMetadata = {
      s3: {
        bucket,
        key,
        contentType: options.contentType || "image/jpeg",
        encrypted: false,
        eTag: options.eTag,
      },
      ...(options.thumbnail && {
        thumbnail: {
          s3Key: key.replace(/\.[^.]+$/, "_thumb.jpg"),
          url: `https://cdn.domain.com/thumbnails/${key.replace(
            /\.[^.]+$/,
            "_thumb.jpg",
          )}`,
          width: 320,
          height: 240,
          ...options.thumbnail,
        },
      }),
      ...(options.compression && {
        compression: {
          algorithm: "webp" as const,
          quality: 85,
          compressionRatio: 0.75,
          ...options.compression,
        },
      }),
    };

    return baseMetadata;
  }
}
