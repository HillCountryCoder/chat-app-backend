/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach, Mock } from "vitest";
import { authMiddleware } from "../auth.middleware";
import { authService } from "../../../services/auth.service";
import { userService } from "../../../services/user.service";
import { UnauthorizedError } from "../../errors";
import { Response } from "express";
import { AuthenticatedRequest } from "../../types";

vi.mock("../../../services/auth.service", () => ({
  authService: {
    verifyToken: vi.fn(),
  },
}));

vi.mock("../../../services/user.service", () => ({
  userService: {
    getUserById: vi.fn(),
  },
}));

vi.mock("../../logger", () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  })),
}));

describe("authMiddleware", () => {
  let mockRequest: Partial<AuthenticatedRequest>;
  let mockResponse: Partial<Response>;
  let nextFunction: Mock;

  beforeEach(() => {
    mockRequest = {
      headers: {},
    };
    mockResponse = {};
    nextFunction = vi.fn();
    vi.clearAllMocks();
  });

  it("should throw UnauthorizedError if authorization header is missing", async () => {
    // Act
    await authMiddleware(
      mockRequest as any,
      mockResponse as Response,
      nextFunction,
    );

    // Assert
    expect(nextFunction).toHaveBeenCalledTimes(1);
    const error = nextFunction.mock.calls[0][0];
    expect(error).toBeInstanceOf(UnauthorizedError);
    // FIXED: Updated to match actual middleware error message
    expect(error.message).toBe("Access token is required");
  });

  it('should throw UnauthorizedError if authorization header does not start with "Bearer "', async () => {
    // Arrange
    mockRequest.headers = { authorization: "Basic sometoken" };

    // Act
    await authMiddleware(
      mockRequest as any,
      mockResponse as Response,
      nextFunction,
    );

    // Assert
    expect(nextFunction).toHaveBeenCalledTimes(1);
    const error = nextFunction.mock.calls[0][0];
    expect(error).toBeInstanceOf(UnauthorizedError);
    // FIXED: Updated to match actual middleware error message
    expect(error.message).toBe("Access token is required");
  });

  it("should throw UnauthorizedError if authorization header has Bearer but no token", async () => {
    // Arrange
    mockRequest.headers = { authorization: "Bearer" }; // Missing token part

    // Act
    await authMiddleware(
      mockRequest as any,
      mockResponse as Response,
      nextFunction,
    );

    // Assert
    expect(nextFunction).toHaveBeenCalledTimes(1);
    const error = nextFunction.mock.calls[0][0];
    expect(error).toBeInstanceOf(UnauthorizedError);
    expect(error.message).toBe("Access token is required");
  });

  it("should throw UnauthorizedError if authorization header has Bearer with empty token", async () => {
    // Arrange
    mockRequest.headers = { authorization: "Bearer " }; // Empty token

    // Act
    await authMiddleware(
      mockRequest as any,
      mockResponse as Response,
      nextFunction,
    );

    // Assert
    expect(nextFunction).toHaveBeenCalledTimes(1);
    const error = nextFunction.mock.calls[0][0];
    expect(error).toBeInstanceOf(UnauthorizedError);
    expect(error.message).toBe("Access token is required");
  });

  it("should throw UnauthorizedError if token verification fails", async () => {
    // Arrange
    mockRequest.headers = { authorization: "Bearer invalid-token" };
    const verificationError = new UnauthorizedError("Invalid token");
    vi.mocked(authService.verifyToken).mockImplementation(() => {
      throw verificationError;
    });

    // Act
    await authMiddleware(
      mockRequest as any,
      mockResponse as Response,
      nextFunction,
    );

    // Assert
    expect(authService.verifyToken).toHaveBeenCalledWith("invalid-token");
    expect(nextFunction).toHaveBeenCalledTimes(1);
    const error = nextFunction.mock.calls[0][0];
    expect(error).toBeInstanceOf(UnauthorizedError);
    expect(error.message).toBe("Invalid token");
  });

  it("should throw UnauthorizedError if decoded token has no _id", async () => {
    // Arrange
    mockRequest.headers = { authorization: "Bearer valid-token" };
    vi.mocked(authService.verifyToken).mockReturnValue({} as any); // No _id property

    // Act
    await authMiddleware(
      mockRequest as any,
      mockResponse as Response,
      nextFunction,
    );

    // Assert
    expect(nextFunction).toHaveBeenCalledTimes(1);
    const error = nextFunction.mock.calls[0][0];
    expect(error).toBeInstanceOf(UnauthorizedError);
    expect(error.message).toBe("Invalid access token");
  });

  it("should throw UnauthorizedError if decoded token has null _id", async () => {
    // Arrange
    mockRequest.headers = { authorization: "Bearer valid-token" };
    vi.mocked(authService.verifyToken).mockReturnValue({
      _id: null,
    } as any);

    // Act
    await authMiddleware(
      mockRequest as any,
      mockResponse as Response,
      nextFunction,
    );

    // Assert
    expect(nextFunction).toHaveBeenCalledTimes(1);
    const error = nextFunction.mock.calls[0][0];
    expect(error).toBeInstanceOf(UnauthorizedError);
    expect(error.message).toBe("Invalid access token");
  });

  it("should throw UnauthorizedError if user lookup fails with error", async () => {
    // Arrange
    mockRequest.headers = { authorization: "Bearer valid-token" };
    vi.mocked(authService.verifyToken).mockReturnValue({
      _id: "user-id",
    } as any);

    const lookupError = new Error("Database error");
    vi.mocked(userService.getUserById).mockRejectedValue(lookupError);

    // Act
    await authMiddleware(
      mockRequest as any,
      mockResponse as Response,
      nextFunction,
    );

    // Assert
    expect(userService.getUserById).toHaveBeenCalledWith("user-id");
    expect(nextFunction).toHaveBeenCalledTimes(1);
    const error = nextFunction.mock.calls[0][0];
    expect(error).toBeInstanceOf(UnauthorizedError);
    // FIXED: Middleware converts all errors to UnauthorizedError with "Authentication failed" message
    expect(error.message).toBe("Authentication failed");
  });

  it("should throw UnauthorizedError if user is not found", async () => {
    // Arrange
    mockRequest.headers = { authorization: "Bearer valid-token" };
    vi.mocked(authService.verifyToken).mockReturnValue({
      _id: "non-existent-user-id",
    } as any);

    // Simulate user not found (getUserById throws or returns null)
    const notFoundError = new Error("User not found");
    vi.mocked(userService.getUserById).mockRejectedValue(notFoundError);

    // Act
    await authMiddleware(
      mockRequest as any,
      mockResponse as Response,
      nextFunction,
    );

    // Assert
    expect(userService.getUserById).toHaveBeenCalledWith("non-existent-user-id");
    expect(nextFunction).toHaveBeenCalledTimes(1);
    const error = nextFunction.mock.calls[0][0];
    expect(error).toBeInstanceOf(UnauthorizedError);
    expect(error.message).toBe("Authentication failed");
  });

  it("should set req.user and call next() on successful authentication", async () => {
    // Arrange
    mockRequest.headers = { authorization: "Bearer valid-token" };
    const mockUser = { 
      _id: "user-id", 
      username: "testuser",
      email: "test@example.com",
      displayName: "Test User"
    };

    vi.mocked(authService.verifyToken).mockReturnValue({
      _id: "user-id",
      email: "test@example.com",
      username: "testuser",
    } as any);
    vi.mocked(userService.getUserById).mockResolvedValue(mockUser as any);

    // Act
    await authMiddleware(
      mockRequest as any,
      mockResponse as Response,
      nextFunction,
    );

    // Assert
    expect(authService.verifyToken).toHaveBeenCalledWith("valid-token");
    expect(userService.getUserById).toHaveBeenCalledWith("user-id");
    expect(mockRequest.user).toBe(mockUser);
    expect(nextFunction).toHaveBeenCalledTimes(1);
    expect(nextFunction).toHaveBeenCalledWith(); // Called without error
  });

  it("should handle token with whitespace", async () => {
    // Arrange
    mockRequest.headers = { authorization: "Bearer   valid-token   " }; // Token with spaces
    const mockUser = { _id: "user-id", username: "testuser" };

    vi.mocked(authService.verifyToken).mockReturnValue({
      _id: "user-id",
    } as any);
    vi.mocked(userService.getUserById).mockResolvedValue(mockUser as any);

    // Act
    await authMiddleware(
      mockRequest as any,
      mockResponse as Response,
      nextFunction,
    );

    // Assert
    expect(authService.verifyToken).toHaveBeenCalledWith("valid-token"); // Should be trimmed
    expect(mockRequest.user).toBe(mockUser);
    expect(nextFunction).toHaveBeenCalledWith();
  });

  it("should handle multiple Bearer keywords in header", async () => {
    // Arrange
    mockRequest.headers = { authorization: "Bearer Bearer valid-token" }; // Double Bearer

    // Act
    await authMiddleware(
      mockRequest as any,
      mockResponse as Response,
      nextFunction,
    );

    // Assert
    expect(authService.verifyToken).toHaveBeenCalledWith("Bearer valid-token");
    // This will likely fail token verification, but middleware should handle it gracefully
  });

  it("should handle case-sensitive Bearer keyword", async () => {
    // Arrange
    mockRequest.headers = { authorization: "bearer valid-token" }; // lowercase bearer

    // Act
    await authMiddleware(
      mockRequest as any,
      mockResponse as Response,
      nextFunction,
    );

    // Assert
    expect(nextFunction).toHaveBeenCalledTimes(1);
    const error = nextFunction.mock.calls[0][0];
    expect(error).toBeInstanceOf(UnauthorizedError);
    expect(error.message).toBe("Access token is required");
  });
});