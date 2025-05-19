import dotenv from "dotenv";
import path from "path";
import { z } from "zod";
import { createLogger } from "./logger";

const logger = createLogger("environment");

const envSchema = z.object({
  NODE_ENV: z
    .enum(["development", "production", "test"])
    .default("development"),
  PORT: z.string().transform(Number).default("5000"),

  MONGODB_URI: z
    .string()
    .default(
      "mongodb://admin:password@localhost:27017/chat-app?authSource=admin",
    ),
  MONGODB_USER: z.string().optional(),
  MONGODB_PASSWORD: z.string().optional(),

  REDIS_URI: z.string().default("redis://localhost:6379"),
  REDIS_PASSWORD: z.string().optional(),

  JWT_SECRET: z.string().min(32).default("thenotsorandomsecret123456789012"),
  JWT_EXPIRES_IN: z.string().default("1d"),

  CORS_ORIGIN: z.string().default("*"),

  UPLOAD_DIRECTORY: z.string().default("./uploads"),
  MAX_FILE_SIZE: z.string().transform(Number).default("5242880"),

  SOCKET_PATH: z.string().optional(),

  AWS_S3_BUCKET: z.string().optional(),
  AWS_ACCESS_KEY_ID: z.string().optional(),
  AWS_SECRET_ACCESS_KEY: z.string().optional(),
  AWS_REGION: z.string().optional(),
});

type EnvSchema = z.infer<typeof envSchema>;

class EnvironmentService {
  private static instance: EnvironmentService;
  private config: EnvSchema;

  private constructor() {
    dotenv.config({ path: path.resolve(process.cwd(), ".env") });
    try {
      this.config = envSchema.parse(process.env);
      logger.info("Environment variables loaded and validated successfully");

      if (this.config.NODE_ENV === "development") {
        const safeConfig = { ...this.config };

        delete safeConfig.MONGODB_PASSWORD;
        delete safeConfig.REDIS_PASSWORD;
        delete safeConfig.AWS_ACCESS_KEY_ID;
        delete safeConfig.AWS_SECRET_ACCESS_KEY;
        logger.debug("Configuration values:", safeConfig);
      }
    } catch (error) {
      if (error instanceof z.ZodError) {
        const missingVars = error.errors
          .map((err) => err.path.join("."))
          .join(", ");
        logger.error(
          `Missing or invalid environment variables: ${missingVars}`,
        );
        throw new Error(`Environment validation failed: ${missingVars}`);
      }
      logger.error("Failed to load environment variables", error);
      throw error;
    }
  }

  static getInstance(): EnvironmentService {
    if (!EnvironmentService.instance) {
      EnvironmentService.instance = new EnvironmentService();
    }
    return EnvironmentService.instance;
  }
  get env(): EnvSchema {
    return this.config;
  }
  getMongoDBOptions() {
    const options: any = {};

    if (this.config.MONGODB_USER && this.config.MONGODB_PASSWORD) {
      options.auth = {
        username: this.config.MONGODB_USER,
        password: this.config.MONGODB_PASSWORD,
      };
    }

    return options;
  }
  getS3Config() {
    if (
      !this.config.AWS_S3_BUCKET ||
      !this.config.AWS_ACCESS_KEY_ID ||
      !this.config.AWS_SECRET_ACCESS_KEY
    ) {
      return null;
    }

    return {
      bucket: this.config.AWS_S3_BUCKET,
      accessKeyId: this.config.AWS_ACCESS_KEY_ID,
      secretAccessKey: this.config.AWS_SECRET_ACCESS_KEY,
      region: this.config.AWS_REGION,
    };
  }
}
export const environmentService = EnvironmentService.getInstance();
export const env = environmentService.env;
