// src/tests/helpers/attachment-test-helper.ts
import { Attachment, AttachmentInterface } from "../../models";
import crypto from "crypto";

export class AttachmentTestHelper {
  private static counter = 0;

  /**
   * Generate a unique identifier for test files
   */
  private static generateUniqueId(): string {
    const timestamp = Date.now();
    const random = crypto.randomBytes(4).toString("hex");
    this.counter++;
    return `${timestamp}-${random}-${this.counter}`;
  }

  /**
   * Create a test attachment in the database
   */
  static async createTestAttachment(
    userId: string,
    overrides: Partial<AttachmentInterface> = {},
  ): Promise<AttachmentInterface> {
    const uniqueId = this.generateUniqueId();
    const defaultName = `test-file-${uniqueId}.jpg`;
    const defaultKey = `users/${userId}/test-file-${uniqueId}.jpg`;

    const defaultAttachment = {
      name: defaultName,
      url: `https://cdn.domain.com/${defaultKey}`,
      type: "image/jpeg",
      size: 1024 * 1024, // 1MB
      uploadedBy: userId,
      status: "ready" as const,
      metadata: {
        s3: {
          bucket: "test-bucket",
          key: defaultKey,
          contentType: "image/jpeg",
          encrypted: false,
        },
      },
    };

    // Merge overrides, ensuring unique S3 key
    const attachmentData = {
      ...defaultAttachment,
      ...overrides,
    };

    // If overrides don't include metadata, ensure unique key
    if (!overrides.metadata?.s3?.key) {
      attachmentData.metadata.s3.key = defaultKey;
    }

    return await Attachment.create(attachmentData);
  }

  /**
   * Create multiple test attachments with unique keys
   */
  static async createMultipleTestAttachments(
    userId: string,
    count: number,
    baseOverrides: Partial<AttachmentInterface> = {},
  ): Promise<AttachmentInterface[]> {
    const promises = Array(count)
      .fill(null)
      .map(async (_, i) => {
        const uniqueId = this.generateUniqueId();
        const overrides = {
          ...baseOverrides,
          name: `test-file-${i}-${uniqueId}.jpg`,
          metadata: {
            s3: {
              bucket: "test-bucket",
              key: `users/${userId}/test-file-${i}-${uniqueId}.jpg`,
              contentType: "image/jpeg",
              encrypted: false,
              ...baseOverrides.metadata?.s3,
            },
            ...baseOverrides.metadata,
          },
        };

        return this.createTestAttachment(userId, overrides);
      });

    return Promise.all(promises);
  }

  /**
   * Create attachments with different statuses for testing
   */
  static async createAttachmentsWithStatuses(
    userId: string,
  ): Promise<AttachmentInterface[]> {
    const statuses: Array<"uploading" | "processing" | "ready" | "failed"> = [
      "uploading",
      "processing",
      "ready",
      "failed",
    ];

    const promises = statuses.map(async (status, i) => {
      const uniqueId = this.generateUniqueId();
      return this.createTestAttachment(userId, {
        name: `test-${status}-${uniqueId}.jpg`,
        status,
        size: (i + 1) * 1024 * 512, // Different sizes
        metadata: {
          s3: {
            bucket: "test-bucket",
            key: `users/${userId}/test-${status}-${uniqueId}.jpg`,
            contentType: "image/jpeg",
            encrypted: false,
          },
        },
      });
    });

    return Promise.all(promises);
  }

  /**
   * Create test file data for upload testing
   */
  static createTestFileData(type: "image" | "large" | "video" = "image"): {
    fileName: string;
    fileType: string;
    fileSize: number;
    content: Buffer;
  } {
    const uniqueId = this.generateUniqueId();

    switch (type) {
      case "image":
        return {
          fileName: `test-image-${uniqueId}.jpg`,
          fileType: "image/jpeg",
          fileSize: 1024 * 100, // 100KB
          content: Buffer.alloc(1024 * 100, "test-image-data"),
        };

      case "large":
        return {
          fileName: `test-large-${uniqueId}.mp4`,
          fileType: "video/mp4",
          fileSize: 10 * 1024 * 1024, // 10MB
          content: Buffer.alloc(10 * 1024 * 1024, "test-large-file-data"),
        };

      case "video":
        return {
          fileName: `test-video-${uniqueId}.mp4`,
          fileType: "video/mp4",
          fileSize: 5 * 1024 * 1024, // 5MB
          content: Buffer.alloc(5 * 1024 * 1024, "test-video-data"),
        };

      default:
        throw new Error(`Unknown file type: ${type}`);
    }
  }

  /**
   * Create test file with specific size
   */
  static createTestFileWithSize(
    sizeInBytes: number,
    fileType: string = "image/jpeg",
  ): {
    fileName: string;
    fileType: string;
    fileSize: number;
    content: Buffer;
  } {
    const uniqueId = this.generateUniqueId();
    const extension = fileType.split("/")[1] || "jpg";

    return {
      fileName: `test-sized-file-${uniqueId}.${extension}`,
      fileType,
      fileSize: sizeInBytes,
      content: Buffer.alloc(sizeInBytes, "test-file-data"),
    };
  }

  /**
   * Create test thumbnail data
   */
  static createTestThumbnailData(): {
    fileName: string;
    fileType: string;
    fileSize: number;
    content: Buffer;
  } {
    const uniqueId = this.generateUniqueId();

    return {
      fileName: `thumbnail-${uniqueId}.jpg`,
      fileType: "image/jpeg",
      fileSize: 1024 * 10, // 10KB
      content: Buffer.alloc(1024 * 10, "thumbnail-data"),
    };
  }

  /**
   * Clean up test attachments
   */
  static async cleanupTestAttachments(userId?: string): Promise<void> {
    const query = userId ? { uploadedBy: userId } : {};
    await Attachment.deleteMany(query);
  }

  /**
   * Verify attachment data structure
   */
  static verifyAttachmentStructure(attachment: AttachmentInterface): boolean {
    const requiredFields = [
      "name",
      "url",
      "type",
      "size",
      "uploadedBy",
      "status",
      "metadata",
    ];

    const requiredMetadataFields = ["s3"];
    const requiredS3Fields = ["bucket", "key", "contentType", "encrypted"];

    // Check top-level fields
    for (const field of requiredFields) {
      if (!(field in attachment)) {
        console.error(`Missing required field: ${field}`);
        return false;
      }
    }

    // Check metadata structure
    for (const field of requiredMetadataFields) {
      if (!(field in attachment.metadata)) {
        console.error(`Missing required metadata field: ${field}`);
        return false;
      }
    }

    // Check S3 metadata structure
    for (const field of requiredS3Fields) {
      if (!(field in attachment.metadata.s3)) {
        console.error(`Missing required S3 metadata field: ${field}`);
        return false;
      }
    }

    return true;
  }

  /**
   * Generate mock S3 response for testing
   */
  static generateMockS3Response(key: string): {
    uploadId: string;
    presignedUrl: string;
    cdnUrl: string;
    metadata: {
      bucket: string;
      key: string;
      maxFileSize: number;
    };
  } {
    const uniqueId = this.generateUniqueId();

    return {
      uploadId: key,
      presignedUrl: `https://test-bucket.s3.amazonaws.com/${key}?signature=${uniqueId}`,
      cdnUrl: `https://cdn.domain.com/${key}`,
      metadata: {
        bucket: "test-bucket",
        key,
        maxFileSize: 25 * 1024 * 1024, // 25MB
      },
    };
  }

  /**
   * Generate mock thumbnail upload response
   */
  static generateMockThumbnailResponse(baseKey: string): {
    presignedUrl: string;
    key: string;
    bucket: string;
    cdnUrl: string;
  } {
    const uniqueId = this.generateUniqueId();
    const thumbnailKey = `${baseKey.replace(
      /\.[^.]+$/,
      "",
    )}_thumb_${uniqueId}.jpg`;

    return {
      presignedUrl: `https://test-thumbnail-bucket.s3.amazonaws.com/${thumbnailKey}?signature=${uniqueId}`,
      key: thumbnailKey,
      bucket: "test-thumbnail-bucket",
      cdnUrl: `https://cdn.domain.com/thumbnails/${thumbnailKey}`,
    };
  }

  /**
   * Calculate expected storage usage for a user
   */
  static async calculateStorageUsage(
    userId: string,
    status: "ready" | "all" = "ready",
  ): Promise<{
    totalSize: number;
    fileCount: number;
    averageFileSize: number;
  }> {
    const query: any = { uploadedBy: userId };
    if (status === "ready") {
      query.status = "ready";
    }

    const attachments = await Attachment.find(query);
    const totalSize = attachments.reduce((sum, att) => sum + att.size, 0);
    const fileCount = attachments.length;
    const averageFileSize = fileCount > 0 ? totalSize / fileCount : 0;

    return {
      totalSize,
      fileCount,
      averageFileSize,
    };
  }

  /**
   * Create test data for concurrent operations
   */
  static generateConcurrentTestData(
    count: number,
    userId: string,
  ): Array<{
    fileName: string;
    fileType: string;
    fileSize: number;
    expectedS3Key: string;
  }> {
    return Array(count)
      .fill(null)
      .map((_, i) => {
        const uniqueId = this.generateUniqueId();
        const fileName = `concurrent-test-${i}-${uniqueId}.jpg`;
        const expectedS3Key = `users/${userId}/${fileName}`;

        return {
          fileName,
          fileType: "image/jpeg",
          fileSize: 1024 * (100 + i * 10), // Varying sizes
          expectedS3Key,
        };
      });
  }

  /**
   * Validate upload URL response structure
   */
  static validateUploadUrlResponse(response: any): boolean {
    const requiredFields = ["uploadId", "presignedUrl", "cdnUrl", "metadata"];

    const requiredMetadataFields = ["bucket", "key", "maxFileSize"];

    // Check top-level fields
    for (const field of requiredFields) {
      if (!(field in response)) {
        console.error(`Missing required response field: ${field}`);
        return false;
      }
    }

    // Check metadata fields
    for (const field of requiredMetadataFields) {
      if (!(field in response.metadata)) {
        console.error(`Missing required metadata field: ${field}`);
        return false;
      }
    }

    // Validate URL formats
    if (!response.presignedUrl.startsWith("http")) {
      console.error("Invalid presigned URL format");
      return false;
    }

    if (!response.cdnUrl.startsWith("http")) {
      console.error("Invalid CDN URL format");
      return false;
    }

    return true;
  }

  /**
   * Generate test scenario for different file types
   */
  static generateFileTypeScenarios(): Array<{
    name: string;
    fileType: string;
    extension: string;
    expectedProcessing: boolean;
    maxSize: number;
  }> {
    return [
      {
        name: "JPEG Image",
        fileType: "image/jpeg",
        extension: "jpg",
        expectedProcessing: true, // Thumbnail generation
        maxSize: 25 * 1024 * 1024,
      },
      {
        name: "PNG Image",
        fileType: "image/png",
        extension: "png",
        expectedProcessing: true,
        maxSize: 25 * 1024 * 1024,
      },
      {
        name: "MP4 Video",
        fileType: "video/mp4",
        extension: "mp4",
        expectedProcessing: true, // Thumbnail + compression
        maxSize: 25 * 1024 * 1024,
      },
      {
        name: "PDF Document",
        fileType: "application/pdf",
        extension: "pdf",
        expectedProcessing: false, // No processing
        maxSize: 25 * 1024 * 1024,
      },
      {
        name: "Text File",
        fileType: "text/plain",
        extension: "txt",
        expectedProcessing: false,
        maxSize: 25 * 1024 * 1024,
      },
    ];
  }
}
