import winston from "winston";
import path from "path";
import { NextFunction, Request, Response } from "express";

const logLevels = {
  error: 0,
  warn: 1,
  info: 2,
  http: 3,
  debug: 4,
};

const logLevel = () => {
  const env = process.env.NODE_ENV || "development";
  return env === "development" ? "debug" : "info";
};

const colors = {
  error: "red",
  warn: "yellow",
  info: "green",
  http: "magenta",
  debug: "blue",
};

winston.addColors(colors);

const consoleFormat = winston.format.combine(
  winston.format.timestamp({ format: "YYYY-MM-DD HH:mm:ss:ms" }),
  winston.format.colorize({ all: true }),
  winston.format.printf(
    (info) =>
      `${info.timestamp} ${info.level}: ${info.message}${
        info.splat !== undefined ? `${info.splat}` : ""
      } ${
        info.metadata && Object.keys(info.metadata).length
          ? `\n${JSON.stringify(info.metadata, null, 2)}`
          : ""
      }`,
  ),
);
const fileFormat = winston.format.combine(
  winston.format.timestamp({ format: "YYYY-MM-DD HH:mm:ss:ms" }),
  winston.format.json(),
);
const createServiceFormat = (serviceName: string) => {
  return winston.format((info) => {
    info.service = serviceName;
    return info;
  })();
};

const createLogger = (serviceName: string) => {
  const logsDir = path.join(process.cwd(), "logs");
  return winston.createLogger({
    level: logLevel(),
    levels: logLevels,
    transports: [
      new winston.transports.Console({
        format: winston.format.combine(
          createServiceFormat(serviceName),
          consoleFormat,
        ),
      }),
      new winston.transports.File({
        filename: path.join(logsDir, "error.log"),
        level: "error",
        format: winston.format.combine(
          createServiceFormat(serviceName),
          fileFormat,
        ),
        maxsize: 10485760, // 10MB
        maxFiles: 5,
      }),
      new winston.transports.File({
        filename: path.join(logsDir, "combined.log"),
        format: winston.format.combine(
          createServiceFormat(serviceName),
          fileFormat,
        ),
        maxsize: 10485760, // 10MB
        maxFiles: 5,
      }),
    ],
    exitOnError: false,
  });
};

const httpLogger = (logger: winston.Logger) => {
  return (req: Request, res: Response, next: NextFunction) => {
    const requestStartTime = Date.now();
    res.on("finish", () => {
      const requestDuration = Date.now() - requestStartTime;
      logger.http({
        message: `${req.method} ${req.originalUrl}`,
        metadata: {
          method: req.method,
          url: req.originalUrl,
          status: req.statusCode,
          duration: `${requestDuration}ms`,
          ip: req.ip,
          //   user: req.user ? req.user.id : "anonymous",
        },
      });
    });
    next();
  };
};

const createSocketLogger = (logger: winston.Logger) => {
  return {
    connection: (socketId: string, userId?: string) => {
      logger.info({
        message: "Socket connected",
        metadata: {
          socketId,
          userId: userId || "unauthenticated",
        },
      });
    },
    disconnection: (socketId: string, reason: string) => {
      logger.info({
        message: "Socket disconnected",
        metadata: {
          socketId,
          reason,
        },
      });
    },
    event: (socketId: string, event: string, data?: any) => {
      logger.debug({
        message: `Socket event: ${event}`,
        metadata: {
          socketId,
          event,
          data: data ? JSON.stringify(data) : undefined,
        },
      });
    },
    error: (socketId: string, error: Error) => {
      logger.error({
        messages: "Socket error",
        metadata: {
          socketId,
          error: {
            message: error.message,
            stack: error.stack,
          },
        },
      });
    },
  };
};

export { createLogger, httpLogger, createSocketLogger };
