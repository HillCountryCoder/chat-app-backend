import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import crypto from "crypto";
import { createLogger } from "../common/logger";
import { env } from "../common/environment";
import { BadRequestError } from "../common/errors";
import { MAX_FILE_SIZE } from "../constants";

const logger = createLogger("s3-service");

export class S3Service {
  private static instance: S3Service;
  private s3Client: S3Client;

  private constructor() {
    this.s3Client = new S3Client({
      region: env.AWS_REGION || "us-east-1",
      credentials:
        env.AWS_ACCESS_KEY_ID && env.AWS_SECRET_ACCESS_KEY
          ? {
              accessKeyId: env.AWS_ACCESS_KEY_ID,
              secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
            }
          : undefined,
    });
  }

  static getInstance(): S3Service {
    if (!S3Service.instance) {
      S3Service.instance = new S3Service();
    }
    return S3Service.instance;
  }

  async generateUploadUrl(params: {
    userId: string;
    fileName: string;
    fileType: string;
    fileSize: number;
    hasClientThumbnail?: boolean;
  }): Promise<{
    presignedUrl: string;
    key: string;
    bucket: string;
    cdnUrl: string;
    thumbnailUpload?: {
      presignedUrl: string;
      key: string;
      bucket: string;
      cdnUrl: string;
    };
  }> {
    const { userId, fileName, fileType, fileSize, hasClientThumbnail } = params;

    // Validate input
    if (!fileName || !fileType) {
      throw new BadRequestError("File name and type are required");
    }

    // Check file size (25MB limit)
    if (fileSize > MAX_FILE_SIZE) {
      throw new BadRequestError("File size exceeds the 25MB limit");
    }

    // Generate a unique key
    const randomId = crypto.randomBytes(16).toString("hex");
    const sanitizedFileName = fileName.replace(/[^a-zA-Z0-9.-]/g, "_");
    const key = `users/${userId}/${randomId}/${sanitizedFileName}`;

    const mediaBucket = env.MEDIA_BUCKET_NAME;
    if (!mediaBucket) {
      throw new Error("MEDIA_BUCKET_NAME environment variable is not set");
    }

    // Generate pre-signed URL for main file upload
    const mainUploadCommand = new PutObjectCommand({
      Bucket: mediaBucket,
      Key: key,
      ContentType: fileType,
    });

    const presignedUrl = await getSignedUrl(this.s3Client, mainUploadCommand, {
      expiresIn: 900, // 15 minutes
    });

    // Generate CDN URL for main file
    const cdnUrl = env.CDN_DOMAIN
      ? `https://${env.CDN_DOMAIN}/${key}`
      : `https://${mediaBucket}.s3.${
          env.AWS_REGION || "us-east-1"
        }.amazonaws.com/${key}`;

    const result: {
      presignedUrl: string;
      key: string;
      bucket: string;
      cdnUrl: string;
      thumbnailUpload?: {
        presignedUrl: string;
        key: string;
        bucket: string;
        cdnUrl: string;
      };
    } = {
      presignedUrl,
      key,
      bucket: mediaBucket,
      cdnUrl,
    };

    // Generate thumbnail upload URL if client will upload thumbnail
    if (hasClientThumbnail && this.isImageOrVideo(fileType)) {
      const thumbnailBucket = env.THUMBNAIL_BUCKET_NAME;
      if (!thumbnailBucket) {
        logger.warn(
          "THUMBNAIL_BUCKET_NAME not configured, skipping thumbnail upload URL",
        );
      } else {
        const thumbnailKey = `users/${userId}/${randomId}/thumb_${sanitizedFileName.replace(
          /\.[^.]+$/,
          ".jpg",
        )}`;

        const thumbnailUploadCommand = new PutObjectCommand({
          Bucket: thumbnailBucket,
          Key: thumbnailKey,
          ContentType: "image/jpeg",
        });

        const thumbnailPresignedUrl = await getSignedUrl(
          this.s3Client,
          thumbnailUploadCommand,
          { expiresIn: 900 },
        );

        const thumbnailCdnUrl = env.CDN_DOMAIN
          ? `https://${env.CDN_DOMAIN}/thumbnails/${thumbnailKey}`
          : `https://${thumbnailBucket}.s3.${
              env.AWS_REGION || "us-east-1"
            }.amazonaws.com/${thumbnailKey}`;

        result.thumbnailUpload = {
          presignedUrl: thumbnailPresignedUrl,
          key: thumbnailKey,
          bucket: thumbnailBucket,
          cdnUrl: thumbnailCdnUrl,
        };
      }
    }

    logger.info("Generated upload URL(s)", {
      userId,
      key,
      fileType,
      hasThumbnailUpload: !!result.thumbnailUpload,
    });

    return result;
  }

  async generateUploadUrlWithKey(params: {
    key: string; // Pre-generated tenant-scoped key
    fileType: string;
    fileSize: number;
    hasClientThumbnail?: boolean;
  }): Promise<{
    presignedUrl: string;
    key: string;
    bucket: string;
    cdnUrl: string;
    thumbnailUpload?: {
      presignedUrl: string;
      key: string;
      bucket: string;
      cdnUrl: string;
    };
  }> {
    const { key, fileType, fileSize, hasClientThumbnail } = params;

    // Validate input
    if (!key || !fileType) {
      throw new BadRequestError("Key and file type are required");
    }

    // Check file size (25MB limit)
    if (fileSize > MAX_FILE_SIZE) {
      throw new BadRequestError("File size exceeds the 25MB limit");
    }

    const mediaBucket = env.MEDIA_BUCKET_NAME;
    if (!mediaBucket) {
      throw new Error("MEDIA_BUCKET_NAME environment variable is not set");
    }

    // Generate pre-signed URL for main file upload
    const mainUploadCommand = new PutObjectCommand({
      Bucket: mediaBucket,
      Key: key,
      ContentType: fileType,
    });

    const presignedUrl = await getSignedUrl(this.s3Client, mainUploadCommand, {
      expiresIn: 900, // 15 minutes
    });

    // Generate CDN URL for main file
    const cdnUrl = env.CDN_DOMAIN
      ? `https://${env.CDN_DOMAIN}/${key}`
      : `https://${mediaBucket}.s3.${
          env.AWS_REGION || "us-east-1"
        }.amazonaws.com/${key}`;

    const result: {
      presignedUrl: string;
      key: string;
      bucket: string;
      cdnUrl: string;
      thumbnailUpload?: {
        presignedUrl: string;
        key: string;
        bucket: string;
        cdnUrl: string;
      };
    } = {
      presignedUrl,
      key,
      bucket: mediaBucket,
      cdnUrl,
    };

    // Generate thumbnail upload URL if needed
    if (hasClientThumbnail && this.isImageOrVideo(fileType)) {
      const thumbnailBucket = env.THUMBNAIL_BUCKET_NAME;
      if (!thumbnailBucket) {
        logger.warn(
          "THUMBNAIL_BUCKET_NAME not configured, skipping thumbnail upload URL",
        );
      } else {
        // Extract tenant/user path from the main key
        const keyParts = key.split("/");
        const fileName = keyParts[keyParts.length - 1];
        const pathPrefix = keyParts.slice(0, -1).join("/");

        const thumbnailKey = `${pathPrefix}/thumb_${fileName.replace(
          /\.[^.]+$/,
          ".jpg",
        )}`;

        const thumbnailUploadCommand = new PutObjectCommand({
          Bucket: thumbnailBucket,
          Key: thumbnailKey,
          ContentType: "image/jpeg",
        });

        const thumbnailPresignedUrl = await getSignedUrl(
          this.s3Client,
          thumbnailUploadCommand,
          { expiresIn: 900 },
        );

        const thumbnailCdnUrl = env.CDN_DOMAIN
          ? `https://${env.CDN_DOMAIN}/thumbnails/${thumbnailKey}`
          : `https://${thumbnailBucket}.s3.${
              env.AWS_REGION || "us-east-1"
            }.amazonaws.com/${thumbnailKey}`;

        result.thumbnailUpload = {
          presignedUrl: thumbnailPresignedUrl,
          key: thumbnailKey,
          bucket: thumbnailBucket,
          cdnUrl: thumbnailCdnUrl,
        };
      }
    }

    logger.info("Generated upload URL(s) with custom key", {
      key,
      fileType,
      hasThumbnailUpload: !!result.thumbnailUpload,
    });

    return result;
  }

  async generateDownloadUrl(bucket: string, key: string): Promise<string> {
    const command = new GetObjectCommand({
      Bucket: bucket,
      Key: key,
    });

    const presignedUrl = await getSignedUrl(this.s3Client, command, {
      expiresIn: 300, // 5 minutes
    });

    logger.info("Generated download URL", { bucket, key });

    return presignedUrl;
  }

  async deleteFile(bucket: string, key: string): Promise<void> {
    const command = new DeleteObjectCommand({
      Bucket: bucket,
      Key: key,
    });

    await this.s3Client.send(command);

    logger.info("Deleted file", { bucket, key });
  }

  private isImageOrVideo(mimeType: string): boolean {
    return mimeType.startsWith("image/") || mimeType.startsWith("video/");
  }

  /**
   * Get file metadata from S3
   */
  async getFileMetadata(bucket: string, key: string) {
    const command = new HeadObjectCommand({
      Bucket: bucket,
      Key: key,
    });

    const response = await this.s3Client.send(command);

    logger.info("Retrieved file metadata", {
      bucket,
      key,
      contentLength: response.ContentLength,
      contentType: response.ContentType,
      eTag: response.ETag,
      lastModified: response.LastModified,
    });

    return response;
  }

  /**
   * Get first N bytes of a file for validation (magic number checking)
   */
  async getFileHead(
    bucket: string,
    key: string,
    bytes: number = 1024,
  ): Promise<Buffer> {
    const command = new GetObjectCommand({
      Bucket: bucket,
      Key: key,
      Range: `bytes=0-${bytes - 1}`, // Get first N bytes
    });

    const response = await this.s3Client.send(command);

    if (!response.Body) {
      throw new Error("No file content received");
    }

    // Convert stream to buffer
    const chunks: Uint8Array[] = [];
    const reader = response.Body.transformToWebStream().getReader();

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }

    const buffer = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)));

    logger.debug("Retrieved file head", {
      bucket,
      key,
      bytesRequested: bytes,
      bytesReceived: buffer.length,
    });

    return buffer;
  }
}

export const s3Service = S3Service.getInstance();
