// src/services/__tests__/auth.service.test.ts

import { describe, it, expect, vi, beforeEach } from "vitest";
import { AuthService } from "../auth.service";
import jwt from "jsonwebtoken";
import { UserInterface as User } from "../../models";
import { UnauthorizedError } from "../../common/errors";
import { RefreshToken } from "../../models/refresh-token.model";

// Mock dependencies
vi.mock("jsonwebtoken", async (importOriginal) => {
  const actual = (await importOriginal()) as typeof jwt;
  return {
    ...actual,
    sign: vi.fn().mockReturnValue("mock-access-token"),
    verify: vi.fn(),
    default: {
      sign: vi.fn().mockReturnValue("mock-access-token"),
      verify: vi.fn(),
    },
  };
});

vi.mock("../../common/logger", () => ({
  createLogger: vi.fn().mockReturnValue({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

vi.mock("../../common/environment", () => ({
  env: {
    JWT_SECRET: "test-secret",
    JWT_EXPIRES_IN: "1d",
  },
}));

// Mock RefreshToken model
vi.mock("../../models/refresh-token.model", () => ({
  RefreshToken: {
    create: vi.fn().mockResolvedValue({
      token: "mock-refresh-token-value",
      userId: "507f1f77bcf86cd799439011",
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    }),
    findOne: vi.fn(),
    deleteOne: vi.fn().mockResolvedValue({ deletedCount: 1 }),
    deleteMany: vi.fn().mockResolvedValue({ deletedCount: 0 }),
    find: vi.fn(),
  },
}));

describe("AuthService", () => {
  let authService: AuthService;

  beforeEach(() => {
    vi.clearAllMocks();
    authService = AuthService.getInstance();
  });

  describe("generateTokenPair", () => {
    it("should generate access and refresh tokens", async () => {
      // Arrange
      const mockUser = {
        _id: "507f1f77bcf86cd799439011", // Valid ObjectId format
        email: "test@example.com",
        username: "testuser",
      } as unknown as User;

      // Act
      const result = await authService.generateTokenPair(mockUser);

      // Assert
      expect(result).toEqual({
        accessToken: "mock-access-token",
        refreshToken: expect.any(String), // This will be the crypto-generated token
        expiresIn: "7d",
        accessTokenExpiresIn: "15m",
        refreshTokenExpiresIn: "7d",
      });
      expect(RefreshToken.deleteMany).toHaveBeenCalledWith({
        userId: "507f1f77bcf86cd799439011",
        expiresAt: { $lt: expect.any(Date) },
      });

      // 🔥 ADD: Verify findOne was called to check for existing session
      expect(RefreshToken.findOne).toHaveBeenCalled();
    });
  });

  describe("verifyToken", () => {
    it("should return user data when token is valid", () => {
      // Arrange
      const mockDecodedToken = {
        _id: "507f1f77bcf86cd799439011",
        email: "test@example.com",
        username: "testuser",
      };

      vi.mocked(jwt.verify).mockImplementation(() => mockDecodedToken);

      // Act
      const result = authService.verifyToken("valid-token");

      // Assert
      expect(result).toEqual(mockDecodedToken);
      expect(jwt.verify).toHaveBeenCalledWith("valid-token", "test-secret");
    });

    it("should throw UnauthorizedError when no token is provided", () => {
      // Act & Assert
      expect(() => authService.verifyToken("")).toThrow(UnauthorizedError);
      expect(() => authService.verifyToken("")).toThrow("No token provided");
    });

    it("should throw UnauthorizedError when token verification fails", () => {
      // Arrange
      vi.mocked(jwt.verify).mockImplementation(() => {
        throw new Error("Invalid token");
      });

      // Act & Assert
      expect(() => authService.verifyToken("invalid-token")).toThrow(
        UnauthorizedError,
      );
      expect(() => authService.verifyToken("invalid-token")).toThrow(
        "Invalid token",
      );
    });
  });
});
