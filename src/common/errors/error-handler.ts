import { InternalServerError } from "./app-errors";
import { Response } from "express";
import winston from "winston";
import { BaseError } from "./base-error";
import { env } from "../environment";
export class ErrorHandler {
  constructor(private readonly logger: winston.Logger) {}

  public handleError(error: Error | BaseError, res?: Response): void {
    if (error instanceof BaseError) {
      this.logger.debug("Error Handler called", { error: error.name });
      const response = error.toResponse();
      this.logger.error({
        statusCode: response.status,
        code: response.code,
        messaging: response.message,
        details: response.details,
        timestamp: new Date().toISOString(),
        stack: env.NODE_ENV === "development" ? error.stack : undefined,
      });

      if (res) {
        res.status(response.status).json(response);
      }
    } else {
      this.logger.error({
        error: {
          name: error.name,
          message: error.message,
          stack: env.NODE_ENV === "development" ? error.stack : undefined,
        },
        timestamp: new Date().toISOString(),
      });

      if (res) {
        const serverError = new InternalServerError();
        res.status(serverError.status).json(serverError.toResponse());
      }
    }
  }

  public handleSocketError(error: Error | BaseError, socket: any): void {
    if (error instanceof BaseError) {
      this.logger.debug("Socket Error Handler called", { error: error.name });
      const response = error.toResponse();

      this.logger.error({
        socketId: socket.id,
        code: response.code,
        message: response.message,
        details: response.details,
        timestamp: new Date().toISOString(),
        stack: process.env.NODE_ENV === "development" ? error.stack : undefined,
      });

      // Emit error to client
      socket.emit("error", response);
    } else {
      this.logger.error({
        socketId: socket.id,
        error: {
          name: error.name,
          message: error.message,
          stack:
            process.env.NODE_ENV === "development" ? error.stack : undefined,
        },
        timestamp: new Date().toISOString(),
      });

      // Emit generic error to client
      const serverError = new InternalServerError();
      socket.emit("error", serverError.toResponse());
    }
  }
}
