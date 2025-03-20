// src/services/__tests__/auth.service.test.ts

import { describe, it, expect, vi, beforeEach } from "vitest";
import { AuthService } from "../auth.service";
import jwt from "jsonwebtoken";
import { UserInterface as User } from "../../models";
import { UnauthorizedError } from "../../common/errors";

// Mock dependencies
vi.mock("jsonwebtoken", async (importOriginal) => {
  const actual = (await importOriginal()) as typeof jwt;
  return {
    ...actual,
    sign: vi.fn().mockReturnValue("mock-token"),
    verify: vi.fn(),
    default: {
      sign: vi.fn().mockReturnValue("mock-token"),
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

describe("AuthService", () => {
  let authService: AuthService;

  beforeEach(() => {
    vi.clearAllMocks();
    // Get the singleton instance
    authService = AuthService.getInstance();
  });

  describe("generateToken", () => {
    it("should generate a JWT token with correct payload", () => {
      // Arrange
      const mockUser = {
        _id: "123456789012",
        email: "test@example.com",
        username: "testuser",
      } as User;

      // Act
      const token = authService.generateToken(mockUser);

      // Assert
      expect(token).toBe("mock-token");
      expect(jwt.sign).toHaveBeenCalledWith(
        {
          _id: mockUser._id,
          email: mockUser.email,
          username: mockUser.username,
        },
        "test-secret",
        { expiresIn: "1d" },
      );
    });
  });

  describe("verifyToken", () => {
    it("should return user data when token is valid", () => {
      // Arrange
      const mockDecodedToken = {
        _id: "123456789012",
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
