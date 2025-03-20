// src/controllers/__tests__/auth.controller.test.ts

import { describe, it, expect, vi, beforeEach, Mock } from "vitest";
import { AuthController } from "../auth.controller";
import { userService } from "../../services/user.service";
import { Request, Response } from "express";
import { AuthenticatedRequest } from "../../common/types/auth.type";

// Mock dependencies
vi.mock("../../services/user.service", () => ({
  userService: {
    registerUser: vi.fn(),
    loginUser: vi.fn(),
  },
}));

vi.mock("../../common/logger", () => ({
  createLogger: vi.fn().mockReturnValue({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

describe("AuthController", () => {
  let mockRequest: Partial<Request>;
  let mockAuthRequest: Partial<AuthenticatedRequest>;
  let mockResponse: Partial<Response>;
  let nextFunction: Mock;

  beforeEach(() => {
    mockRequest = {
      body: {},
    };

    mockAuthRequest = {
      body: {},
      user: undefined,
    };

    mockResponse = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    };

    nextFunction = vi.fn();
    vi.clearAllMocks();
  });

  describe("registerUser", () => {
    it("should register a user and return 201 status", async () => {
      // Arrange
      const userData = {
        email: "test@example.com",
        username: "testuser",
        password: "Password123",
        firstName: "Test",
        lastName: "User",
      };

      mockRequest.body = userData;

      const mockRegisteredUser = {
        user: {
          _id: "123456789012",
          email: userData.email,
          username: userData.username,
          displayName: "Test User",
        },
        token: "mock-token",
      };

      vi.mocked(userService.registerUser).mockResolvedValue(mockRegisteredUser);

      // Act
      await AuthController.registerUser(
        mockRequest as Request,
        mockResponse as Response,
        nextFunction,
      );

      // Assert
      expect(userService.registerUser).toHaveBeenCalledWith(userData);
      expect(mockResponse.status).toHaveBeenCalledWith(201);
      expect(mockResponse.json).toHaveBeenCalledWith(mockRegisteredUser);
    });

    it("should call next with error if registration fails", async () => {
      // Arrange
      const error = new Error("Registration failed");
      vi.mocked(userService.registerUser).mockRejectedValue(error);

      // Act
      await AuthController.registerUser(
        mockRequest as Request,
        mockResponse as Response,
        nextFunction,
      );

      // Assert
      expect(nextFunction).toHaveBeenCalledWith(error);
    });
  });

  describe("login", () => {
    it("should login a user and return 200 status", async () => {
      // Arrange
      const credentials = {
        email: "test@example.com",
        password: "Password123",
      };

      mockRequest.body = credentials;

      const mockLoginResponse = {
        user: {
          _id: "123456789012",
          email: credentials.email,
          username: "testuser",
          displayName: "Test User",
        },
        token: "mock-token",
      };

      vi.mocked(userService.loginUser).mockResolvedValue(mockLoginResponse);

      // Act
      await AuthController.login(
        mockRequest as Request,
        mockResponse as Response,
        nextFunction,
      );

      // Assert
      expect(userService.loginUser).toHaveBeenCalledWith(credentials);
      expect(mockResponse.status).toHaveBeenCalledWith(200);
      expect(mockResponse.json).toHaveBeenCalledWith(mockLoginResponse);
    });

    it("should call next with error if login fails", async () => {
      // Arrange
      const error = new Error("Login failed");
      vi.mocked(userService.loginUser).mockRejectedValue(error);

      // Act
      await AuthController.login(
        mockRequest as Request,
        mockResponse as Response,
        nextFunction,
      );

      // Assert
      expect(nextFunction).toHaveBeenCalledWith(error);
    });
  });

  describe("getCurrentUser", () => {
    it("should return the current user from the request", async () => {
      // Arrange
      const mockUser = {
        _id: "123456789012",
        username: "testuser",
        email: "test@example.com",
        displayName: "Test User",
      };

      mockAuthRequest.user = mockUser as any;

      // Act
      await AuthController.getCurrentUser(
        mockAuthRequest as AuthenticatedRequest,
        mockResponse as Response,
        nextFunction,
      );

      // Assert
      expect(mockResponse.status).toHaveBeenCalledWith(200);
      expect(mockResponse.json).toHaveBeenCalledWith({ user: mockUser });
    });

    it("should call next with error if an exception occurs", async () => {
      // Arrange
      mockAuthRequest.user = undefined;

      // Create a property that throws an error when accessed
      Object.defineProperty(mockAuthRequest, "user", {
        get: () => {
          throw new Error("User access error");
        },
      });

      // Act
      await AuthController.getCurrentUser(
        mockAuthRequest as AuthenticatedRequest,
        mockResponse as Response,
        nextFunction,
      );

      // Assert
      expect(nextFunction).toHaveBeenCalledTimes(1);
      const error = nextFunction.mock.calls[0][0];
      expect(error).toBeInstanceOf(Error);
      expect(error.message).toBe("User access error");
    });
  });
});
