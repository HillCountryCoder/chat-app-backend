import { Router } from "express";
import mongoose from "mongoose";
import { redisClient } from "../common/redis/client";
import { createLogger } from "../common/logger";

const router = Router();
const logger = createLogger("health-routes");

// Health check endpoint
router.get("/", async (req, res) => {
  try {
    const healthStatus = {
      status: "ok",
      timestamp: new Date().toISOString(),
      services: {
        server: "ok",
        mongodb: "unknown",
        redis: "unknown",
      },
      environment: process.env.NODE_ENV || "development",
      uptime: process.uptime(),
    };

    // Check MongoDB connection
    try {
      const mongoStatus = mongoose.connection.readyState;
      if (mongoStatus === 1) {
        healthStatus.services.mongodb = "ok";
      } else {
        healthStatus.services.mongodb = "error";
        healthStatus.status = "degraded";
      }
    } catch (error) {
      logger.error("MongoDB health check failed", { error });
      healthStatus.services.mongodb = "error";
      healthStatus.status = "degraded";
    }

    // Check Redis connection
    try {
      const pingResult = await redisClient.ping();
      if (pingResult === "PONG") {
        healthStatus.services.redis = "ok";
      } else {
        healthStatus.services.redis = "error";
        healthStatus.status = "degraded";
      }
    } catch (error) {
      logger.error("Redis health check failed", { error });
      healthStatus.services.redis = "error";
      healthStatus.status = "degraded";
    }

    // Return appropriate status code based on health status
    const statusCode = healthStatus.status === "ok" ? 200 : 503;
    res.status(statusCode).json(healthStatus);
  } catch (error) {
    logger.error("Health check failed", { error });
    res.status(500).json({
      status: "error",
      timestamp: new Date().toISOString(),
      message: "Health check failed",
    });
  }
});

export default router;
