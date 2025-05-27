// src/repositories/__tests__/attachment.repository.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import mongoose from "mongoose";
import { AttachmentRepository } from "../attachment.repository";
import { Attachment } from "../../models";
import "../../tests/integration/setup"; // MongoDB test setup

describe("AttachmentRepository", () => {
  let attachmentRepository: AttachmentRepository;
  let testUserId: string;
  let testS3Key: string;

  beforeEach(async () => {
    attachmentRepository = AttachmentRepository.getInstance();
    testUserId = new mongoose.Types.ObjectId().toString();
    testS3Key = `users/${testUserId}/file123/test.jpg`;
  });

  afterEach(async () => {
    // Clean up test data
    await Attachment.deleteMany({});
  });

  describe("findByS3Key", () => {
    it("should find attachment by S3 key", async () => {
      // Create test attachment
      const testAttachment = await Attachment.create({
        name: "test.jpg",
        url: "https://cdn.domain.com/test.jpg",
        type: "image/jpeg",
        size: 1024,
        uploadedBy: testUserId,
        status: "ready",
        metadata: {
          s3: {
            bucket: "test-bucket",
            key: testS3Key,
            contentType: "image/jpeg",
            encrypted: false,
          },
        },
      });

      const result = await attachmentRepository.findByS3Key(testS3Key);

      expect(result).not.toBeNull();
      expect(result!._id.toString()).toBe(testAttachment._id.toString());
      expect(result!.metadata.s3.key).toBe(testS3Key);
    });

    it("should return null if attachment not found by S3 key", async () => {
      const result = await attachmentRepository.findByS3Key("non-existent-key");
      expect(result).toBeNull();
    });
  });

  describe("findByUploader", () => {
    it("should find attachments by uploader ID", async () => {
      const otherUserId = new mongoose.Types.ObjectId().toString();

      // Create attachments for test user
      await Attachment.create([
        {
          name: "file1.jpg",
          url: "https://cdn.domain.com/file1.jpg",
          type: "image/jpeg",
          size: 1024,
          uploadedBy: testUserId,
          status: "ready",
          metadata: {
            s3: {
              bucket: "test-bucket",
              key: `users/${testUserId}/file1.jpg`,
              contentType: "image/jpeg",
              encrypted: false,
            },
          },
        },
        {
          name: "file2.jpg",
          url: "https://cdn.domain.com/file2.jpg",
          type: "image/jpeg",
          size: 2048,
          uploadedBy: testUserId,
          status: "ready",
          metadata: {
            s3: {
              bucket: "test-bucket",
              key: `users/${testUserId}/file2.jpg`,
              contentType: "image/jpeg",
              encrypted: false,
            },
          },
        },
        {
          name: "other-file.jpg",
          url: "https://cdn.domain.com/other-file.jpg",
          type: "image/jpeg",
          size: 1024,
          uploadedBy: otherUserId,
          status: "ready",
          metadata: {
            s3: {
              bucket: "test-bucket",
              key: `users/${otherUserId}/other-file.jpg`,
              contentType: "image/jpeg",
              encrypted: false,
            },
          },
        },
      ]);

      const result = await attachmentRepository.findByUploader(testUserId);

      expect(result).toHaveLength(2);
      result.forEach((attachment) => {
        expect(attachment.uploadedBy.toString()).toBe(testUserId);
      });

      // Should be sorted by uploadedAt descending (most recent first)
      expect(result[0].name).toBe("file2.jpg");
      expect(result[1].name).toBe("file1.jpg");
    });

    it("should return empty array if no attachments found for user", async () => {
      const nonExistentUserId = new mongoose.Types.ObjectId().toString();
      const result = await attachmentRepository.findByUploader(
        nonExistentUserId,
      );
      expect(result).toHaveLength(0);
    });
  });

  describe("findByStatus", () => {
    it("should find attachments by status", async () => {
      await Attachment.create([
        {
          name: "ready-file.jpg",
          url: "https://cdn.domain.com/ready-file.jpg",
          type: "image/jpeg",
          size: 1024,
          uploadedBy: testUserId,
          status: "ready",
          metadata: {
            s3: {
              bucket: "test-bucket",
              key: `users/${testUserId}/ready-file.jpg`,
              contentType: "image/jpeg",
              encrypted: false,
            },
          },
        },
        {
          name: "processing-file.jpg",
          url: "https://cdn.domain.com/processing-file.jpg",
          type: "image/jpeg",
          size: 2048,
          uploadedBy: testUserId,
          status: "processing",
          metadata: {
            s3: {
              bucket: "test-bucket",
              key: `users/${testUserId}/processing-file.jpg`,
              contentType: "image/jpeg",
              encrypted: false,
            },
          },
        },
        {
          name: "failed-file.jpg",
          url: "https://cdn.domain.com/failed-file.jpg",
          type: "image/jpeg",
          size: 1024,
          uploadedBy: testUserId,
          status: "failed",
          metadata: {
            s3: {
              bucket: "test-bucket",
              key: `users/${testUserId}/failed-file.jpg`,
              contentType: "image/jpeg",
              encrypted: false,
            },
          },
        },
      ]);

      const readyAttachments = await attachmentRepository.findByStatus("ready");
      const processingAttachments = await attachmentRepository.findByStatus(
        "processing",
      );

      expect(readyAttachments).toHaveLength(1);
      expect(readyAttachments[0].status).toBe("ready");
      expect(readyAttachments[0].name).toBe("ready-file.jpg");

      expect(processingAttachments).toHaveLength(1);
      expect(processingAttachments[0].status).toBe("processing");
      expect(processingAttachments[0].name).toBe("processing-file.jpg");
    });
  });

  describe("updateStatus", () => {
    it("should update attachment status and metadata", async () => {
      const testAttachment = await Attachment.create({
        name: "test.jpg",
        url: "https://cdn.domain.com/test.jpg",
        type: "image/jpeg",
        size: 1024,
        uploadedBy: testUserId,
        status: "processing",
        metadata: {
          s3: {
            bucket: "test-bucket",
            key: testS3Key,
            contentType: "image/jpeg",
            encrypted: false,
          },
        },
      });

      const newMetadata = {
        thumbnail: {
          s3Key: "users/user123/file123/thumb_test.jpg",
          url: "https://cdn.domain.com/thumbnail",
          width: 320,
          height: 240,
        },
        compression: {
          algorithm: "webp" as const,
          quality: 85,
          compressionRatio: 0.7,
        },
      };

      const result = await attachmentRepository.updateStatus(
        testS3Key,
        "ready",
        newMetadata,
      );

      expect(result).not.toBeNull();
      expect(result!.status).toBe("ready");
      expect(result!.metadata.thumbnail?.toObject()).toEqual(
        newMetadata.thumbnail,
      );
      expect(result!.metadata.compression?.toObject()).toEqual(
        newMetadata.compression,
      );

      // Verify in database
      const updatedAttachment = await Attachment.findById(testAttachment._id);
      expect(updatedAttachment!.status).toBe("ready");
      expect(updatedAttachment!.metadata.thumbnail?.toObject()).toEqual(
        newMetadata.thumbnail,
      );
    });

    it("should update only status when no metadata provided", async () => {
      await Attachment.create({
        name: "test.jpg",
        url: "https://cdn.domain.com/test.jpg",
        type: "image/jpeg",
        size: 1024,
        uploadedBy: testUserId,
        status: "processing",
        metadata: {
          s3: {
            bucket: "test-bucket",
            key: testS3Key,
            contentType: "image/jpeg",
            encrypted: false,
          },
        },
      });

      const result = await attachmentRepository.updateStatus(
        testS3Key,
        "ready",
      );

      expect(result).not.toBeNull();
      expect(result!.status).toBe("ready");
      expect(result!.metadata.thumbnail).toBeUndefined();
    });

    it("should return null if attachment not found by S3 key", async () => {
      const result = await attachmentRepository.updateStatus(
        "non-existent-key",
        "ready",
      );
      expect(result).toBeNull();
    });
  });

  describe("getTotalSizeByUser", () => {
    it("should calculate total size of ready attachments for user", async () => {
      const otherUserId = new mongoose.Types.ObjectId().toString();

      await Attachment.create([
        {
          name: "file1.jpg",
          url: "https://cdn.domain.com/file1.jpg",
          type: "image/jpeg",
          size: 1000,
          uploadedBy: testUserId,
          status: "ready",
          metadata: {
            s3: {
              bucket: "test-bucket",
              key: `users/${testUserId}/file1.jpg`,
              contentType: "image/jpeg",
              encrypted: false,
            },
          },
        },
        {
          name: "file2.jpg",
          url: "https://cdn.domain.com/file2.jpg",
          type: "image/jpeg",
          size: 2000,
          uploadedBy: testUserId,
          status: "ready",
          metadata: {
            s3: {
              bucket: "test-bucket",
              key: `users/${testUserId}/file2.jpg`,
              contentType: "image/jpeg",
              encrypted: false,
            },
          },
        },
        {
          name: "processing-file.jpg",
          url: "https://cdn.domain.com/processing-file.jpg",
          type: "image/jpeg",
          size: 5000, // Should not be counted (not ready)
          uploadedBy: testUserId,
          status: "processing",
          metadata: {
            s3: {
              bucket: "test-bucket",
              key: `users/${testUserId}/processing-file.jpg`,
              contentType: "image/jpeg",
              encrypted: false,
            },
          },
        },
        {
          name: "other-user-file.jpg",
          url: "https://cdn.domain.com/other-user-file.jpg",
          type: "image/jpeg",
          size: 3000, // Should not be counted (different user)
          uploadedBy: otherUserId,
          status: "ready",
          metadata: {
            s3: {
              bucket: "test-bucket",
              key: `users/${otherUserId}/other-user-file.jpg`,
              contentType: "image/jpeg",
              encrypted: false,
            },
          },
        },
      ]);

      const totalSize = await attachmentRepository.getTotalSizeByUser(
        testUserId,
      );

      expect(totalSize).toBe(3000); // 1000 + 2000
    });

    it("should return 0 if user has no ready attachments", async () => {
      const nonExistentUserId = new mongoose.Types.ObjectId().toString();
      const totalSize = await attachmentRepository.getTotalSizeByUser(
        nonExistentUserId,
      );
      expect(totalSize).toBe(0);
    });
  });

  describe("findReadyAttachments", () => {
    it("should find only ready attachments from given IDs", async () => {
      const attachments = await Attachment.create([
        {
          name: "ready-file1.jpg",
          url: "https://cdn.domain.com/ready-file1.jpg",
          type: "image/jpeg",
          size: 1000,
          uploadedBy: testUserId,
          status: "ready",
          metadata: {
            s3: {
              bucket: "test-bucket",
              key: `users/${testUserId}/ready-file1.jpg`,
              contentType: "image/jpeg",
              encrypted: false,
            },
          },
        },
        {
          name: "ready-file2.jpg",
          url: "https://cdn.domain.com/ready-file2.jpg",
          type: "image/jpeg",
          size: 2000,
          uploadedBy: testUserId,
          status: "ready",
          metadata: {
            s3: {
              bucket: "test-bucket",
              key: `users/${testUserId}/ready-file2.jpg`,
              contentType: "image/jpeg",
              encrypted: false,
            },
          },
        },
        {
          name: "processing-file.jpg",
          url: "https://cdn.domain.com/processing-file.jpg",
          type: "image/jpeg",
          size: 3000,
          uploadedBy: testUserId,
          status: "processing",
          metadata: {
            s3: {
              bucket: "test-bucket",
              key: `users/${testUserId}/processing-file.jpg`,
              contentType: "image/jpeg",
              encrypted: false,
            },
          },
        },
      ]);

      const attachmentIds = attachments.map((att) => att._id.toString());

      const result = await attachmentRepository.findReadyAttachments(
        attachmentIds,
      );

      expect(result).toHaveLength(2);
      result.forEach((attachment) => {
        expect(attachment.status).toBe("ready");
      });

      const resultIds = result.map((att) => att._id.toString());
      expect(resultIds).toContain(attachments[0]._id.toString());
      expect(resultIds).toContain(attachments[1]._id.toString());
      expect(resultIds).not.toContain(attachments[2]._id.toString());
    });

    it("should return empty array if no attachments match IDs", async () => {
      const nonExistentIds = [
        new mongoose.Types.ObjectId().toString(),
        new mongoose.Types.ObjectId().toString(),
      ];

      const result = await attachmentRepository.findReadyAttachments(
        nonExistentIds,
      );
      expect(result).toHaveLength(0);
    });

    it("should return empty array for empty ID list", async () => {
      const result = await attachmentRepository.findReadyAttachments([]);
      expect(result).toHaveLength(0);
    });
  });

  describe("inheritance from BaseRepository", () => {
    it("should inherit basic CRUD operations", async () => {
      const testAttachment = await attachmentRepository.create({
        name: "test.jpg",
        url: "https://cdn.domain.com/test.jpg",
        type: "image/jpeg",
        size: 1024,
        uploadedBy: testUserId,
        status: "ready",
        metadata: {
          s3: {
            bucket: "test-bucket",
            key: testS3Key,
            contentType: "image/jpeg",
            encrypted: false,
          },
        },
      });

      // Test findById
      const found = await attachmentRepository.findById(
        testAttachment._id.toString(),
      );
      expect(found).not.toBeNull();
      expect(found!._id.toString()).toBe(testAttachment._id.toString());

      // Test update
      const updated = await attachmentRepository.update(
        testAttachment._id.toString(),
        { size: 2048 },
      );
      expect(updated!.size).toBe(2048);

      // Test delete
      const deleted = await attachmentRepository.delete(
        testAttachment._id.toString(),
      );
      expect(deleted).not.toBeNull();

      // Verify deletion
      const notFound = await attachmentRepository.findById(
        testAttachment._id.toString(),
      );
      expect(notFound).toBeNull();
    });
  });
});
