import { vi } from "vitest";

export class AWSMockHelper {
  /**
   * Mock successful S3 operations
   */
  static mockS3Success() {
    const mockS3Client = {
      send: vi.fn(),
    };

    // Mock successful put object
    mockS3Client.send.mockImplementation((command) => {
      if (command.constructor.name === "PutObjectCommand") {
        return Promise.resolve({
          ETag: '"mock-etag-12345"',
          VersionId: "mock-version-id",
        });
      }

      if (command.constructor.name === "GetObjectCommand") {
        return Promise.resolve({
          Body: Buffer.from("mock file content"),
          ContentLength: 1024,
          ContentType: "image/jpeg",
          ETag: '"mock-etag-12345"',
        });
      }

      if (command.constructor.name === "DeleteObjectCommand") {
        return Promise.resolve({
          DeleteMarker: false,
          VersionId: "mock-version-id",
        });
      }

      return Promise.resolve({});
    });

    return mockS3Client;
  }

  /**
   * Mock S3 errors
   */
  static mockS3Error(
    errorType: "NoSuchKey" | "AccessDenied" | "BucketNotFound" = "NoSuchKey",
  ) {
    const mockS3Client = {
      send: vi.fn(),
    };

    const error = new Error(`Mock ${errorType} error`);
    error.name = errorType;

    mockS3Client.send.mockRejectedValue(error);

    return mockS3Client;
  }

  /**
   * Mock presigned URL generation
   */
  static mockPresignedUrls() {
    const mockGetSignedUrl = vi.fn();

    mockGetSignedUrl.mockImplementation((client, command) => {
      const bucket = command.input.Bucket;
      const key = command.input.Key;
      return Promise.resolve(
        `https://mock-presigned-url.s3.amazonaws.com/${bucket}/${key}?signature=mock`,
      );
    });

    return mockGetSignedUrl;
  }

  /**
   * Mock Lambda processing
   */
  static mockLambdaProcessing() {
    return {
      processVideo: vi.fn().mockResolvedValue({
        thumbnail: {
          s3Key: "users/test/thumb_video.jpg",
          url: "https://cdn.domain.com/thumb_video.jpg",
          width: 320,
          height: 240,
        },
      }),

      scanVirus: vi.fn().mockResolvedValue({
        clean: true,
        scanTime: 1500,
      }),

      optimizeImage: vi.fn().mockResolvedValue({
        compression: {
          algorithm: "webp",
          quality: 85,
          compressionRatio: 0.75,
        },
      }),
    };
  }
}
