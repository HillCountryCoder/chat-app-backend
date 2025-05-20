import {
  S3Client,
  HeadObjectCommand,
  CopyObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { SSMClient, GetParameterCommand } from "@aws-sdk/client-ssm";
import axios from "axios";

const s3Client = new S3Client({
  region: process.env.AWS_REGION || "us-east-1",
});

const ssmClient = new SSMClient({
  region: process.env.AWS_REGION || "us-east-1",
});

// Function to get API key - first checks environment, then SSM parameter store
async function getApiKey() {
  // First check environment variable
  if (process.env.API_KEY) {
    return process.env.API_KEY;
  }

  // If parameter name is provided, try to fetch from SSM
  if (process.env.API_KEY_PARAMETER_NAME) {
    try {
      const response = await ssmClient.send(
        new GetParameterCommand({
          Name: process.env.API_KEY_PARAMETER_NAME,
          WithDecryption: true,
        }),
      );

      if (response.Parameter?.Value) {
        return response.Parameter.Value;
      }
    } catch (error) {
      console.error("Error fetching API key from SSM:", error);
    }
  }

  console.warn("No API key found in environment or SSM");
  return "";
}

export const handler = async (event) => {
  console.log("Processing virus scan event:", JSON.stringify(event));

  const record = event.Records[0];
  const bucket = record.s3.bucket.name;
  const key = decodeURIComponent(record.s3.object.key);

  try {
    // Get file metadata
    const headCommand = new HeadObjectCommand({
      Bucket: bucket,
      Key: key,
    });

    const headResponse = await s3Client.send(headCommand);

    // Basic security checks
    const suspiciousExtensions = [
      ".exe",
      ".bat",
      ".scr",
      ".vbs",
      ".js",
      ".jar",
      ".cmd",
    ];
    const fileExtension = key.toLowerCase().split(".").pop();
    const isSuspicious = suspiciousExtensions.includes(`.${fileExtension}`);

    // File size validation
    const maxSize = 25 * 1024 * 1024; // 25MB
    if (headResponse.ContentLength > maxSize) {
      console.log(`File too large: ${headResponse.ContentLength} bytes`);
      await notifyBackend(key, "failed", "File exceeds size limit of 25MB");
      return await quarantineFile(bucket, key);
    }

    // For this simple implementation, we'll just check file extensions
    if (isSuspicious) {
      console.log(
        `Suspicious file detected: ${key} with extension ${fileExtension}`,
      );
      await notifyBackend(key, "failed", "Potentially unsafe file type");
      return await quarantineFile(bucket, key);
    }

    // If all checks pass, mark file as safe
    console.log(`File passed security checks: ${key}`);
    await notifyBackend(key, "ready");
    return {
      statusCode: 200,
      body: JSON.stringify({
        message: "File scan completed: No threats detected",
      }),
    };
  } catch (error) {
    console.error("Error processing file:", error);
    await notifyBackend(key, "failed", error.message);
    throw error;
  }
};

async function quarantineFile(bucket, key) {
  console.log(`Quarantining file: ${key}`);

  // Move to quarantine folder
  const quarantineKey = `quarantine/${key}`;

  try {
    // Copy to quarantine location
    const copyCommand = new CopyObjectCommand({
      Bucket: bucket,
      CopySource: `${bucket}/${key}`,
      Key: quarantineKey,
    });

    await s3Client.send(copyCommand);

    // Delete the original
    const deleteCommand = new DeleteObjectCommand({
      Bucket: bucket,
      Key: key,
    });

    await s3Client.send(deleteCommand);

    console.log(`File quarantined: ${key} → ${quarantineKey}`);
    return {
      statusCode: 200,
      body: JSON.stringify({ message: "File quarantined", quarantineKey }),
    };
  } catch (error) {
    console.error("Error quarantining file:", error);
    throw error;
  }
}

async function notifyBackend(fileKey, status, errorDetails = null) {
  // Rather than modifying the database directly, call an API endpoint
  if (!process.env.API_ENDPOINT) {
    console.warn("API_ENDPOINT not set, skipping backend notification");
    return;
  }

  try {
    // Get API key with priority to SSM
    const apiKey = await getApiKey();

    const response = await axios({
      method: "POST",
      url: `${process.env.API_ENDPOINT}/api/attachments/status-update`,
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
      },
      data: {
        fileKey,
        status,
        errorDetails,
        source: "virus-scanner-lambda",
      },
    });

    console.log("Backend notification sent:", response.data);
    return response.data;
  } catch (error) {
    console.error("Failed to notify backend:", error.message);
    // Don't throw - we don't want the lambda to fail if notification fails
  }
}
