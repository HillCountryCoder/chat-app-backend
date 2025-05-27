// src/services/__tests__/attachment.service.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { AttachmentService } from "../attachment.service";
import { attachmentRepository } from "../../repositories/attachment.repository";
import { userRepository } from "../../repositories/user.repository";
import { s3Service } from "../s3.service";
import {
  NotFoundError,
  BadRequestError,
  ForbiddenError,
} from "../../common/errors";

// Mock dependencies
vi.mock("../../repositories/attachment.repository");
vi.mock("../../repositories/user.repository");
vi.mock("../s3.service");
vi.mock("../../common/logger", () => ({
  createLogger: vi.fn().mockReturnValue({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

describe("AttachmentService", () => {
  let attachmentService: AttachmentService;

  beforeEach(() => {
    vi.clearAllMocks();
    attachmentService = AttachmentService.getInstance();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("generateUploadUrl", () => {
    const mockData = {
      userId: "user123",
      fileName: "test.jpg",
      fileType: "image/jpeg",
      fileSize: 1024 * 1024, // 1MB
    };

    it("should generate upload URL successfully", async () => {
      // Mock user exists
      const mockUser = { _id: "user123", email: "test@test.com" };
      vi.mocked(userRepository.findById).mockResolvedValue(mockUser as any);

      // Mock current usage under limit
      vi.mocked(attachmentRepository.getTotalSizeByUser).mockResolvedValue(
        100 * 1024 * 1024,
      ); // 100MB

      // Mock S3 service response
      const mockS3Response = {
        presignedUrl: "https://s3.amazonaws.com/upload-url",
        key: "users/user123/file123/test.jpg",
        bucket: "test-bucket",
        cdnUrl: "https://cdn.domain.com/users/user123/file123/test.jpg",
      };
      vi.mocked(s3Service.generateUploadUrl).mockResolvedValue(mockS3Response);

      const result = await attachmentService.generateUploadUrl(mockData);

      expect(result).toEqual({
        uploadId: mockS3Response.key,
        presignedUrl: mockS3Response.presignedUrl,
        cdnUrl: mockS3Response.cdnUrl,
        thumbnailUpload: undefined,
        metadata: {
          bucket: mockS3Response.bucket,
          key: mockS3Response.key,
          maxFileSize: mockData.fileSize,
        },
      });

      expect(userRepository.findById).toHaveBeenCalledWith(mockData.userId);
      expect(attachmentRepository.getTotalSizeByUser).toHaveBeenCalledWith(
        mockData.userId,
      );
      expect(s3Service.generateUploadUrl).toHaveBeenCalledWith(mockData);
    });

    it("should throw NotFoundError if user does not exist", async () => {
      vi.mocked(userRepository.findById).mockResolvedValue(null);

      await expect(
        attachmentService.generateUploadUrl(mockData),
      ).rejects.toThrow(NotFoundError);
    });

    it("should throw BadRequestError if storage quota exceeded", async () => {
      const mockUser = { _id: "user123", email: "test@test.com" };
      vi.mocked(userRepository.findById).mockResolvedValue(mockUser as any);

      // Mock current usage at limit
      vi.mocked(attachmentRepository.getTotalSizeByUser).mockResolvedValue(
        1024 * 1024 * 1024,
      ); // 1GB

      await expect(
        attachmentService.generateUploadUrl(mockData),
      ).rejects.toThrow(BadRequestError);
      expect(vi.mocked(s3Service.generateUploadUrl)).not.toHaveBeenCalled();
    });

    it("should include thumbnail upload for images", async () => {
      const mockUser = { _id: "user123", email: "test@test.com" };
      vi.mocked(userRepository.findById).mockResolvedValue(mockUser as any);
      vi.mocked(attachmentRepository.getTotalSizeByUser).mockResolvedValue(0);

      const mockS3Response = {
        presignedUrl: "https://s3.amazonaws.com/upload-url",
        key: "users/user123/file123/test.jpg",
        bucket: "test-bucket",
        cdnUrl: "https://cdn.domain.com/users/user123/file123/test.jpg",
        thumbnailUpload: {
          presignedUrl: "https://s3.amazonaws.com/thumb-upload-url",
          key: "users/user123/file123/thumb_test.jpg",
          bucket: "thumb-bucket",
          cdnUrl:
            "https://cdn.domain.com/thumbnails/users/user123/file123/thumb_test.jpg",
        },
      };
      vi.mocked(s3Service.generateUploadUrl).mockResolvedValue(mockS3Response);

      const dataWithThumbnail = { ...mockData, hasClientThumbnail: true };
      const result = await attachmentService.generateUploadUrl(
        dataWithThumbnail,
      );

      expect(result.thumbnailUpload).toEqual(mockS3Response.thumbnailUpload);
    });
  });

  describe("completeUpload", () => {
    const mockData = {
      userId: "user123",
      fileName: "test.jpg",
      fileType: "image/jpeg",
      fileSize: 1024,
      cdnUrl: "https://cdn.domain.com/file",
      s3Bucket: "test-bucket",
      s3Key: "users/user123/file123/test.jpg",
      eTag: "etag123",
    };

    it("should complete upload successfully", async () => {
      const mockUser = { _id: "user123", email: "test@test.com" };
      vi.mocked(userRepository.findById).mockResolvedValue(mockUser as any);

      const mockAttachment = {
        _id: "attachment123",
        name: mockData.fileName,
        url: mockData.cdnUrl,
        type: mockData.fileType,
        size: mockData.fileSize,
        uploadedBy: mockData.userId,
        status: "processing",
      };
      vi.mocked(attachmentRepository.create).mockResolvedValue(
        mockAttachment as any,
      );

      const result = await attachmentService.completeUpload(mockData);

      expect(result).toEqual(mockAttachment);
      expect(attachmentRepository.create).toHaveBeenCalledWith({
        name: mockData.fileName,
        url: mockData.cdnUrl,
        type: mockData.fileType,
        size: mockData.fileSize,
        uploadedBy: mockData.userId,
        status: "processing",
        metadata: {
          s3: {
            bucket: mockData.s3Bucket,
            key: mockData.s3Key,
            contentType: mockData.fileType,
            eTag: mockData.eTag,
            encrypted: false,
          },
        },
      });
    });

    it("should throw NotFoundError if user does not exist", async () => {
      vi.mocked(userRepository.findById).mockResolvedValue(null);

      await expect(attachmentService.completeUpload(mockData)).rejects.toThrow(
        NotFoundError,
      );
    });
  });

  describe("updateStatus", () => {
    const mockData = {
      fileKey: "users/user123/file123/test.jpg",
      status: "ready" as const,
      metadata: {
        thumbnail: {
          s3Key: "users/user123/file123/thumb_test.jpg",
          url: "https://cdn.domain.com/thumbnail",
          width: 320,
          height: 240,
        },
      },
    };

    it("should update attachment status successfully", async () => {
      const mockAttachment = {
        _id: "attachment123",
        status: "ready",
        metadata: mockData.metadata,
      };
      vi.mocked(attachmentRepository.updateStatus).mockResolvedValue(
        mockAttachment as any,
      );

      const result = await attachmentService.updateStatus(mockData);

      expect(result).toEqual(mockAttachment);
      expect(attachmentRepository.updateStatus).toHaveBeenCalledWith(
        mockData.fileKey,
        mockData.status,
        mockData.metadata,
      );
    });

    it("should throw NotFoundError if attachment not found", async () => {
      vi.mocked(attachmentRepository.updateStatus).mockResolvedValue(null);

      await expect(attachmentService.updateStatus(mockData)).rejects.toThrow(
        NotFoundError,
      );
    });
  });

  describe("getDownloadUrl", () => {
    it("should generate download URL for accessible attachment", async () => {
      const attachmentId = "attachment123";
      const userId = "user123";

      const mockAttachment = {
        _id: attachmentId,
        uploadedBy: userId,
        status: "ready",
        name: "test.jpg",
        type: "image/jpeg",
        size: 1024,
        metadata: {
          s3: {
            bucket: "test-bucket",
            key: "users/user123/file123/test.jpg",
          },
        },
      };
      vi.mocked(attachmentRepository.findById).mockResolvedValue(
        mockAttachment as any,
      );

      const mockDownloadUrl = "https://s3.amazonaws.com/signed-download-url";
      vi.mocked(s3Service.generateDownloadUrl).mockResolvedValue(
        mockDownloadUrl,
      );

      const result = await attachmentService.getDownloadUrl(
        attachmentId,
        userId,
      );

      expect(result).toEqual({
        downloadUrl: mockDownloadUrl,
        fileName: mockAttachment.name,
        fileType: mockAttachment.type,
        fileSize: mockAttachment.size,
      });

      expect(s3Service.generateDownloadUrl).toHaveBeenCalledWith(
        mockAttachment.metadata.s3.bucket,
        mockAttachment.metadata.s3.key,
      );
    });

    it("should throw ForbiddenError for inaccessible attachment", async () => {
      const attachmentId = "attachment123";
      const userId = "user123";
      const differentUserId = "user456";

      const mockAttachment = {
        _id: attachmentId,
        uploadedBy: differentUserId,
        status: "ready",
      };
      vi.mocked(attachmentRepository.findById).mockResolvedValue(
        mockAttachment as any,
      );

      await expect(
        attachmentService.getDownloadUrl(attachmentId, userId),
      ).rejects.toThrow(ForbiddenError);
    });

    it("should throw BadRequestError for non-ready attachment", async () => {
      const attachmentId = "attachment123";
      const userId = "user123";

      const mockAttachment = {
        _id: attachmentId,
        uploadedBy: userId,
        status: "processing",
      };
      vi.mocked(attachmentRepository.findById).mockResolvedValue(
        mockAttachment as any,
      );

      await expect(
        attachmentService.getDownloadUrl(attachmentId, userId),
      ).rejects.toThrow(BadRequestError);
    });
  });

  describe("deleteAttachment", () => {
    it("should delete attachment and S3 files successfully", async () => {
      const attachmentId = "attachment123";
      const userId = "user123";

      const mockAttachment = {
        _id: attachmentId,
        uploadedBy: userId,
        metadata: {
          s3: {
            bucket: "test-bucket",
            key: "users/user123/file123/test.jpg",
          },
          thumbnail: {
            s3Key: "users/user123/file123/thumb_test.jpg",
          },
        },
      };
      vi.mocked(attachmentRepository.findById).mockResolvedValue(
        mockAttachment as any,
      );

      const result = await attachmentService.deleteAttachment(
        attachmentId,
        userId,
      );

      expect(result).toEqual({ success: true });
      expect(s3Service.deleteFile).toHaveBeenCalledTimes(2); // Main file + thumbnail
      expect(attachmentRepository.delete).toHaveBeenCalledWith(attachmentId);
    });

    it("should continue deletion even if thumbnail deletion fails", async () => {
      const attachmentId = "attachment123";
      const userId = "user123";

      const mockAttachment = {
        _id: attachmentId,
        uploadedBy: userId,
        metadata: {
          s3: {
            bucket: "test-bucket",
            key: "users/user123/file123/test.jpg",
          },
          thumbnail: {
            s3Key: "users/user123/file123/thumb_test.jpg",
          },
        },
      };
      vi.mocked(attachmentRepository.findById).mockResolvedValue(
        mockAttachment as any,
      );

      // Mock thumbnail deletion failure
      vi.mocked(s3Service.deleteFile)
        .mockResolvedValueOnce(undefined) // Main file succeeds
        .mockRejectedValueOnce(new Error("Thumbnail delete failed")); // Thumbnail fails

      const result = await attachmentService.deleteAttachment(
        attachmentId,
        userId,
      );

      expect(result).toEqual({ success: true });
      expect(attachmentRepository.delete).toHaveBeenCalledWith(attachmentId);
    });
  });

  describe("getUserAttachments", () => {
    it("should return user attachments with totals", async () => {
      const userId = "user123";
      const mockAttachments = [
        { _id: "att1", name: "file1.jpg", size: 1000 },
        { _id: "att2", name: "file2.jpg", size: 2000 },
      ];
      const totalSize = 5000;

      vi.mocked(attachmentRepository.findByUploader).mockResolvedValue(
        mockAttachments as any,
      );
      vi.mocked(attachmentRepository.getTotalSizeByUser).mockResolvedValue(
        totalSize,
      );

      const result = await attachmentService.getUserAttachments(userId);

      expect(result).toEqual({
        attachments: mockAttachments,
        totalCount: mockAttachments.length,
        totalSize: totalSize,
      });
    });
  });

  describe("calculateMessageAttachmentSize", () => {
    it("should calculate total size of ready attachments", async () => {
      const attachmentIds = ["att1", "att2", "att3"];
      const mockAttachments = [
        { _id: "att1", size: 1000 },
        { _id: "att2", size: 2000 },
        // att3 not returned (not ready)
      ];

      vi.mocked(attachmentRepository.findReadyAttachments).mockResolvedValue(
        mockAttachments as any,
      );

      const result = await attachmentService.calculateMessageAttachmentSize(
        attachmentIds,
      );

      expect(result).toBe(3000);
      expect(attachmentRepository.findReadyAttachments).toHaveBeenCalledWith(
        attachmentIds,
      );
    });

    it("should return 0 for empty attachment list", async () => {
      const result = await attachmentService.calculateMessageAttachmentSize([]);
      expect(result).toBe(0);
      expect(attachmentRepository.findReadyAttachments).not.toHaveBeenCalled();
    });
  });
});
