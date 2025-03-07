import mongoose from "mongoose";
import {
  BadRequestError,
  ConflictError,
  DatabaseError,
  InternalServerError,
  NotFoundError,
  ValidationError,
} from "./app-errors";
import { BaseError } from "./base-error";
import { ErrorDetails } from "./types";

export class MongoDBErrorMapper {
  static mapError(error: any, resourceName = "resource"): BaseError {
    // Extract details for better error reporting
    const details: ErrorDetails = {
      name: error.name,
      code: error.code,
      keyValue: error.keyValue,
    };

    // Mongoose validation errors
    if (error instanceof mongoose.Error.ValidationError) {
      return new ValidationError("Validation failed", {
        ...details,
        errors: Object.fromEntries(
          Object.entries(error.errors).map(([path, err]) => [
            path,
            {
              message: err.message,
              value: err.value,
              kind: (err as any).kind,
            },
          ]),
        ),
      });
    }

    // Document not found error
    if (error instanceof mongoose.Error.DocumentNotFoundError) {
      return new NotFoundError(resourceName, details);
    }

    // Cast errors (invalid ObjectId, etc.)
    if (error instanceof mongoose.Error.CastError) {
      return new BadRequestError(`Invalid ${error.path}: ${error.value}`, {
        ...details,
        path: error.path,
        value: error.value,
        kind: error.kind,
      });
    }

    // Handle MongoDB duplicate key errors
    if (error.code === 11000 || error.code === 11001) {
      return new ConflictError("A duplicate record already exists", {
        ...details,
        duplicateKey: error.keyValue,
      });
    }

    // Handle MongoDB connection errors
    if (
      error.name === "MongoNetworkError" ||
      error.name === "MongoServerSelectionError"
    ) {
      return new DatabaseError("Database connection error", details);
    }

    // Handle transaction errors
    if (error.name === "TransactionError") {
      return new DatabaseError("Transaction failed", details);
    }

    // Generic database errors
    return new InternalServerError("Database operation failed", details);
  }
}
