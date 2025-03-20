import { describe, it, expect, vi, beforeEach, Mock } from "vitest";
import { authMiddleware } from "../auth.middleware";
import { authService } from "../../../services/auth.service";
import { userService } from "../../../services/user.service";
import { UnauthorizedError } from "../../errors";
import { Request, Response } from "express";
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
    expect(error.message).toBe("Authorized header missing or invalid");
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
    expect(error.message).toBe("Authorized header missing or invalid");
  });

  it("should throw UnauthorizedError if token verification fails", async () => {
    // Arrange
    mockRequest.headers = { authorization: "Bearer invalid-token" };
    const error = new UnauthorizedError("Invalid token");
    vi.mocked(authService.verifyToken).mockImplementation(() => {
      throw error;
    });

    // Act
    await authMiddleware(
      mockRequest as any,
      mockResponse as Response,
      nextFunction,
    );

    // Assert
    expect(authService.verifyToken).toHaveBeenCalledWith("invalid-token");
    expect(nextFunction).toHaveBeenCalledWith(error);
  });

  it("should throw UnauthorizedError if decoded token has no _id", async () => {
    // Arrange
    mockRequest.headers = { authorization: "Bearer valid-token" };
    vi.mocked(authService.verifyToken).mockReturnValue({} as any);

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
    expect(error.message).toBe("Invalid token");
  });

  it("should throw any error that occurs during user lookup", async () => {
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
    expect(nextFunction).toHaveBeenCalledWith(lookupError);
  });

  it("should set req.user and call next() on successful authentication", async () => {
    // Arrange
    mockRequest.headers = { authorization: "Bearer valid-token" };
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
    expect(mockRequest.user).toBe(mockUser);
    expect(nextFunction).toHaveBeenCalledTimes(1);
    expect(nextFunction).toHaveBeenCalledWith();
  });
});
