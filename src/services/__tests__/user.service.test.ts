/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { UserService } from "../user.service";
import { userRepository } from "../../repositories/user.repository";
import { authService } from "../auth.service";
import {
  ConflictError,
  NotFoundError,
  UnauthorizedError,
} from "../../common/errors";
import { UserStatus } from "../../models";
import { Types } from "mongoose";

// Mock dependencies
vi.mock("../../repositories/user.repository", () => ({
  userRepository: {
    findOne: vi.fn(),
    create: vi.fn(),
    findByEmail: vi.fn(),
    findByUsername: vi.fn(),
    findById: vi.fn(),
    findAllUsers: vi.fn(),
    countUsers: vi.fn(),
    findByIds: vi.fn(),
  },
}));

vi.mock("../auth.service", () => ({
  authService: {
    generateTokenPair: vi.fn(), // FIXED: Updated method name
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

describe("UserService", () => {
  let userService: UserService;

  beforeEach(() => {
    vi.clearAllMocks();
    userService = UserService.getInstance();
  });

  describe("createUser", () => {
    it("should create a new user successfully", async () => {
      // Arrange
      const userData = {
        email: "test@example.com",
        username: "testuser",
        password: "password123",
        firstName: "Test",
        lastName: "User",
        rememberMe: false, // FIXED: Added rememberMe
      };

      const expectedUser = {
        _id: new Types.ObjectId(),
        email: "test@example.com",
        username: "testuser",
        displayName: "Test User",
        status: UserStatus.OFFLINE,
      };

      vi.mocked(userRepository.findOne).mockResolvedValue(null);
      vi.mocked(userRepository.create).mockResolvedValue(expectedUser as any);

      // Act
      const result = await userService.createUser(userData);

      // Assert
      expect(result).toEqual(expectedUser);
      expect(userRepository.findOne).toHaveBeenCalledWith({
        $or: [{ email: userData.email }, { username: userData.username }],
      });
      expect(userRepository.create).toHaveBeenCalledWith({
        email: userData.email,
        username: userData.username,
        passwordHash: userData.password,
        displayName: "Test User",
        status: UserStatus.OFFLINE,
      });
    });

    it("should throw ConflictError when user with email already exists", async () => {
      // Arrange
      const userData = {
        email: "test@example.com",
        username: "testuser",
        password: "password123",
        firstName: "Test",
        lastName: "User",
        rememberMe: false, // FIXED: Added rememberMe
      };

      const existingUser = {
        _id: new Types.ObjectId(),
        email: "test@example.com",
        username: "different",
      };

      vi.mocked(userRepository.findOne).mockResolvedValue(existingUser as any);

      // Act & Assert
      await expect(userService.createUser(userData)).rejects.toThrow(
        ConflictError,
      );
    });

    it("should throw ConflictError when user with username already exists", async () => {
      // Arrange
      const userData = {
        email: "test@example.com",
        username: "testuser",
        password: "password123",
        firstName: "Test",
        lastName: "User",
        rememberMe: false, // FIXED: Added rememberMe
      };

      const existingUser = {
        _id: new Types.ObjectId(),
        email: "different@example.com",
        username: "testuser",
      };

      vi.mocked(userRepository.findOne).mockResolvedValue(existingUser as any);

      // Act & Assert
      await expect(userService.createUser(userData)).rejects.toThrow(
        ConflictError,
      );
    });
  });

  describe("registerUser", () => {
    it("should register a new user and return auth response", async () => {
      // Arrange
      const userData = {
        email: "test@example.com",
        username: "testuser",
        password: "password123",
        firstName: "Test",
        lastName: "User",
        rememberMe: true, // FIXED: Added rememberMe
      };

      const mockUser = {
        _id: new Types.ObjectId(),
        email: "test@example.com",
        username: "testuser",
        displayName: "Test User",
      };

      const mockTokens = {
        accessToken: "access-token",
        refreshToken: "refresh-token",
        expiresIn: "30d",
        accessTokenExpiresIn: "15m",
        refreshTokenExpiresIn: "30d",
      };

      vi.mocked(userRepository.findOne).mockResolvedValue(null);
      vi.mocked(userRepository.create).mockResolvedValue(mockUser as any);
      vi.mocked(authService.generateTokenPair).mockResolvedValue(mockTokens); // FIXED: Updated method name

      // Act
      const result = await userService.registerUser(userData);

      // Assert
      expect(result).toEqual({
        user: {
          _id: mockUser._id,
          email: mockUser.email,
          username: mockUser.username,
          displayName: mockUser.displayName,
        },
        accessToken: "access-token", // FIXED: Updated property names
        refreshToken: "refresh-token",
        expiresIn: "30d",
      });
    });
  });

  describe("loginUser", () => {
    it("should login user with email successfully", async () => {
      // Arrange
      const credentials = {
        email: "test@example.com",
        password: "password123",
        rememberMe: false, // FIXED: Added rememberMe
      };

      const mockUser = {
        _id: new Types.ObjectId(),
        email: "test@example.com",
        username: "testuser",
        displayName: "Test User",
        comparePassword: vi.fn().mockResolvedValue(true),
        save: vi.fn(),
        lastSeen: new Date(),
        avatarUrl: "avatar.jpg",
        status: UserStatus.ONLINE,
      };

      const mockTokens = {
        accessToken: "access-token",
        refreshToken: "refresh-token",
        expiresIn: "7d",
        accessTokenExpiresIn: "15m",
        refreshTokenExpiresIn: "30d",
      };

      vi.mocked(userRepository.findByEmail).mockResolvedValue(mockUser as any);
      vi.mocked(authService.generateTokenPair).mockResolvedValue(mockTokens); // FIXED: Updated method name

      // Act
      const result = await userService.loginUser(credentials);

      // Assert
      expect(result).toEqual({
        user: {
          _id: mockUser._id,
          email: mockUser.email,
          username: mockUser.username,
          displayName: mockUser.displayName,
          avatarUrl: mockUser.avatarUrl,
          status: mockUser.status,
        },
        accessToken: "access-token", // FIXED: Updated property names
        refreshToken: "refresh-token",
        expiresIn: "7d",
      });
      expect(mockUser.save).toHaveBeenCalled();
    });

    it("should login user with username successfully", async () => {
      // Arrange
      const credentials = {
        username: "testuser",
        password: "password123",
        rememberMe: false, // FIXED: Added rememberMe
      };

      const mockUser = {
        _id: new Types.ObjectId(),
        email: "test@example.com",
        username: "testuser",
        displayName: "Test User",
        comparePassword: vi.fn().mockResolvedValue(true),
        save: vi.fn(),
        lastSeen: new Date(),
        avatarUrl: "avatar.jpg",
        status: UserStatus.ONLINE,
      };

      const mockTokens = {
        accessToken: "access-token",
        refreshToken: "refresh-token",
        expiresIn: "7d",
        accessTokenExpiresIn: "15m",
        refreshTokenExpiresIn: "30d",
      };

      vi.mocked(userRepository.findByUsername).mockResolvedValue(
        mockUser as any,
      );
      vi.mocked(authService.generateTokenPair).mockResolvedValue(mockTokens); // FIXED: Updated method name

      // Act
      const result = await userService.loginUser(credentials);

      // Assert
      expect(result.user.username).toBe("testuser");
      expect(mockUser.save).toHaveBeenCalled();
    });

    it("should throw NotFoundError when user not found", async () => {
      // Arrange
      const credentials = {
        email: "test@example.com",
        password: "password123",
        rememberMe: false, // FIXED: Added rememberMe
      };

      vi.mocked(userRepository.findByEmail).mockResolvedValue(null);

      // Act & Assert
      await expect(userService.loginUser(credentials)).rejects.toThrow(
        NotFoundError,
      );
    });

    it("should throw UnauthorizedError when password is invalid", async () => {
      // Arrange
      const credentials = {
        email: "test@example.com",
        password: "wrongpassword",
        rememberMe: false, // FIXED: Added rememberMe
      };

      const mockUser = {
        comparePassword: vi.fn().mockResolvedValue(false),
      };

      vi.mocked(userRepository.findByEmail).mockResolvedValue(mockUser as any);

      // Act & Assert
      await expect(userService.loginUser(credentials)).rejects.toThrow(
        UnauthorizedError,
      );
    });
  });

  describe("getUserById", () => {
    it("should return user when found", async () => {
      // Arrange
      const userId = "user123";
      const mockUser = {
        _id: userId,
        email: "test@example.com",
        username: "testuser",
      };

      vi.mocked(userRepository.findById).mockResolvedValue(mockUser as any);

      // Act
      const result = await userService.getUserById(userId);

      // Assert
      expect(result).toEqual(mockUser);
    });

    it("should throw NotFoundError when user not found", async () => {
      // Arrange
      const userId = "nonexistent";

      vi.mocked(userRepository.findById).mockResolvedValue(null);

      // Act & Assert
      await expect(userService.getUserById(userId)).rejects.toThrow(
        NotFoundError,
      );
    });
  });

  describe("getAllUsers", () => {
    it("should return paginated users", async () => {
      // Arrange
      const options = {
        search: "test",
        page: 1,
        limit: 10,
        currentUserId: "current123",
      };

      const mockUsers = [
        { _id: "user1", username: "testuser1" },
        { _id: "user2", username: "testuser2" },
      ];

      vi.mocked(userRepository.findAllUsers).mockResolvedValue(
        mockUsers as any,
      );
      vi.mocked(userRepository.countUsers).mockResolvedValue(2);

      // Act
      const result = await userService.getAllUsers(options);

      // Assert
      expect(result).toEqual({
        users: mockUsers,
        total: 2,
        page: 1,
        limit: 10,
        totalPages: 1,
      });
    });
  });

  describe("getUserByEmail", () => {
    it("should return user when found", async () => {
      // Arrange
      const email = "test@example.com";
      const mockUser = {
        _id: "user123",
        email: "test@example.com",
        username: "testuser",
      };

      vi.mocked(userRepository.findByEmail).mockResolvedValue(mockUser as any);

      // Act
      const result = await userService.getUserByEmail(email);

      // Assert
      expect(result).toEqual(mockUser);
    });

    it("should return null when user not found", async () => {
      // Arrange
      const email = "nonexistent@example.com";

      vi.mocked(userRepository.findByEmail).mockResolvedValue(null);

      // Act
      const result = await userService.getUserByEmail(email);

      // Assert
      expect(result).toBeNull();
    });
  });
});
