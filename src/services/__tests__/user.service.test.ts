import { describe, it, expect, vi, beforeEach } from "vitest";
import { UserService } from "../user.service";
import { userRepository } from "../../repositories/user.repository";
import { authService } from "../auth.service";
import { UserInterface as User, UserStatus } from "../../models";
import {
  ConflictError,
  NotFoundError,
  UnauthorizedError,
  ValidationError,
} from "../../common/errors";

// Mock dependencies
vi.mock("../../repositories/user.repository", () => ({
  userRepository: {
    findOne: vi.fn(),
    create: vi.fn(),
    findByEmail: vi.fn(),
    findByUsername: vi.fn(),
    findById: vi.fn(),
  },
}));

vi.mock("../auth.service", () => ({
  authService: {
    generateToken: vi.fn().mockReturnValue("mock-token"),
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

describe("UserService", () => {
  let userService: UserService;

  beforeEach(() => {
    vi.clearAllMocks();
    userService = UserService.getInstance();
  });

  describe("createUser", () => {
    const validUserData = {
      email: "test@example.com",
      username: "testuser",
      password: "Password123",
      firstName: "Test",
      lastName: "User",
    };
    it("should throw ConflictError if email already exists", async () => {
      // Arrange
      vi.mocked(userRepository.findOne).mockResolvedValue({
        email: validUserData.email,
      } as User);

      // Act & Assert
      await expect(userService.createUser(validUserData)).rejects.toThrow(
        ConflictError,
      );
      await expect(userService.createUser(validUserData)).rejects.toThrow(
        "User with this email already exists",
      );
    });
    it("should throw ConflictError if username already exists", async () => {
      // Arrange
      vi.mocked(userRepository.findOne).mockResolvedValue({
        username: validUserData.username,
      } as User);

      // Act & Assert
      await expect(userService.createUser(validUserData)).rejects.toThrow(
        ConflictError,
      );
      await expect(userService.createUser(validUserData)).rejects.toThrow(
        "User with this username already exists",
      );
    });
    it("should create a new user successfully", async () => {
      // Arrange
      const mockCreatedUser = {
        _id: "123456789012",
        email: validUserData.email,
        username: validUserData.username,
        displayName: "Test User",
        status: UserStatus.OFFLINE,
      } as User;

      vi.mocked(userRepository.findOne).mockResolvedValue(null);
      vi.mocked(userRepository.create).mockResolvedValue(mockCreatedUser);

      // Act
      const result = await userService.createUser(validUserData);

      // Assert
      expect(result).toEqual(mockCreatedUser);
      expect(userRepository.create).toHaveBeenCalledWith({
        email: validUserData.email,
        username: validUserData.username,
        passwordHash: validUserData.password,
        displayName: "Test User",
        status: UserStatus.OFFLINE,
      });
    });
    it("should handle errors during user creation", async () => {
      // Arrange
      const error = new Error("Database error");
      vi.mocked(userRepository.findOne).mockResolvedValue(null);
      vi.mocked(userRepository.create).mockRejectedValue(error);

      // Act & Assert
      await expect(userService.createUser(validUserData)).rejects.toThrow(
        error,
      );
    });
  });
  describe("registerUser", () => {
    const validUserData = {
      email: "test@example.com",
      username: "testuser",
      password: "Password123",
      firstName: "Test",
      lastName: "User",
    };
    it("should register a user and return auth response", async () => {
      const mockCreatedUser = {
        _id: "123456789012",
        email: validUserData.email,
        username: validUserData.username,
        displayName: "Test User",
      } as User;

      vi.spyOn(userService, "createUser").mockResolvedValue(mockCreatedUser);
      // Act
      const result = await userService.registerUser(validUserData);

      // Assert
      expect(userService.createUser).toHaveBeenCalledWith(validUserData);
      expect(authService.generateToken).toHaveBeenCalledWith(mockCreatedUser);
      expect(result).toEqual({
        user: {
          _id: mockCreatedUser._id,
          email: mockCreatedUser.email,
          username: mockCreatedUser.username,
          displayName: mockCreatedUser.displayName,
        },
        token: "mock-token",
      });
    });
  });
  describe("loginUser", () => {
    const validCredentials = {
      email: "test@example.com",
      password: "Password123",
    };

    const credentialsWithUsername = {
      username: "testuser",
      password: "Password123",
    };

    it("should throw NotFoundError if user is not found with email", async () => {
      // Arrange
      vi.mocked(userRepository.findByEmail).mockResolvedValue(null);

      // Act & Assert
      await expect(userService.loginUser(validCredentials)).rejects.toThrow(
        NotFoundError,
      );
      await expect(userService.loginUser(validCredentials)).rejects.toThrow(
        "user",
      );
    });

    it("should throw NotFoundError if user is not found with username", async () => {
      // Arrange
      vi.mocked(userRepository.findByUsername).mockResolvedValue(null);

      // Act & Assert
      await expect(
        userService.loginUser(credentialsWithUsername),
      ).rejects.toThrow(NotFoundError);
      await expect(
        userService.loginUser(credentialsWithUsername),
      ).rejects.toThrow("user");
    });

    it("should throw UnauthorizedError if password is invalid", async () => {
      // Arrange
      const mockUser = {
        comparePassword: vi.fn().mockResolvedValue(false),
        save: vi.fn().mockResolvedValue(undefined),
      } as unknown as User;

      vi.mocked(userRepository.findByEmail).mockResolvedValue(mockUser);

      // Act & Assert
      await expect(userService.loginUser(validCredentials)).rejects.toThrow(
        UnauthorizedError,
      );
      await expect(userService.loginUser(validCredentials)).rejects.toThrow(
        "Invalid credentials",
      );
      expect(mockUser.comparePassword).toHaveBeenCalledWith(
        validCredentials.password,
      );
    });

    it("should return user data and token on successful login with email", async () => {
      // Arrange
      const mockUser = {
        _id: "123456789012",
        email: "test@example.com",
        username: "testuser",
        displayName: "Test User",
        status: UserStatus.OFFLINE,
        lastSeen: new Date(),
        save: vi.fn().mockResolvedValue(undefined),
        comparePassword: vi.fn().mockResolvedValue(true),
      } as unknown as User;

      vi.mocked(userRepository.findByEmail).mockResolvedValue(mockUser);

      // Act
      const result = await userService.loginUser(validCredentials);

      // Assert
      expect(result).toEqual({
        user: {
          _id: mockUser._id,
          email: mockUser.email,
          username: mockUser.username,
          displayName: mockUser.displayName,
          avatarUrl: undefined,
          status: mockUser.status,
        },
        token: "mock-token",
      });
      expect(mockUser.save).toHaveBeenCalled();
      expect(authService.generateToken).toHaveBeenCalledWith(mockUser);
    });

    it("should return user data and token on successful login with username", async () => {
      // Arrange
      const mockUser = {
        _id: "123456789012",
        email: "test@example.com",
        username: "testuser",
        displayName: "Test User",
        status: UserStatus.OFFLINE,
        lastSeen: new Date(),
        save: vi.fn().mockResolvedValue(undefined),
        comparePassword: vi.fn().mockResolvedValue(true),
      } as unknown as User;

      vi.mocked(userRepository.findByUsername).mockResolvedValue(mockUser);

      // Act
      const result = await userService.loginUser(credentialsWithUsername);

      // Assert
      expect(result).toEqual({
        user: {
          _id: mockUser._id,
          email: mockUser.email,
          username: mockUser.username,
          displayName: mockUser.displayName,
          avatarUrl: undefined,
          status: mockUser.status,
        },
        token: "mock-token",
      });
      expect(mockUser.save).toHaveBeenCalled();
      expect(authService.generateToken).toHaveBeenCalledWith(mockUser);
    });
  });
  describe("getUserById", () => {
    it("should throw NotFoundError if user is not found", async () => {
      // Arrange
      vi.mocked(userRepository.findById).mockResolvedValue(null);

      // Act & Assert
      await expect(userService.getUserById("nonexistent-id")).rejects.toThrow(
        NotFoundError,
      );
      await expect(userService.getUserById("nonexistent-id")).rejects.toThrow(
        "user",
      );
    });

    it("should return user when found", async () => {
      // Arrange
      const mockUser = {
        _id: "123456789012",
        email: "test@example.com",
        username: "testuser",
      } as User;

      vi.mocked(userRepository.findById).mockResolvedValue(mockUser);

      // Act
      const result = await userService.getUserById("123456789012");

      // Assert
      expect(result).toEqual(mockUser);
      expect(userRepository.findById).toHaveBeenCalledWith("123456789012");
    });
  });
});
