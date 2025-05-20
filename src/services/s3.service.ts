import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import crypto from "crypto";
import { createLogger } from "../common/logger";
import { env } from "../common/environment";
import { BadRequestError } from "../common/errors";

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
  }): Promise<{
    presignedUrl: string;
    key: string;
    bucket: string;
    cdnUrl: string;
  }> {
    const { userId, fileName, fileType, fileSize } = params;

    // Validate input
    if (!fileName || !fileType) {
      throw new BadRequestError("File name and type are required");
    }

    // Check file size (25MB limit)
    const MAX_FILE_SIZE = 25 * 1024 * 1024;
    if (fileSize > MAX_FILE_SIZE) {
      throw new BadRequestError("File size exceeds the 25MB limit");
    }

    // Generate a unique key
    const randomId = crypto.randomBytes(16).toString("hex");
    const sanitizedFileName = fileName.replace(/[^a-zA-Z0-9.-]/g, "_");
    const key = `users/${userId}/${randomId}/${sanitizedFileName}`;

    const bucket = env.MEDIA_BUCKET_NAME || "";
    if (!bucket) {
      throw new Error("MEDIA_BUCKET_NAME environment variable is not set");
    }

    // Generate pre-signed URL for upload
    const command = new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      ContentType: fileType,
    });

    const presignedUrl = await getSignedUrl(this.s3Client, command, {
      expiresIn: 900, // 15 minutes
    });

    // Generate CDN URL
    const cdnUrl = env.CDN_DOMAIN
      ? `https://${env.CDN_DOMAIN}/${key}`
      : `https://${bucket}.s3.${
          env.AWS_REGION || "us-east-1"
        }.amazonaws.com/${key}`;

    logger.info("Generated upload URL", {
      userId,
      key,
      fileType,
    });

    return {
      presignedUrl,
      key,
      bucket,
      cdnUrl,
    };
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
}

export const s3Service = S3Service.getInstance();
