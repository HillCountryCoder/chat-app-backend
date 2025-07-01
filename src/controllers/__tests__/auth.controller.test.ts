/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { Request, Response, NextFunction } from "express";
import { AuthController } from "../auth.controller";
import { userService } from "../../services/user.service";
import { authService } from "../../services/auth.service";
import { BadRequestError, UnauthorizedError } from "../../common/errors";

// Mock dependencies
vi.mock("../../services/user.service", () => ({
  userService: {
    registerUser: vi.fn(), // FIXED: Mock the actual methods used
    loginUser: vi.fn(),
    registerUserWithDeviceInfo: vi.fn(),
    loginUserWithDeviceInfo: vi.fn(),
  },
}));

vi.mock("../../services/auth.service", () => ({
  authService: {
    refreshAccessToken: vi.fn(),
    revokeRefreshToken: vi.fn(),
    revokeAllUserTokens: vi.fn(),
    getUserActiveSessions: vi.fn(),
  },
}));

vi.mock("../../common/logger", () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  })),
}));

describe("AuthController", () => {
  let mockRequest: Partial<Request>;
  let mockResponse: Partial<Response>;
  let mockNext: NextFunction;
  let responseData: any;

  beforeEach(() => {
    vi.clearAllMocks();
    responseData = {};

    mockRequest = {
      body: {},
      headers: {
        "user-agent": "test-agent",
      },
      ip: "127.0.0.1",
    };

    mockResponse = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockImplementation((data) => {
        responseData = data;
        return mockResponse;
      }),
    };

    mockNext = vi.fn(); // FIXED: Add mockNext function
  });

  describe("registerUser", () => {
    it("should register a new user successfully", async () => {
      // Arrange
      const mockUserData = {
        username: "testuser",
        email: "test@example.com",
        password: "Password123!",
        firstName: "Test",
        lastName: "User",
        rememberMe: false,
      };

      const mockRegisterResponse = {
        user: {
          _id: "user123",
          username: "testuser",
          email: "test@example.com",
          displayName: "Test User",
        },
        accessToken: "access-token",
        refreshToken: "refresh-token",
        expiresIn: "7d",
      };

      mockRequest.body = mockUserData;

      // FIXED: Mock the correct service method
      vi.mocked(userService.registerUserWithDeviceInfo).mockResolvedValue(
        mockRegisterResponse as any
      );

      // Act
      await AuthController.registerUser(
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      // Assert
      expect(mockResponse.status).toHaveBeenCalledWith(201);
      expect(responseData).toEqual({
        success: true,
        message: "User registered successfully",
        user: {
          _id: "user123",
          username: "testuser",
          email: "test@example.com",
          displayName: "Test User",
        },
        accessToken: "access-token",
        refreshToken: "refresh-token",
        expiresIn: "7d",
      });
    });

    it("should call next with error when registration fails", async () => {
      // Arrange
      const mockUserData = {
        username: "testuser",
        email: "test@example.com",
        password: "Password123!",
        firstName: "Test",
        lastName: "User",
        rememberMe: false,
      };

      const mockError = new BadRequestError("User already exists");

      mockRequest.body = mockUserData;
      vi.mocked(userService.registerUserWithDeviceInfo).mockRejectedValue(mockError);

      // Act
      await AuthController.registerUser(
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      // Assert
      expect(mockNext).toHaveBeenCalledWith(mockError);
    });
  });

  describe("login", () => {
    it("should login user successfully", async () => {
      // Arrange
      const mockCredentials = {
        identifier: "test@example.com",
        password: "password123",
        rememberMe: true,
      };

      const mockLoginResponse = {
        user: {
          _id: "user123",
          username: "testuser",
          email: "test@example.com",
          displayName: "Test User",
          avatarUrl: "avatar.jpg",
          status: "online",
        },
        accessToken: "access-token",
        refreshToken: "refresh-token",
        expiresIn: "30d",
      };

      mockRequest.body = mockCredentials;

      // FIXED: Mock the correct service method
      vi.mocked(userService.loginUserWithDeviceInfo).mockResolvedValue(
        mockLoginResponse as any
      );

      // Act
      await AuthController.login(
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      // Assert
      expect(responseData).toEqual({
        success: true,
        message: "Login successful",
        user: {
          _id: "user123",
          username: "testuser",
          email: "test@example.com",
          displayName: "Test User",
          avatarUrl: "avatar.jpg",
          status: "online",
        },
        accessToken: "access-token",
        refreshToken: "refresh-token",
        expiresIn: "30d",
      });
    });

    it("should call next with error when login fails", async () => {
      // Arrange
      const mockCredentials = {
        identifier: "test@example.com",
        password: "wrongpassword",
        rememberMe: false,
      };

      const mockError = new UnauthorizedError("Invalid credentials");

      mockRequest.body = mockCredentials;
      vi.mocked(userService.loginUserWithDeviceInfo).mockRejectedValue(mockError);

      // Act
      await AuthController.login(
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      // Assert
      expect(mockNext).toHaveBeenCalledWith(mockError);
    });
  });

  describe("refreshToken", () => {
    it("should refresh token successfully", async () => {
      // Arrange
      const mockRefreshTokenData = {
        refreshToken: "valid-refresh-token",
      };

      const mockRefreshResponse = {
        accessToken: "new-access-token",
        refreshToken: "new-refresh-token",
        user: {
          _id: "user123",
          username: "testuser",
          email: "test@example.com",
        },
      };

      mockRequest.body = mockRefreshTokenData;
      vi.mocked(authService.refreshAccessToken).mockResolvedValue(
        mockRefreshResponse as any
      );

      // Act
      await AuthController.refreshToken(
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      // Assert
      expect(responseData).toEqual({
        success: true,
        message: "Token refreshed successfully",
        user: {
          _id: "user123",
          username: "testuser",
          email: "test@example.com",
        },
        accessToken: "new-access-token",
        refreshToken: "new-refresh-token",
      });
    });

    it("should call next with error when refresh token is missing", async () => {
      // Arrange
      mockRequest.body = {};

      // Act
      await AuthController.refreshToken(
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      // Assert
      expect(mockNext).toHaveBeenCalledWith(
        expect.any(BadRequestError)
      );
    });
  });

  describe("logout", () => {
    it("should logout user successfully", async () => {
      // Arrange
      const mockLogoutData = {
        refreshToken: "refresh-token",
      };

      const mockUser = {
        _id: "user123",
      };

      mockRequest.body = mockLogoutData;
      (mockRequest as any).user = mockUser;

      vi.mocked(authService.revokeRefreshToken).mockResolvedValue();

      // Act
      await AuthController.logout(
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      // Assert
      expect(responseData).toEqual({
        success: true,
        message: "Logged out successfully",
      });
      expect(authService.revokeRefreshToken).toHaveBeenCalledWith(
        "refresh-token"
      );
    });

    it("should call next with error when logout fails", async () => {
      // Arrange
      const mockError = new Error("Logout failed");
      const mockUser = { _id: "user123" };

      mockRequest.body = { refreshToken: "refresh-token" };
      (mockRequest as any).user = mockUser;

      vi.mocked(authService.revokeRefreshToken).mockRejectedValue(mockError);

      // Act
      await AuthController.logout(
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      // Assert
      expect(mockNext).toHaveBeenCalledWith(mockError);
    });
  });

  describe("logoutAll", () => {
    it("should logout all user sessions successfully", async () => {
      // Arrange
      const mockUser = {
        _id: "user123",
      };

      (mockRequest as any).user = mockUser;

      vi.mocked(authService.revokeAllUserTokens).mockResolvedValue();

      // Act
      await AuthController.logoutAll(
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      // Assert
      expect(responseData).toEqual({
        success: true,
        message: "All sessions logged out successfully",
      });
      expect(authService.revokeAllUserTokens).toHaveBeenCalledWith("user123");
    });

    it("should call next with error when user not authenticated", async () => {
      // Arrange
      (mockRequest as any).user = null;

      // Act
      await AuthController.logoutAll(
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      // Assert
      expect(mockNext).toHaveBeenCalledWith(
        expect.any(UnauthorizedError)
      );
    });
  });

  describe("getCurrentUser", () => {
    it("should get current user successfully", async () => {
      // Arrange
      const mockUser = {
        _id: "user123",
        username: "testuser",
        email: "test@example.com",
        displayName: "Test User",
        avatarUrl: "avatar.jpg",
        status: "online",
      };

      (mockRequest as any).user = mockUser;

      // Act
      await AuthController.getCurrentUser(
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      // Assert
      expect(responseData).toEqual({
        success: true,
        user: {
          _id: "user123",
          username: "testuser",
          email: "test@example.com",
          displayName: "Test User",
          avatarUrl: "avatar.jpg",
          status: "online",
        },
      });
    });

    it("should call next with error when user not authenticated", async () => {
      // Arrange
      (mockRequest as any).user = null;

      // Act
      await AuthController.getCurrentUser(
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      // Assert
      expect(mockNext).toHaveBeenCalledWith(
        expect.any(UnauthorizedError)
      );
    });
  });

  describe("getActiveSessions", () => {
    it("should get active sessions successfully", async () => {
      // Arrange
      const mockUser = {
        _id: "user123",
      };

      const mockSessions = [
        {
          _id: "session1",
          deviceInfo: "Chrome",
          lastUsed: new Date(),
        },
      ];

      (mockRequest as any).user = mockUser;

      vi.mocked(authService.getUserActiveSessions).mockResolvedValue(
        mockSessions as any
      );

      // Act
      await AuthController.getActiveSessions(
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      // Assert
      expect(responseData).toEqual({
        success: true,
        data: { sessions: mockSessions },
      });
      expect(authService.getUserActiveSessions).toHaveBeenCalledWith("user123");
    });

    it("should call next with error when user not authenticated", async () => {
      // Arrange
      (mockRequest as any).user = null;

      // Act
      await AuthController.getActiveSessions(
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      );

      // Assert
      expect(mockNext).toHaveBeenCalledWith(
        expect.any(UnauthorizedError)
      );
    });
  });
});