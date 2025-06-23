/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { Response, NextFunction } from "express";
import { AttachmentController } from "../attachment.controller";
import { attachmentService } from "../../services/attachment.service";
import { ValidationError, UnauthorizedError } from "../../common/errors";
import { AuthenticatedRequest } from "../../common/types/auth.type";

// Mock dependencies
vi.mock("../../services/attachment.service");
vi.mock("../../socket", () => ({
  getSocketServer: vi.fn().mockReturnValue(null),
}));
vi.mock("../../socket/attachment.handler", () => ({
  emitAttachmentStatusUpdate: vi.fn(),
}));
vi.mock("../../common/logger", () => ({
  createLogger: vi.fn().mockReturnValue({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
  createSocketLogger: vi.fn().mockReturnValue({
    connection: vi.fn(),
    disconnection: vi.fn(),
    event: vi.fn(),
    error: vi.fn(),
  }),
}));

describe("AttachmentController", () => {
  let mockRequest: Partial<AuthenticatedRequest>;
  let mockResponse: Partial<Response>;
  let mockNext: NextFunction;

  beforeEach(() => {
    vi.clearAllMocks();

    mockRequest = {
      user: { _id: "user123", email: "test@test.com" } as any,
      body: {},
      params: {},
      headers: {}, // Add missing headers property
    };

    mockResponse = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
    };

    mockNext = vi.fn();
  });

  describe("generateUploadUrl", () => {
    it("should generate upload URL successfully", async () => {
      const mockRequestBody = {
        fileName: "test.jpg",
        fileType: "image/jpeg",
        fileSize: 1024000,
      };

      const mockServiceResponse = {
        uploadId: "upload123",
        presignedUrl: "https://s3.amazonaws.com/upload-url",
        cdnUrl: "https://cdn.domain.com/file",
        thumbnailUpload: undefined,
        metadata: {
          bucket: "test-bucket",
          key: "test-key",
          maxFileSize: 1024000,
          validated: true,
        },
      };

      mockRequest.body = mockRequestBody;
      vi.mocked(attachmentService.generateUploadUrl).mockResolvedValue(
        mockServiceResponse,
      );

      await AttachmentController.generateUploadUrl(
        mockRequest as AuthenticatedRequest,
        mockResponse as Response,
        mockNext,
      );

      expect(attachmentService.generateUploadUrl).toHaveBeenCalledWith({
        userId: "user123",
        ...mockRequestBody,
      });
      expect(mockResponse.status).toHaveBeenCalledWith(200);
      expect(mockResponse.json).toHaveBeenCalledWith(mockServiceResponse);
      expect(mockNext).not.toHaveBeenCalled();
    });

    it("should generate upload URL with thumbnail", async () => {
      const mockRequestBody = {
        fileName: "test.jpg",
        fileType: "image/jpeg",
        fileSize: 1024000,
        hasClientThumbnail: true,
      };

      const mockServiceResponse = {
        uploadId: "upload123",
        presignedUrl: "https://s3.amazonaws.com/upload-url",
        cdnUrl: "https://cdn.domain.com/file",
        thumbnailUpload: {
          presignedUrl: "https://s3.amazonaws.com/thumb-upload-url",
          key: "thumb-key",
          bucket: "thumb-bucket",
          cdnUrl: "https://cdn.domain.com/thumb",
        },
        metadata: {
          bucket: "test-bucket",
          key: "test-key",
          maxFileSize: 1024000,
          validated: true,
        },
      };

      mockRequest.body = mockRequestBody;
      vi.mocked(attachmentService.generateUploadUrl).mockResolvedValue(
        mockServiceResponse,
      );

      await AttachmentController.generateUploadUrl(
        mockRequest as AuthenticatedRequest,
        mockResponse as Response,
        mockNext,
      );

      expect(mockResponse.json).toHaveBeenCalledWith(mockServiceResponse);
      expect(mockServiceResponse.thumbnailUpload).toBeDefined();
    });

    it("should handle validation errors", async () => {
      mockRequest.body = {
        fileName: "", // Invalid - empty
        fileType: "image/jpeg",
        fileSize: 1024000,
      };

      await AttachmentController.generateUploadUrl(
        mockRequest as AuthenticatedRequest,
        mockResponse as Response,
        mockNext,
      );

      expect(mockNext).toHaveBeenCalledWith(expect.any(ValidationError));
    });

    it("should handle missing user", async () => {
      mockRequest.user = undefined;

      await AttachmentController.generateUploadUrl(
        mockRequest as AuthenticatedRequest,
        mockResponse as Response,
        mockNext,
      );

      expect(mockNext).toHaveBeenCalledWith(expect.any(UnauthorizedError));
    });

    it("should handle service errors", async () => {
      const mockError = new Error("Service error");
      mockRequest.body = {
        fileName: "test.jpg",
        fileType: "image/jpeg",
        fileSize: 1024000,
      };

      vi.mocked(attachmentService.generateUploadUrl).mockRejectedValue(
        mockError,
      );

      await AttachmentController.generateUploadUrl(
        mockRequest as AuthenticatedRequest,
        mockResponse as Response,
        mockNext,
      );

      expect(mockNext).toHaveBeenCalledWith(mockError);
    });

    it("should validate file size limits", async () => {
      mockRequest.body = {
        fileName: "test.jpg",
        fileType: "image/jpeg",
        fileSize: 30 * 1024 * 1024, // 30MB - exceeds 25MB limit
      };

      await AttachmentController.generateUploadUrl(
        mockRequest as AuthenticatedRequest,
        mockResponse as Response,
        mockNext,
      );

      expect(mockNext).toHaveBeenCalledWith(expect.any(ValidationError));
    });

    it("should validate file type format", async () => {
      mockRequest.body = {
        fileName: "test.jpg",
        fileType: "invalid-mime-type", // Invalid MIME type format
        fileSize: 1024000,
      };

      await AttachmentController.generateUploadUrl(
        mockRequest as AuthenticatedRequest,
        mockResponse as Response,
        mockNext,
      );

      expect(mockNext).toHaveBeenCalledWith(expect.any(ValidationError));
    });
  });

  describe("completeUpload", () => {
    it("should complete upload successfully", async () => {
      const mockRequestBody = {
        fileName: "test.jpg",
        fileType: "image/jpeg",
        fileSize: 1024000,
        cdnUrl: "https://cdn.domain.com/file",
        s3Bucket: "test-bucket",
        s3Key: "test-key",
        eTag: "etag123",
      };

      const mockAttachment = {
        _id: "attachment123",
        name: "test.jpg",
        url: "https://cdn.domain.com/file",
        status: "ready",
        uploadedBy: "user123",
        size: 1024000,
        metadata: {},
      };

      mockRequest.body = mockRequestBody;
      vi.mocked(attachmentService.completeUpload).mockResolvedValue(
        mockAttachment as any,
      );

      await AttachmentController.completeUpload(
        mockRequest as AuthenticatedRequest,
        mockResponse as Response,
        mockNext,
      );

      expect(attachmentService.completeUpload).toHaveBeenCalledWith({
        userId: "user123",
        ...mockRequestBody,
      });
      expect(mockResponse.status).toHaveBeenCalledWith(201);
      expect(mockResponse.json).toHaveBeenCalledWith(mockAttachment);
    });

    it("should validate required fields", async () => {
      mockRequest.body = {
        fileName: "test.jpg",
        // Missing required fields
      };

      await AttachmentController.completeUpload(
        mockRequest as AuthenticatedRequest,
        mockResponse as Response,
        mockNext,
      );

      expect(mockNext).toHaveBeenCalledWith(expect.any(ValidationError));
    });

    it("should validate URL format", async () => {
      mockRequest.body = {
        fileName: "test.jpg",
        fileType: "image/jpeg",
        fileSize: 1024000,
        cdnUrl: "invalid-url", // Invalid URL format
        s3Bucket: "test-bucket",
        s3Key: "test-key",
      };

      await AttachmentController.completeUpload(
        mockRequest as AuthenticatedRequest,
        mockResponse as Response,
        mockNext,
      );

      expect(mockNext).toHaveBeenCalledWith(expect.any(ValidationError));
    });
  });

  // Remove updateStatus tests since the method was removed
  // describe("updateStatus", () => { ... });

  describe("getDownloadUrl", () => {
    it("should get download URL successfully", async () => {
      const attachmentId = "attachment123";
      const mockDownloadData = {
        downloadUrl: "https://s3.amazonaws.com/signed-url",
        fileName: "test.jpg",
        fileType: "image/jpeg",
        fileSize: 1024000,
      };

      mockRequest.params = { id: attachmentId };
      vi.mocked(attachmentService.getDownloadUrl).mockResolvedValue(
        mockDownloadData,
      );

      await AttachmentController.getDownloadUrl(
        mockRequest as AuthenticatedRequest,
        mockResponse as Response,
        mockNext,
      );

      expect(attachmentService.getDownloadUrl).toHaveBeenCalledWith(
        attachmentId,
        "user123",
      );
      expect(mockResponse.status).toHaveBeenCalledWith(200);
      expect(mockResponse.json).toHaveBeenCalledWith(mockDownloadData);
    });

    it("should handle missing attachment ID", async () => {
      mockRequest.params = {}; // Missing ID

      await AttachmentController.getDownloadUrl(
        mockRequest as AuthenticatedRequest,
        mockResponse as Response,
        mockNext,
      );

      expect(attachmentService.getDownloadUrl).toHaveBeenCalledWith(
        undefined,
        "user123",
      );
    });
  });

  describe("deleteAttachment", () => {
    it("should delete attachment successfully", async () => {
      const attachmentId = "attachment123";
      const mockResult = { success: true };

      mockRequest.params = { id: attachmentId };
      vi.mocked(attachmentService.deleteAttachment).mockResolvedValue(
        mockResult,
      );

      await AttachmentController.deleteAttachment(
        mockRequest as AuthenticatedRequest,
        mockResponse as Response,
        mockNext,
      );

      expect(attachmentService.deleteAttachment).toHaveBeenCalledWith(
        attachmentId,
        "user123",
      );
      expect(mockResponse.status).toHaveBeenCalledWith(200);
      expect(mockResponse.json).toHaveBeenCalledWith(mockResult);
    });

    it("should handle service errors during deletion", async () => {
      const attachmentId = "attachment123";
      const mockError = new Error("Deletion failed");

      mockRequest.params = { id: attachmentId };
      vi.mocked(attachmentService.deleteAttachment).mockRejectedValue(
        mockError,
      );

      await AttachmentController.deleteAttachment(
        mockRequest as AuthenticatedRequest,
        mockResponse as Response,
        mockNext,
      );

      expect(mockNext).toHaveBeenCalledWith(mockError);
    });
  });

  describe("getUserAttachments", () => {
    it("should get user attachments successfully", async () => {
      const mockAttachmentsData = {
        attachments: [
          {
            _id: "att1",
            name: "file1.jpg",
            url: "https://cdn.domain.com/file1.jpg",
            type: "image/jpeg",
            size: 1000,
            uploadedBy: "user123",
            uploadedAt: new Date(),
            status: "ready",
            metadata: {
              s3: {
                bucket: "test-bucket",
                key: "file1-key",
                contentType: "image/jpeg",
                encrypted: false,
              },
            },
          },
          {
            _id: "att2",
            name: "file2.jpg",
            url: "https://cdn.domain.com/file2.jpg",
            type: "image/jpeg",
            size: 2000,
            uploadedBy: "user123",
            uploadedAt: new Date(),
            status: "ready",
            metadata: {
              s3: {
                bucket: "test-bucket",
                key: "file2-key",
                contentType: "image/jpeg",
                encrypted: false,
              },
            },
          },
        ],
        totalCount: 2,
        totalSize: 3000,
      };

      vi.mocked(attachmentService.getUserAttachments).mockResolvedValue(
        mockAttachmentsData as any,
      );

      await AttachmentController.getUserAttachments(
        mockRequest as AuthenticatedRequest,
        mockResponse as Response,
        mockNext,
      );

      expect(attachmentService.getUserAttachments).toHaveBeenCalledWith(
        "user123",
      );
      expect(mockResponse.status).toHaveBeenCalledWith(200);
      expect(mockResponse.json).toHaveBeenCalledWith(mockAttachmentsData);
    });

    it("should handle unauthorized requests", async () => {
      mockRequest.user = undefined;

      await AttachmentController.getUserAttachments(
        mockRequest as AuthenticatedRequest,
        mockResponse as Response,
        mockNext,
      );

      expect(mockNext).toHaveBeenCalledWith(expect.any(UnauthorizedError));
    });
  });
});
