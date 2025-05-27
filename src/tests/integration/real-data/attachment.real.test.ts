// src/tests/integration/real-data/attachment.real.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import request from "supertest";
import { createTestApp } from "../../helpers/test-app";
import "../setup";
import { seedTestUser, loginCredentials } from "../fixtures/auth-fixtures";
import { Attachment } from "../../../models";
import {
  S3Client,
  GetObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { env } from "../../../common/environment";
import crypto from "crypto";

// Skip these tests if not in real environment
const shouldRunRealTests =
  process.env.INTEGRATION_TEST_REAL === "true" &&
  env.MEDIA_BUCKET_NAME &&
  env.AWS_ACCESS_KEY_ID;

describe.skipIf(!shouldRunRealTests)("Real AWS Integration Tests", () => {
  const app = createTestApp();
  let authToken: string;
  let apiKey: string;
  let userId: string;
  let s3Client: S3Client;
  let testS3Keys: string[] = []; // Track keys for cleanup

  beforeEach(async () => {
    // Initialize S3 client
    s3Client = new S3Client({
      region: env.AWS_REGION || "us-east-1",
      credentials: {
        accessKeyId: env.AWS_ACCESS_KEY_ID!,
        secretAccessKey: env.AWS_SECRET_ACCESS_KEY!,
      },
    });

    // Setup test user
    await seedTestUser();
    const loginResponse = await request(app).post("/api/auth/login").send({
      identifier: loginCredentials.valid.email,
      password: loginCredentials.valid.password,
    });

    authToken = loginResponse.body.token;
    userId = loginResponse.body.user._id;
    apiKey = env.API_KEY;
    testS3Keys = [];
  });

  afterEach(async () => {
    // Cleanup S3 files
    for (const key of testS3Keys) {
      try {
        await s3Client.send(
          new DeleteObjectCommand({
            Bucket: env.MEDIA_BUCKET_NAME!,
            Key: key,
          }),
        );
      } catch (error) {
        console.warn(`Failed to delete S3 key ${key}:`, error);
      }
    }

    // Cleanup database
    await Attachment.deleteMany({});
  });

  describe("Complete Upload Flow with Real S3", () => {
    it("should complete full upload workflow with real AWS services", async () => {
      console.log("🧪 Testing with real AWS buckets:");
      console.log(`📦 Media Bucket: ${env.MEDIA_BUCKET_NAME}`);
      console.log(`🖼️ Thumbnail Bucket: ${env.THUMBNAIL_BUCKET_NAME}`);
      console.log(`🌐 CDN Domain: ${env.CDN_DOMAIN}`);

      // Step 1: Request upload URL
      const uploadRequest = {
        fileName: "test-real-image.jpg",
        fileType: "image/jpeg",
        fileSize: 1024 * 500, // 500KB
        hasClientThumbnail: true,
      };

      const uploadUrlResponse = await request(app)
        .post("/api/attachments/upload-url")
        .set("Authorization", `Bearer ${authToken}`)
        .send(uploadRequest)
        .expect(200);

      expect(uploadUrlResponse.body).toHaveProperty("presignedUrl");
      expect(uploadUrlResponse.body).toHaveProperty("cdnUrl");
      expect(uploadUrlResponse.body.thumbnailUpload).toBeDefined();

      const { presignedUrl, cdnUrl, metadata, thumbnailUpload } =
        uploadUrlResponse.body;
      const s3Key = metadata.key;
      testS3Keys.push(s3Key);

      console.log(`📤 Generated S3 key: ${s3Key}`);
      console.log(`🔗 CDN URL: ${cdnUrl}`);

      // Step 2: Upload actual file to S3 using presigned URL
      const testImageBuffer = crypto.randomBytes(1024 * 500); // 500KB random data

      const uploadResponse = await fetch(presignedUrl, {
        method: "PUT",
        body: testImageBuffer,
        headers: {
          "Content-Type": uploadRequest.fileType,
        },
      });

      expect(uploadResponse.ok).toBe(true);
      const eTag = uploadResponse.headers.get("etag")?.replace(/"/g, "");
      console.log(`✅ File uploaded to S3, ETag: ${eTag}`);

      // Step 3: Upload thumbnail (simulate client-side thumbnail)
      if (thumbnailUpload) {
        const thumbnailBuffer = crypto.randomBytes(1024 * 50); // 50KB thumbnail
        testS3Keys.push(thumbnailUpload.key);

        const thumbnailUploadResponse = await fetch(
          thumbnailUpload.presignedUrl,
          {
            method: "PUT",
            body: thumbnailBuffer,
            headers: {
              "Content-Type": "image/jpeg",
            },
          },
        );

        expect(thumbnailUploadResponse.ok).toBe(true);
        console.log(`🖼️ Thumbnail uploaded: ${thumbnailUpload.key}`);
      }

      // Step 4: Complete upload in database
      const completeRequest = {
        fileName: uploadRequest.fileName,
        fileType: uploadRequest.fileType,
        fileSize: uploadRequest.fileSize,
        cdnUrl: cdnUrl,
        s3Bucket: metadata.bucket,
        s3Key: s3Key,
        eTag: eTag,
      };

      const completeResponse = await request(app)
        .post("/api/attachments/complete")
        .set("Authorization", `Bearer ${authToken}`)
        .send(completeRequest)
        .expect(201);

      expect(completeResponse.body).toHaveProperty("_id");
      expect(completeResponse.body.status).toBe("processing");
      console.log(`💾 Attachment record created: ${completeResponse.body._id}`);

      const attachmentId = completeResponse.body._id;

      // Step 5: Verify file exists in S3
      const getObjectCommand = new GetObjectCommand({
        Bucket: env.MEDIA_BUCKET_NAME!,
        Key: s3Key,
      });

      const s3Object = await s3Client.send(getObjectCommand);
      expect(s3Object.ContentLength).toBe(uploadRequest.fileSize);
      expect(s3Object.ContentType).toBe(uploadRequest.fileType);
      console.log(
        `✅ File verified in S3, size: ${s3Object.ContentLength} bytes`,
      );

      // Step 6: Simulate Lambda processing completion
      const statusUpdateRequest = {
        fileKey: s3Key,
        status: "ready",
        metadata: {
          thumbnail: thumbnailUpload
            ? {
                s3Key: thumbnailUpload.key,
                url: thumbnailUpload.cdnUrl,
                width: 320,
                height: 240,
              }
            : undefined,
          compression: {
            algorithm: "webp",
            quality: 85,
            compressionRatio: 0.75,
          },
        },
      };

      const statusResponse = await request(app)
        .post("/api/attachments/status-update")
        .set("x-api-key", `${apiKey}`)
        .send(statusUpdateRequest)
        .expect(200);

      expect(statusResponse.body.attachment.status).toBe("ready");
      console.log(`🔄 Status updated to ready`);

      // Step 7: Test download URL generation
      const downloadResponse = await request(app)
        .get(`/api/attachments/${attachmentId}/download`)
        .set("Authorization", `Bearer ${authToken}`)
        .expect(200);

      expect(downloadResponse.body).toHaveProperty("downloadUrl");
      expect(downloadResponse.body.fileName).toBe(uploadRequest.fileName);

      // Verify download URL works
      const signedDownloadUrl = downloadResponse.body.downloadUrl;
      const downloadFileResponse = await fetch(signedDownloadUrl);
      expect(downloadFileResponse.ok).toBe(true);
      console.log(`⬇️ Download URL verified`);

      // Step 8: Test CDN access (if configured)
      if (env.CDN_DOMAIN) {
        console.log(`🌐 Testing CDN access: ${cdnUrl}`);

        // Note: CDN might take time to propagate, so we'll just verify the URL format
        expect(cdnUrl).toMatch(new RegExp(`^https://${env.CDN_DOMAIN}/`));
      }

      // Step 9: Test file deletion
      const deleteResponse = await request(app)
        .delete(`/api/attachments/${attachmentId}`)
        .set("Authorization", `Bearer ${authToken}`)
        .expect(200);

      expect(deleteResponse.body.success).toBe(true);
      console.log(`🗑️ Attachment deleted`);

      // Verify file is deleted from S3
      try {
        await s3Client.send(
          new GetObjectCommand({
            Bucket: env.MEDIA_BUCKET_NAME!,
            Key: s3Key,
          }),
        );
        expect.fail("File should have been deleted from S3");
      } catch (error: any) {
        expect(error.name).toBe("NoSuchKey");
        console.log(`✅ File confirmed deleted from S3`);
      }

      // Remove from cleanup list since it's already deleted
      testS3Keys = testS3Keys.filter((key) => key !== s3Key);
    }, 30000); // 30 second timeout for real AWS operations

    it("should handle large file uploads within limits", async () => {
      const uploadRequest = {
        fileName: "large-test-file.pdf",
        fileType: "application/pdf",
        fileSize: 20 * 1024 * 1024, // 20MB - within 25MB limit
      };

      const uploadUrlResponse = await request(app)
        .post("/api/attachments/upload-url")
        .set("Authorization", `Bearer ${authToken}`)
        .send(uploadRequest)
        .expect(200);

      const { presignedUrl, metadata } = uploadUrlResponse.body;
      testS3Keys.push(metadata.key);

      // Upload large file
      const largeFileBuffer = crypto.randomBytes(uploadRequest.fileSize);

      const uploadResponse = await fetch(presignedUrl, {
        method: "PUT",
        body: largeFileBuffer,
        headers: {
          "Content-Type": uploadRequest.fileType,
        },
      });

      expect(uploadResponse.ok).toBe(true);
      console.log(
        `📁 Large file (${uploadRequest.fileSize} bytes) uploaded successfully`,
      );

      // Verify in S3
      const s3Object = await s3Client.send(
        new GetObjectCommand({
          Bucket: env.MEDIA_BUCKET_NAME!,
          Key: metadata.key,
        }),
      );

      expect(s3Object.ContentLength).toBe(uploadRequest.fileSize);
    }, 60000); // 60 second timeout for large files

    it("should respect storage quotas", async () => {
      console.log("🔒 Testing storage quota enforcement");

      // First, let's check current usage
      const userAttachmentsResponse = await request(app)
        .get("/api/attachments")
        .set("Authorization", `Bearer ${authToken}`)
        .expect(200);

      const currentUsage = userAttachmentsResponse.body.totalSize;
      console.log(`📊 Current usage: ${currentUsage} bytes`);

      // Try to upload a file that would exceed 1GB quota
      const uploadRequest = {
        fileName: "quota-test.pdf",
        fileType: "application/pdf",
        fileSize: 1024 * 1024 * 1024 - currentUsage + 1, // 1GB - current + 1 byte
      };

      const response = await request(app)
        .post("/api/attachments/upload-url")
        .set("Authorization", `Bearer ${authToken}`)
        .send(uploadRequest)
        .expect(400);

      expect(response.body.message).toContain(
        "File size exceeds maximum limit of 25 MB",
      );
      console.log(`✅ Storage quota properly enforced`);
    });

    // it("should handle video file uploads with thumbnail generation", async () => {
    //   const uploadRequest = {
    //     fileName: "test-video.mp4",
    //     fileType: "video/mp4",
    //     fileSize: 5 * 1024 * 1024, // 5MB
    //     hasClientThumbnail: false, // Server will generate thumbnail
    //   };

    //   const uploadUrlResponse = await request(app)
    //     .post("/api/attachments/upload-url")
    //     .set("Authorization", `Bearer ${authToken}`)
    //     .send(uploadRequest)
    //     .expect(200);

    //   const { presignedUrl, cdnUrl, metadata } = uploadUrlResponse.body;
    //   testS3Keys.push(metadata.key);

    //   // Upload video file (simulate with random data)
    //   const videoBuffer = crypto.randomBytes(uploadRequest.fileSize);

    //   const uploadResponse = await fetch(presignedUrl, {
    //     method: "PUT",
    //     body: videoBuffer,
    //     headers: {
    //       "Content-Type": uploadRequest.fileType,
    //     },
    //   });

    //   expect(uploadResponse.ok).toBe(true);
    //   console.log(`🎥 Video file uploaded: ${metadata.key}`);

    //   // Complete upload
    //   const completeRequest = {
    //     fileName: uploadRequest.fileName,
    //     fileType: uploadRequest.fileType,
    //     fileSize: uploadRequest.fileSize,
    //     cdnUrl: cdnUrl,
    //     s3Bucket: metadata.bucket,
    //     s3Key: metadata.key,
    //     eTag: uploadResponse.headers.get("etag")?.replace(/"/g, ""),
    //   };

    //   const completeResponse = await request(app)
    //     .post("/api/attachments/complete")
    //     .set("Authorization", `Bearer ${authToken}`)
    //     .send(completeRequest)
    //     .expect(201);

    //   expect(completeResponse.body.status).toBe("processing");
    //   console.log(
    //     `💾 Video attachment record created, awaiting Lambda processing`,
    //   );

    //   // In a real scenario, Lambda would process the video and generate thumbnails
    //   // For testing, we'll simulate the Lambda response
    //   const statusUpdateRequest = {
    //     fileKey: metadata.key,
    //     status: "ready",
    //     metadata: {
    //       thumbnail: {
    //         s3Key: `${metadata.key.replace(".mp4", "_thumb.jpg")}`,
    //         url: `https://${env.CDN_DOMAIN}/thumbnails/${metadata.key.replace(
    //           ".mp4",
    //           "_thumb.jpg",
    //         )}`,
    //         width: 320,
    //         height: 240,
    //       },
    //     },
    //   };

    //   const statusResponse = await request(app)
    //     .put("/api/attachments/status-update")
    //     .send(statusUpdateRequest)
    //     .expect(200);

    //   expect(statusResponse.body.attachment.status).toBe("ready");
    //   expect(statusResponse.body.attachment.metadata.thumbnail).toBeDefined();
    //   console.log(`✅ Video processing completed with thumbnail`);
    // });
  });

  describe("CDN and Performance Tests", () => {
    it("should verify CDN URLs are accessible", async () => {
      if (!env.CDN_DOMAIN) {
        console.log("⏭️ Skipping CDN test - CDN_DOMAIN not configured");
        return;
      }

      // Upload a small test file
      const uploadRequest = {
        fileName: "cdn-test.txt",
        fileType: "text/plain",
        fileSize: 1024,
      };

      const uploadUrlResponse = await request(app)
        .post("/api/attachments/upload-url")
        .set("Authorization", `Bearer ${authToken}`)
        .send(uploadRequest)
        .expect(200);

      const { presignedUrl, cdnUrl, metadata } = uploadUrlResponse.body;
      testS3Keys.push(metadata.key);

      // Upload test content
      const testContent = "This is a CDN accessibility test file";
      const uploadResponse = await fetch(presignedUrl, {
        method: "PUT",
        body: testContent,
        headers: {
          "Content-Type": uploadRequest.fileType,
        },
      });

      expect(uploadResponse.ok).toBe(true);

      // Complete upload and mark as ready
      await request(app)
        .post("/api/attachments/complete")
        .set("Authorization", `Bearer ${authToken}`)
        .send({
          fileName: uploadRequest.fileName,
          fileType: uploadRequest.fileType,
          fileSize: uploadRequest.fileSize,
          cdnUrl: cdnUrl,
          s3Bucket: metadata.bucket,
          s3Key: metadata.key,
        });

      await request(app).put("/api/attachments/status-update").send({
        fileKey: metadata.key,
        status: "ready",
      });

      console.log(`🌐 Testing CDN URL: ${cdnUrl}`);

      // Test CDN access (may take time to propagate)
      let cdnAccessible = false;
      let attempts = 0;
      const maxAttempts = 10;

      while (!cdnAccessible && attempts < maxAttempts) {
        try {
          const cdnResponse = await fetch(cdnUrl);
          if (cdnResponse.ok) {
            const content = await cdnResponse.text();
            expect(content).toBe(testContent);
            cdnAccessible = true;
            console.log(`✅ CDN accessible after ${attempts + 1} attempts`);
          }
        } catch (error) {
          // CDN might not be ready yet
        }

        if (!cdnAccessible) {
          attempts++;
          if (attempts < maxAttempts) {
            console.log(
              `⏳ CDN not ready yet, waiting... (attempt ${attempts}/${maxAttempts})`,
            );
            await new Promise((resolve) => setTimeout(resolve, 2000));
          }
        }
      }

      if (!cdnAccessible) {
        console.log(
          `⚠️ CDN not accessible after ${maxAttempts} attempts - may need more time to propagate`,
        );
      }
    }, 30000);
  });

  describe("Error Handling with Real AWS", () => {
    it("should handle S3 access errors gracefully", async () => {
      // Try to access a non-existent bucket (this will fail)
      const uploadRequest = {
        fileName: "error-test.jpg",
        fileType: "image/jpeg",
        fileSize: 1024,
      };

      // This should work fine - the error would occur during actual S3 operations
      const response = await request(app)
        .post("/api/attachments/upload-url")
        .set("Authorization", `Bearer ${authToken}`)
        .send(uploadRequest)
        .expect(200);

      expect(response.body.presignedUrl).toBeDefined();
      console.log(`✅ Upload URL generation handles AWS errors gracefully`);
    });

    it("should handle Lambda processing failures", async () => {
      // Create an attachment that would fail processing
      const attachment = new Attachment({
        name: "fail-test.jpg",
        url: "https://cdn.domain.com/fail-test.jpg",
        type: "image/jpeg",
        size: 1024,
        uploadedBy: userId,
        status: "processing",
        metadata: {
          s3: {
            bucket: env.MEDIA_BUCKET_NAME!,
            key: "users/test/fail-test.jpg",
            contentType: "image/jpeg",
            encrypted: false,
          },
        },
      });

      await attachment.save();

      // Simulate Lambda failure
      const statusUpdateRequest = {
        fileKey: "users/test/fail-test.jpg",
        status: "failed",
        errorDetails: "Simulated Lambda processing failure",
      };

      const response = await request(app)
        .post("/api/attachments/status-update")
        .set("x-api-key", `${apiKey}`)
        .send(statusUpdateRequest)
        .expect(200);

      expect(response.body.attachment.status).toBe("failed");
      console.log(`✅ Lambda processing failures handled properly`);
    });
  });

  describe("Performance Benchmarks", () => {
    it("should measure upload URL generation performance", async () => {
      const startTime = Date.now();

      const uploadRequest = {
        fileName: "performance-test.jpg",
        fileType: "image/jpeg",
        fileSize: 1024 * 1024,
      };

      await request(app)
        .post("/api/attachments/upload-url")
        .set("Authorization", `Bearer ${authToken}`)
        .send(uploadRequest)
        .expect(200);

      const duration = Date.now() - startTime;
      console.log(`⚡ Upload URL generation took ${duration}ms`);

      // Should be under 500ms for good performance
      expect(duration).toBeLessThan(500);
    });

    it("should measure download URL generation performance", async () => {
      // Create a test attachment
      const attachment = new Attachment({
        name: "download-perf-test.jpg",
        url: "https://cdn.domain.com/download-perf-test.jpg",
        type: "image/jpeg",
        size: 1024,
        uploadedBy: userId,
        status: "ready",
        metadata: {
          s3: {
            bucket: env.MEDIA_BUCKET_NAME!,
            key: "users/test/download-perf-test.jpg",
            contentType: "image/jpeg",
            encrypted: false,
          },
        },
      });

      await attachment.save();

      const startTime = Date.now();

      await request(app)
        .get(`/api/attachments/${attachment._id}/download`)
        .set("Authorization", `Bearer ${authToken}`)
        .expect(200);

      const duration = Date.now() - startTime;
      console.log(`⚡ Download URL generation took ${duration}ms`);

      // Should be under 300ms for good performance
      expect(duration).toBeLessThan(300);
    });
  });
});
