import { BaseError } from "./base-error";
import { ErrorCodes, HttpStatus } from "./constants";
import { ErrorDetails } from "./types";

export class InternalServerError extends BaseError {
  constructor(message = "An unexpected error occured", details?: ErrorDetails) {
    super(
      message,
      HttpStatus.INTERNAL_SERVER_ERROR,
      ErrorCodes.INTERNAL,
      details,
    );
    Object.setPrototypeOf(this, InternalServerError.prototype);
  }
}

export class BadRequestError extends BaseError {
  constructor(message: string, details?: ErrorDetails) {
    super(message, HttpStatus.BAD_REQUEST, ErrorCodes.BAD_REQUEST);
    Object.setPrototypeOf(this, BadRequestError.prototype);
  }
}

export class UnauthorizedError extends BaseError {
  constructor(message = "Unauthorized access", details?: ErrorDetails) {
    super(message, HttpStatus.UNAUTHORIZED, ErrorCodes.UNAUTHORIZED, details);
    Object.setPrototypeOf(this, UnauthorizedError.prototype);
  }
}

export class ForbiddenError extends BaseError {
  constructor(message = "Access forbidden", details?: ErrorDetails) {
    super(message, HttpStatus.FORBIDDEN, ErrorCodes.FORBIDDEN, details);
    Object.setPrototypeOf(this, ForbiddenError.prototype);
  }
}

export class ValidationError extends BaseError {
  constructor(message: string, details?: ErrorDetails) {
    super(
      message,
      HttpStatus.UNPROCESSABLE_ENTITY,
      ErrorCodes.VALIDATION,
      details,
    );
    Object.setPrototypeOf(this, ValidationError.prototype);
  }
}

export class NotFoundError extends BaseError {
  constructor(resource: string, details?: ErrorDetails) {
    super(
      `The requested ${resource} could not be found`,
      HttpStatus.NOT_FOUND,
      ErrorCodes.NOT_FOUND,
      details,
    );
    Object.setPrototypeOf(this, NotFoundError.prototype);
  }
}

export class ConflictError extends BaseError {
  constructor(message: string, details?: ErrorDetails) {
    super(message, HttpStatus.CONFLICT, ErrorCodes.CONFLICT, details);
    Object.setPrototypeOf(this, ConflictError.prototype);
  }
}

export class RateLimitError extends BaseError {
  constructor(message = "Rate limit exceeded", details?: ErrorDetails) {
    super(
      message,
      HttpStatus.TOO_MANY_REQUESTS,
      ErrorCodes.RATE_LIMIT_EXCEEDED,
      details,
    );
    Object.setPrototypeOf(this, RateLimitError.prototype);
  }
}

export class DatabaseError extends BaseError {
  constructor(message: string, details?: ErrorDetails) {
    super(
      message,
      HttpStatus.INTERNAL_SERVER_ERROR,
      ErrorCodes.DATABASE,
      details,
    );
    Object.setPrototypeOf(this, DatabaseError.prototype);
  }
}

export class FileUploadError extends BaseError {
  constructor(message: string, details?: ErrorDetails) {
    super(
      message,
      HttpStatus.BAD_GATEWAY,
      ErrorCodes.FILE_UPLOAD_FAILED,
      details,
    );
    Object.setPrototypeOf(this, FileUploadError.prototype);
  }
}

export class SocketError extends BaseError {
  constructor(message: string, details?: ErrorDetails) {
    super(
      message,
      HttpStatus.INTERNAL_SERVER_ERROR,
      ErrorCodes.SOCKET,
      details,
    );
    Object.setPrototypeOf(this, SocketError.prototype);
  }
}

export class RedisError extends BaseError {
  constructor(message: string, details?: ErrorDetails) {
    super(message, HttpStatus.INTERNAL_SERVER_ERROR, ErrorCodes.REDIS, details);
    Object.setPrototypeOf(this, RedisError.prototype);
  }
}

