import { createClient } from "redis";
import { createLogger } from "../logger";
import { env } from "../environment";
import { RedisError } from "../errors/redis-error";

const logger = createLogger("redis-client");

const redisClient = createClient({
  url: env.REDIS_URI,
  password: env.REDIS_PASSWORD,
});

redisClient.on("connect", () => {
  logger.info("Redis client connected");
});

redisClient.on("error", (err) => {
  logger.error("Redis client error", { error: err.message });
});

redisClient.on("reconnecting", () => {
  logger.info("Redis client reconnecting");
});

async function connectRedis(): Promise<void> {
  try {
    if (!redisClient.isOpen) {
      await redisClient.connect();
    }
    logger.info("Redis connected successfully");
  } catch (error) {
    if (error instanceof Error) {
      logger.error("Failed to connect to Redis", { error: error.message });
      throw new RedisError(`Failed to connect to Redis: ${error.message}`);
    }
  }
}

async function disconnectRedis(): Promise<void> {
  try {
    if (redisClient.isOpen) {
      await redisClient.disconnect();
    }
    logger.info("Redis disconnected successfully");
  } catch (error: any) {
    logger.error("Error disconnecting from Redis", { error: error.message });
  }
}

export { redisClient, connectRedis, disconnectRedis };
