// src/tests/integration/performance/attachment.performance.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import request from "supertest";
import { createTestApp } from "../../helpers/test-app";
import "../setup";
import { seedTestUser, loginCredentials } from "../fixtures/auth-fixtures";
import { Attachment } from "../../../models";
import { PerformanceTestHelper } from "../../helpers/performance-helper";
import { AttachmentTestHelper } from "../../helpers/attachment-test-helper";
import { env } from "../../../common/environment";
import crypto from "crypto";
import { DeleteObjectCommand, S3Client } from "@aws-sdk/client-s3";

// Skip if not real AWS environment
const shouldRunPerformanceTests =
  process.env.INTEGRATION_TEST_REAL === "true" &&
  env.MEDIA_BUCKET_NAME &&
  env.AWS_ACCESS_KEY_ID;

describe.skipIf(!shouldRunPerformanceTests)(
  "Attachment Performance Tests",
  () => {
    const app = createTestApp();
    let authToken: string;
    let userId: string;
    let testCounter = 0;
    let s3Client: S3Client;
    // Helper to generate unique file names
    const generateUniqueFileName = (
      base: string,
      extension: string = "jpg",
    ) => {
      const timestamp = Date.now();
      const random = crypto.randomBytes(4).toString("hex");
      testCounter++;
      return `${base}-${timestamp}-${random}-${testCounter}.${extension}`;
    };

    beforeEach(async () => {
      // Initialize S3 client
      s3Client = new S3Client({
        region: env.AWS_REGION || "us-east-1",
        credentials: {
          accessKeyId: env.AWS_ACCESS_KEY_ID!,
          secretAccessKey: env.AWS_SECRET_ACCESS_KEY!,
        },
      });
      await seedTestUser();
      const loginResponse = await request(app).post("/api/auth/login").send({
        identifier: loginCredentials.valid.email,
        password: loginCredentials.valid.password,
      });

      authToken = loginResponse.body.token;
      userId = loginResponse.body.user._id;
    });

    afterEach(async () => {
      // Clean up all test attachments
      await Attachment.deleteMany({});
    });

    describe("Upload URL Generation Performance", () => {
      it("should generate upload URLs within performance targets", async () => {
        const testFileData = {
          fileName: generateUniqueFileName("performance-test"),
          fileType: "image/jpeg",
          fileSize: 1024 * 1024, // 1MB
        };

        const { result, duration } = await PerformanceTestHelper.measureTime(
          async () => {
            return await request(app)
              .post("/api/attachments/upload-url")
              .set("Authorization", `Bearer ${authToken}`)
              .send(testFileData);
          },
        );

        expect(result.status).toBe(200);
        PerformanceTestHelper.assertPerformance(
          duration,
          500,
          "Upload URL generation",
        );

        console.log(`📈 Upload URL generation: ${duration}ms`);
      });

      it("should handle concurrent upload URL requests efficiently", async () => {
        const concurrentRequests = 10;

        const { avg, max } = await PerformanceTestHelper.benchmark(
          "Concurrent Upload URL Generation",
          async () => {
            const promises = Array(concurrentRequests)
              .fill(null)
              .map((_, i) =>
                request(app)
                  .post("/api/attachments/upload-url")
                  .set("Authorization", `Bearer ${authToken}`)
                  .send({
                    fileName: generateUniqueFileName(`concurrent-test-${i}`),
                    fileType: "image/jpeg",
                    fileSize: 1024 * 512, // 512KB
                  }),
              );

            const responses = await Promise.all(promises);
            responses.forEach((response) => {
              expect(response.status).toBe(200);
            });

            return responses;
          },
          5, // 5 iterations
        );

        // All concurrent requests should complete within reasonable time
        PerformanceTestHelper.assertPerformance(
          avg,
          2000,
          "Concurrent upload URL generation average",
        );
        PerformanceTestHelper.assertPerformance(
          max,
          3000,
          "Concurrent upload URL generation max",
        );

        console.log(
          `📊 Concurrent Performance (${concurrentRequests} requests):`,
        );
        console.log(`   Average: ${avg.toFixed(2)}ms`);
        console.log(`   Max: ${max}ms`);
      });

      it("should generate thumbnail upload URLs efficiently", async () => {
        const testFileData = {
          fileName: generateUniqueFileName("thumbnail-perf-test"),
          fileType: "image/jpeg",
          fileSize: 2 * 1024 * 1024, // 2MB
          hasClientThumbnail: true,
        };

        const { result, duration } = await PerformanceTestHelper.measureTime(
          async () => {
            return await request(app)
              .post("/api/attachments/upload-url")
              .set("Authorization", `Bearer ${authToken}`)
              .send(testFileData);
          },
        );

        expect(result.status).toBe(200);
        expect(result.body.thumbnailUpload).toBeDefined();

        // Should not be significantly slower with thumbnail
        PerformanceTestHelper.assertPerformance(
          duration,
          700,
          "Thumbnail upload URL generation",
        );

        console.log(`🖼️ Thumbnail upload URL generation: ${duration}ms`);
      });
    });

    describe("Download URL Generation Performance", () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let testAttachment: any;

      beforeEach(async () => {
        testAttachment = await AttachmentTestHelper.createTestAttachment(
          userId,
          {
            name: generateUniqueFileName("download-perf-test"),
            status: "ready",
            metadata: {
              s3: {
                bucket: "test-bucket",
                key: `users/${userId}/${generateUniqueFileName(
                  "download-perf-test",
                )}`,
                contentType: "image/jpeg",
                encrypted: false,
              },
            },
          },
        );
      });

      it("should generate download URLs within performance targets", async () => {
        const { result, duration } = await PerformanceTestHelper.measureTime(
          async () => {
            return await request(app)
              .get(`/api/attachments/${testAttachment._id}/download`)
              .set("Authorization", `Bearer ${authToken}`);
          },
        );

        expect(result.status).toBe(200);
        PerformanceTestHelper.assertPerformance(
          duration,
          300,
          "Download URL generation",
        );

        console.log(`⬇️ Download URL generation: ${duration}ms`);
      });

      it("should handle batch download URL requests efficiently", async () => {
        // Create multiple test attachments with unique keys
        const attachments = await Promise.all(
          Array(5)
            .fill(null)
            .map(async (_, i) =>
              AttachmentTestHelper.createTestAttachment(userId, {
                name: generateUniqueFileName(`batch-download-${i}`),
                status: "ready",
                metadata: {
                  s3: {
                    bucket: "test-bucket",
                    key: `users/${userId}/${generateUniqueFileName(
                      `batch-download-${i}`,
                    )}`,
                    contentType: "image/jpeg",
                    encrypted: false,
                  },
                },
              }),
            ),
        );

        const { avg, min, max } = await PerformanceTestHelper.benchmark(
          "Batch Download URL Generation",
          async () => {
            const promises = attachments.map((attachment) =>
              request(app)
                .get(`/api/attachments/${attachment._id}/download`)
                .set("Authorization", `Bearer ${authToken}`),
            );

            const responses = await Promise.all(promises);
            responses.forEach((response) => {
              expect(response.status).toBe(200);
            });

            return responses;
          },
          3, // 3 iterations
        );

        PerformanceTestHelper.assertPerformance(
          avg,
          1000,
          "Batch download URL generation average",
        );

        console.log(
          `📦 Batch Download Performance (${attachments.length} files):`,
        );
        console.log(`   Average: ${avg.toFixed(2)}ms`);
        console.log(`   Min: ${min}ms, Max: ${max}ms`);
      });
    });

    describe("File Upload Performance", () => {
      it("should upload small files efficiently", async () => {
        const fileData = AttachmentTestHelper.createTestFileData("image");
        const uniqueFileName = generateUniqueFileName("small-file");

        console.log(
          `📤 Testing small file upload (${fileData.fileSize} bytes)...`,
        );

        // Step 1: Get upload URL
        const { result: urlResult, duration: urlDuration } =
          await PerformanceTestHelper.measureTime(async () => {
            return await request(app)
              .post("/api/attachments/upload-url")
              .set("Authorization", `Bearer ${authToken}`)
              .send({
                fileName: uniqueFileName,
                fileType: fileData.fileType,
                fileSize: fileData.fileSize,
              });
          });

        expect(urlResult.status).toBe(200);

        // Step 2: Upload to S3 (with more relaxed timeout for network conditions)
        const { presignedUrl, metadata } = urlResult.body;
        console.log(`   Presigned URL: ${presignedUrl}`);
        const { duration: uploadDuration } =
          await PerformanceTestHelper.measureTime(async () => {
            const uploadResponse = await fetch(presignedUrl, {
              method: "PUT",
              body: fileData.content,
              headers: {
                "Content-Type": fileData.fileType,
              },
            });

            expect(uploadResponse.ok).toBe(true);
            return uploadResponse;
          });

        // Relaxed timeout for small files (network conditions may vary)
        PerformanceTestHelper.assertPerformance(
          uploadDuration,
          5000, // Increased from 2000ms to 5000ms
          "Small file S3 upload",
        );

        console.log(`✅ Small file upload completed:`);
        console.log(`   URL generation: ${urlDuration}ms`);
        console.log(`   S3 upload: ${uploadDuration}ms`);
        console.log(`   Total: ${urlDuration + uploadDuration}ms`);

        // Cleanup
        try {
          await s3Client.send(
            new DeleteObjectCommand({
              Bucket: metadata.bucket,
              Key: metadata.key,
            }),
          );
        } catch (error) {
          console.warn("Cleanup failed:", error);
        }
      });

      it("should upload large files within acceptable timeframes", async () => {
        const fileData = AttachmentTestHelper.createTestFileData("large");
        const uniqueFileName = generateUniqueFileName("large-file");

        console.log(
          `📤 Testing large file upload (${(
            fileData.fileSize /
            1024 /
            1024
          ).toFixed(1)}MB)...`,
        );

        // Step 1: Get upload URL
        const { result: urlResult, duration: urlDuration } =
          await PerformanceTestHelper.measureTime(async () => {
            return await request(app)
              .post("/api/attachments/upload-url")
              .set("Authorization", `Bearer ${authToken}`)
              .send({
                fileName: uniqueFileName,
                fileType: fileData.fileType,
                fileSize: fileData.fileSize,
              });
          });

        expect(urlResult.status).toBe(200);

        // Step 2: Upload to S3
        const { presignedUrl, metadata } = urlResult.body;
        const { duration: uploadDuration } =
          await PerformanceTestHelper.measureTime(async () => {
            const uploadResponse = await fetch(presignedUrl, {
              method: "PUT",
              body: fileData.content,
              headers: {
                "Content-Type": fileData.fileType,
              },
            });

            expect(uploadResponse.ok).toBe(true);
            return uploadResponse;
          });

        // Large files should upload within 30 seconds
        PerformanceTestHelper.assertPerformance(
          uploadDuration,
          30000,
          "Large file S3 upload",
        );

        console.log(`✅ Large file upload completed:`);
        console.log(
          `   File size: ${(fileData.fileSize / 1024 / 1024).toFixed(1)}MB`,
        );
        console.log(`   URL generation: ${urlDuration}ms`);
        console.log(`   S3 upload: ${uploadDuration}ms`);
        console.log(
          `   Upload speed: ${(
            fileData.fileSize /
            1024 /
            1024 /
            (uploadDuration / 1000)
          ).toFixed(2)} MB/s`,
        );

        // Cleanup
        try {
          await s3Client.send(
            new DeleteObjectCommand({
              Bucket: metadata.bucket,
              Key: metadata.key,
            }),
          );
        } catch (error) {
          console.warn("Cleanup failed:", error);
        }
      }, 60000); // 60 second timeout for large file test
    });

    describe("Database Performance", () => {
      it("should create attachment records efficiently", async () => {
        const attachmentData = {
          name: generateUniqueFileName("db-perf-test"),
          url: `https://cdn.domain.com/${generateUniqueFileName(
            "db-perf-test",
          )}`,
          type: "image/jpeg",
          size: 1024 * 1024,
          uploadedBy: userId,
          status: "ready",
          metadata: {
            s3: {
              bucket: "test-bucket",
              key: `users/${userId}/${generateUniqueFileName("db-perf-test")}`,
              contentType: "image/jpeg",
              encrypted: false,
            },
          },
        };

        const { result, duration } = await PerformanceTestHelper.measureTime(
          async () => {
            return await Attachment.create(attachmentData);
          },
        );

        expect(result).toBeDefined();
        PerformanceTestHelper.assertPerformance(
          duration,
          100,
          "Attachment record creation",
        );

        console.log(`💾 Database record creation: ${duration}ms`);
      });

      it("should query attachments efficiently", async () => {
        const { result, duration } = await PerformanceTestHelper.measureTime(
          async () => {
            return await Attachment.find({ uploadedBy: userId }).sort({
              uploadedAt: -1,
            });
          },
        );

        expect(result.length).toBe(20);
        PerformanceTestHelper.assertPerformance(
          duration,
          200,
          "Attachment query",
        );

        console.log(`🔍 Database query (20 records): ${duration}ms`);
      });
    });

    describe("System Load Testing", () => {
      it("should handle multiple simultaneous operations", async () => {
        const operations = [
          // Generate upload URLs
          () =>
            request(app)
              .post("/api/attachments/upload-url")
              .set("Authorization", `Bearer ${authToken}`)
              .send({
                fileName: generateUniqueFileName("load-test-1"),
                fileType: "image/jpeg",
                fileSize: 1024 * 500,
              }),

          // Get user attachments
          () =>
            request(app)
              .get("/api/attachments")
              .set("Authorization", `Bearer ${authToken}`),

          // Create attachment record
          () =>
            AttachmentTestHelper.createTestAttachment(userId, {
              name: generateUniqueFileName("load-test-2"),
              metadata: {
                s3: {
                  bucket: "test-bucket",
                  key: `users/${userId}/${generateUniqueFileName(
                    "load-test-2",
                  )}`,
                  contentType: "image/jpeg",
                  encrypted: false,
                },
              },
            }),

          // Query database
          () => Attachment.find({ uploadedBy: userId }).limit(5),
        ];

        const { result, duration } = await PerformanceTestHelper.measureTime(
          async () => {
            const promises = operations.map((op) => op());
            return await Promise.all(promises);
          },
        );

        // All operations should complete
        expect(result).toHaveLength(4);
        result.forEach((res, index) => {
          if (index < 2) {
            // HTTP responses
            expect('status' in res).toBe(true);
            expect((res as { status: number }).status).toBeDefined();
          } else {
            // Database operations
            expect(res).toBeDefined();
          }
        });

        PerformanceTestHelper.assertPerformance(
          duration,
          3000,
          "Multiple simultaneous operations",
        );

        console.log(`⚡ System load test (4 operations): ${duration}ms`);
      });

      it("should maintain performance under sustained load", async () => {
        const iterations = 50;
        const results: number[] = [];

        console.log(
          `🏃‍♂️ Running sustained load test (${iterations} iterations)...`,
        );

        // Warm up
        await request(app)
          .post("/api/attachments/upload-url")
          .set("Authorization", `Bearer ${authToken}`)
          .send({
            fileName: generateUniqueFileName("warmup"),
            fileType: "image/jpeg",
            fileSize: 1024,
          });

        // Run sustained operations
        for (let i = 0; i < iterations; i++) {
          const { duration } = await PerformanceTestHelper.measureTime(
            async () => {
              return await request(app)
                .post("/api/attachments/upload-url")
                .set("Authorization", `Bearer ${authToken}`)
                .send({
                  fileName: generateUniqueFileName(`sustained-test-${i}`),
                  fileType: "image/jpeg",
                  fileSize: 1024 * (100 + i), // Varying file sizes
                });
            },
          );

          results.push(duration);

          // Brief pause to simulate realistic usage
          if (i % 10 === 0) {
            await new Promise((resolve) => setTimeout(resolve, 100));
          }
        }

        const avg =
          results.reduce((sum, time) => sum + time, 0) / results.length;
        const max = Math.max(...results);
        const min = Math.min(...results);

        // Performance should not degrade significantly
        PerformanceTestHelper.assertPerformance(
          avg,
          800,
          "Sustained load average",
        );
        PerformanceTestHelper.assertPerformance(
          max,
          2000,
          "Sustained load maximum",
        );

        console.log(`📈 Sustained Load Results (${iterations} operations):`);
        console.log(`   Average: ${avg.toFixed(2)}ms`);
        console.log(`   Min: ${min}ms, Max: ${max}ms`);
        console.log(
          `   Standard deviation: ${Math.sqrt(
            results.reduce((sum, time) => sum + Math.pow(time - avg, 2), 0) /
              results.length,
          ).toFixed(2)}ms`,
        );
      }, 120000); // 2 minute timeout
    });

    describe("Memory and Resource Usage", () => {
      it("should not leak memory during operations", async () => {
        const initialMemory = process.memoryUsage();

        // Perform memory-intensive operations
        const operations = Array(100)
          .fill(null)
          .map(async (_, i) => {
            const testData = AttachmentTestHelper.createTestFileData("image");
            const uniqueFileName = generateUniqueFileName(`memory-test-${i}`);

            // Simulate upload URL generation
            await request(app)
              .post("/api/attachments/upload-url")
              .set("Authorization", `Bearer ${authToken}`)
              .send({
                fileName: uniqueFileName,
                fileType: testData.fileType,
                fileSize: testData.fileSize,
              });

            // Create and delete attachment record
            const attachment = await AttachmentTestHelper.createTestAttachment(
              userId,
              {
                name: uniqueFileName,
                metadata: {
                  s3: {
                    bucket: "test-bucket",
                    key: `users/${userId}/${uniqueFileName}`,
                    contentType: testData.fileType,
                    encrypted: false,
                  },
                },
              },
            );

            await Attachment.findByIdAndDelete(attachment._id);
          });

        await Promise.all(operations);

        // Force garbage collection if available
        if (global.gc) {
          global.gc();
        }

        const finalMemory = process.memoryUsage();
        const memoryIncrease = finalMemory.heapUsed - initialMemory.heapUsed;
        const memoryIncreaseMB = memoryIncrease / 1024 / 1024;

        console.log(`🧠 Memory Usage:`);
        console.log(
          `   Initial heap: ${(initialMemory.heapUsed / 1024 / 1024).toFixed(
            2,
          )}MB`,
        );
        console.log(
          `   Final heap: ${(finalMemory.heapUsed / 1024 / 1024).toFixed(2)}MB`,
        );
        console.log(`   Increase: ${memoryIncreaseMB.toFixed(2)}MB`);

        // Should not leak significant memory (threshold: 50MB)
        expect(memoryIncreaseMB).toBeLessThan(50);
      });
    });
  },
);
