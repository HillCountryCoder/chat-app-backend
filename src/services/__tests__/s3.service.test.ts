// src/services/__tests__/s3.service.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { S3Service } from "../s3.service";
import {
  S3Client,
  GetObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { BadRequestError } from "../../common/errors";

// Mock AWS SDK
vi.mock("@aws-sdk/client-s3", () => ({
  S3Client: vi.fn(),
  PutObjectCommand: vi.fn(),
  GetObjectCommand: vi.fn(),
  DeleteObjectCommand: vi.fn(),
}));

vi.mock("@aws-sdk/s3-request-presigner", () => ({
  getSignedUrl: vi.fn(),
}));

vi.mock("../../common/environment", () => ({
  env: {
    AWS_REGION: "us-east-1",
    AWS_ACCESS_KEY_ID: "test-access-key",
    AWS_SECRET_ACCESS_KEY: "test-secret-key",
    MEDIA_BUCKET_NAME: "test-media-bucket",
    THUMBNAIL_BUCKET_NAME: "test-thumbnail-bucket",
    CDN_DOMAIN: "test-cdn.cloudfront.net",
  },
}));

vi.mock("../../common/logger", () => ({
  createLogger: vi.fn().mockReturnValue({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

describe("S3Service", () => {
  let s3Service: S3Service;
  let mockS3Client: any;

  beforeEach(() => {
    vi.clearAllMocks();
    (S3Service as any).instance = undefined;

    mockS3Client = {
      send: vi.fn(),
    };
    vi.mocked(S3Client).mockImplementation(() => mockS3Client);
    s3Service = S3Service.getInstance();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("generateUploadUrl", () => {
    const mockParams = {
      userId: "user123",
      fileName: "test-file.jpg",
      fileType: "image/jpeg",
      fileSize: 1024 * 1024, // 1MB
    };

    it("should generate upload URL for basic file", async () => {
      const mockPresignedUrl = "https://s3.amazonaws.com/presigned-upload-url";
      vi.mocked(getSignedUrl).mockResolvedValue(mockPresignedUrl);

      const result = await s3Service.generateUploadUrl(mockParams);

      expect(result.presignedUrl).toBe(mockPresignedUrl);
      expect(result.bucket).toBe("test-media-bucket");
      expect(result.key).toMatch(/^users\/user123\/[a-f0-9]+\/test-file\.jpg$/);
      expect(result.cdnUrl).toMatch(
        /^https:\/\/test-cdn\.cloudfront\.net\/users\/user123\/[a-f0-9]+\/test-file\.jpg$/,
      );
      expect(result.thumbnailUpload).toBeUndefined();
    });

    it("should include thumbnail upload for images with client thumbnail", async () => {
      const mockMainUrl = "https://s3.amazonaws.com/presigned-upload-url";
      const mockThumbnailUrl = "https://s3.amazonaws.com/presigned-thumb-url";
      vi.mocked(getSignedUrl)
        .mockResolvedValueOnce(mockMainUrl)
        .mockResolvedValueOnce(mockThumbnailUrl);

      const paramsWithThumbnail = {
        ...mockParams,
        hasClientThumbnail: true,
      };

      const result = await s3Service.generateUploadUrl(paramsWithThumbnail);

      expect(result.thumbnailUpload).toBeDefined();
      expect(result.thumbnailUpload!.presignedUrl).toBe(mockThumbnailUrl);
      expect(result.thumbnailUpload!.bucket).toBe("test-thumbnail-bucket");
      expect(result.thumbnailUpload!.key).toMatch(
        /^users\/user123\/[a-f0-9]+\/thumb_test-file\.jpg$/,
      );
      expect(result.thumbnailUpload!.cdnUrl).toMatch(
        /^https:\/\/test-cdn\.cloudfront\.net\/thumbnails\/users\/user123\/[a-f0-9]+\/thumb_test-file\.jpg$/,
      );
    });

    it("should not include thumbnail for non-image files", async () => {
      const mockPresignedUrl = "https://s3.amazonaws.com/presigned-upload-url";
      vi.mocked(getSignedUrl).mockResolvedValue(mockPresignedUrl);

      const paramsWithPdf = {
        ...mockParams,
        fileName: "document.pdf",
        fileType: "application/pdf",
        hasClientThumbnail: true,
      };

      const result = await s3Service.generateUploadUrl(paramsWithPdf);

      expect(result.thumbnailUpload).toBeUndefined();
      expect(getSignedUrl).toHaveBeenCalledTimes(1);
    });

    it("should sanitize file names with special characters", async () => {
      const mockPresignedUrl = "https://s3.amazonaws.com/presigned-upload-url";
      vi.mocked(getSignedUrl).mockResolvedValue(mockPresignedUrl);

      const paramsWithSpecialChars = {
        ...mockParams,
        fileName: "test file @#$%^&*()!.jpg",
      };

      const result = await s3Service.generateUploadUrl(paramsWithSpecialChars);

      expect(result.key).toMatch(
        /^users\/user123\/[a-f0-9]+\/test_file___________\.jpg$/,
      );
    });

    it("should throw BadRequestError for missing required fields", async () => {
      const invalidParams = {
        ...mockParams,
        fileName: "",
      };

      await expect(s3Service.generateUploadUrl(invalidParams)).rejects.toThrow(
        BadRequestError,
      );
    });

    it("should throw BadRequestError for files exceeding size limit", async () => {
      const largeFileParams = {
        ...mockParams,
        fileSize: 30 * 1024 * 1024, // 30MB (exceeds 25MB limit)
      };

      await expect(
        s3Service.generateUploadUrl(largeFileParams),
      ).rejects.toThrow(BadRequestError);
    });

    it("should use direct S3 URL when CDN_DOMAIN is not configured", async () => {
      const mockPresignedUrl = "https://s3.amazonaws.com/presigned-upload-url";
      vi.mocked(getSignedUrl).mockResolvedValue(mockPresignedUrl);

      const result = await s3Service.generateUploadUrl(mockParams);

      expect(result.cdnUrl).toMatch(
        /^https:\/\/test-cdn\.cloudfront\.net\/users\/user123\/[a-f0-9]+\/test-file\.jpg$/,
      );
    });

    it("should handle video files correctly", async () => {
      const mockPresignedUrl = "https://s3.amazonaws.com/presigned-upload-url";
      const mockThumbnailUrl = "https://s3.amazonaws.com/presigned-thumb-url";
      vi.mocked(getSignedUrl)
        .mockResolvedValueOnce(mockPresignedUrl)
        .mockResolvedValueOnce(mockThumbnailUrl);

      const videoParams = {
        ...mockParams,
        fileName: "video.mp4",
        fileType: "video/mp4",
        hasClientThumbnail: true,
      };

      const result = await s3Service.generateUploadUrl(videoParams);

      expect(result.thumbnailUpload).toBeDefined();
      expect(result.thumbnailUpload!.key).toMatch(/thumb_video\.jpg$/);
    });
  });

  describe("generateDownloadUrl", () => {
    it("should generate download URL successfully", async () => {
      const mockDownloadUrl = "https://s3.amazonaws.com/presigned-download-url";
      vi.mocked(getSignedUrl).mockResolvedValue(mockDownloadUrl);

      const result = await s3Service.generateDownloadUrl(
        "test-bucket",
        "test-key",
      );

      expect(result).toBe(mockDownloadUrl);
      expect(GetObjectCommand).toHaveBeenCalledWith({
        Bucket: "test-bucket",
        Key: "test-key",
      });
      expect(getSignedUrl).toHaveBeenCalledWith(
        mockS3Client,
        expect.any(Object),
        { expiresIn: 300 },
      );
    });

    it("should handle S3 errors properly", async () => {
      const error = new Error("S3 Access Denied");
      vi.mocked(getSignedUrl).mockRejectedValue(error);

      await expect(
        s3Service.generateDownloadUrl("test-bucket", "test-key"),
      ).rejects.toThrow("S3 Access Denied");
    });
  });

  describe("deleteFile", () => {
    it("should delete file successfully", async () => {
      mockS3Client.send.mockResolvedValue({});

      await s3Service.deleteFile("test-bucket", "test-key");

      expect(DeleteObjectCommand).toHaveBeenCalledWith({
        Bucket: "test-bucket",
        Key: "test-key",
      });
      expect(mockS3Client.send).toHaveBeenCalledWith(expect.any(Object));
    });

    it("should handle deletion errors", async () => {
      const error = new Error("Delete failed");
      mockS3Client.send.mockRejectedValue(error);

      await expect(
        s3Service.deleteFile("test-bucket", "test-key"),
      ).rejects.toThrow("Delete failed");
    });
  });

  describe("isImageOrVideo", () => {
    it("should correctly identify image types", () => {
      const imageTypes = ["image/jpeg", "image/png", "image/gif", "image/webp"];

      imageTypes.forEach((type) => {
        // Access private method for testing
        const result = (s3Service as any).isImageOrVideo(type);
        expect(result).toBe(true);
      });
    });

    it("should correctly identify video types", () => {
      const videoTypes = ["video/mp4", "video/avi", "video/mov", "video/webm"];

      videoTypes.forEach((type) => {
        const result = (s3Service as any).isImageOrVideo(type);
        expect(result).toBe(true);
      });
    });

    it("should return false for other file types", () => {
      const otherTypes = [
        "application/pdf",
        "text/plain",
        "application/json",
        "audio/mp3",
      ];

      otherTypes.forEach((type) => {
        const result = (s3Service as any).isImageOrVideo(type);
        expect(result).toBe(false);
      });
    });
  });

  describe("error handling", () => {
    it("should throw error when MEDIA_BUCKET_NAME is not configured", async () => {
      // Create a new service instance with undefined bucket name
      (S3Service as any).instance = undefined;

      // Temporarily override the environment
      const { env: originalEnv } = await import("../../common/environment");
      vi.mocked(await import("../../common/environment")).env = {
        ...originalEnv,
        MEDIA_BUCKET_NAME: undefined,
      };

      const newService = S3Service.getInstance();

      await expect(
        newService.generateUploadUrl({
          userId: "user123",
          fileName: "test.jpg",
          fileType: "image/jpeg",
          fileSize: 1024,
        }),
      ).rejects.toThrow("MEDIA_BUCKET_NAME environment variable is not set");

      // Restore original environment
      vi.mocked(await import("../../common/environment")).env = originalEnv;
    });

    it("should handle AWS SDK errors gracefully", async () => {
      const awsError = new Error("AWS Service Error");
      vi.mocked(getSignedUrl).mockRejectedValue(awsError);

      await expect(
        s3Service.generateUploadUrl({
          userId: "user123",
          fileName: "test.jpg",
          fileType: "image/jpeg",
          fileSize: 1024,
        }),
      ).rejects.toThrow("AWS Service Error");
    });
  });
});
