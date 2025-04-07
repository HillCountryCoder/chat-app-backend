// src/controllers/__tests__/user.controller.test.ts
import { describe, it, expect, vi, beforeEach, Mock } from "vitest";
import { UserController } from "../user.controller";
import { userService } from "../../services/user.service";
import { Response } from "express";
import { AuthenticatedRequest } from "../../common/types/auth.type";
import mongoose from "mongoose";

// Mock service
vi.mock("../../services/user.service", () => ({
  userService: {
    getAllUsers: vi.fn(),
    getUserById: vi.fn(),
  },
}));

vi.mock("../../common/logger", () => ({
  createLogger: vi.fn().mockReturnValue({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

describe("UserController", () => {
  let mockRequest: Partial<AuthenticatedRequest>;
  let mockResponse: Partial<Response>;
  let nextFunction: Mock;
  let userId: string;

  beforeEach(() => {
    vi.clearAllMocks();

    userId = new mongoose.Types.ObjectId().toString();

    mockRequest = {
      user: {
        _id: new mongoose.Types.ObjectId(userId),
      } as any,
      params: {},
      query: {},
    };

    mockResponse = {
      json: vi.fn().mockReturnThis(),
      status: vi.fn().mockReturnThis(),
    };

    nextFunction = vi.fn();
  });

  describe("getAllUsers", () => {
    it("should return users list with pagination", async () => {
      // Mock service response
      const mockUsers = {
        users: [
          { _id: "user1", displayName: "User One" },
          { _id: "user2", displayName: "User Two" },
        ],
        total: 2,
        page: 1,
        limit: 20,
        totalPages: 1,
      };

      vi.mocked(userService.getAllUsers).mockResolvedValueOnce(
        mockUsers as any,
      );

      // Set query params
      mockRequest.query = { page: "1", limit: "20" };

      // Execute
      await UserController.getAllUsers(
        mockRequest as AuthenticatedRequest,
        mockResponse as Response,
        nextFunction,
      );

      // Assert
      expect(userService.getAllUsers).toHaveBeenCalledWith({
        page: 1,
        limit: 20,
        currentUserId: userId,
        search: undefined,
      });

      expect(mockResponse.json).toHaveBeenCalledWith(mockUsers);
      expect(nextFunction).not.toHaveBeenCalled();
    });

    it("should handle search parameter", async () => {
      // Mock service response
      const mockUsers = {
        users: [{ _id: "user1", displayName: "John Doe" }],
        total: 1,
        page: 1,
        limit: 20,
        totalPages: 1,
      };

      vi.mocked(userService.getAllUsers).mockResolvedValueOnce(
        mockUsers as any,
      );

      // Set query params with search term
      mockRequest.query = { search: "John" };

      // Execute
      await UserController.getAllUsers(
        mockRequest as AuthenticatedRequest,
        mockResponse as Response,
        nextFunction,
      );

      // Assert
      expect(userService.getAllUsers).toHaveBeenCalledWith({
        search: "John",
        page: 1, // Default value
        limit: 20, // Default value
        currentUserId: userId,
      });

      expect(mockResponse.json).toHaveBeenCalledWith(mockUsers);
    });

    it("should pass error to next function if service throws", async () => {
      // Mock service error
      const error = new Error("Service error");
      vi.mocked(userService.getAllUsers).mockRejectedValueOnce(error);

      // Execute
      await UserController.getAllUsers(
        mockRequest as AuthenticatedRequest,
        mockResponse as Response,
        nextFunction,
      );

      // Assert
      expect(nextFunction).toHaveBeenCalledWith(error);
    });
  });

  describe("getUserById", () => {
    it("should return a user by ID", async () => {
      // Setup
      const targetUserId = "user123";
      mockRequest.params = { id: targetUserId };

      // Mock user data
      const mockUser = {
        _id: targetUserId,
        email: "user@example.com",
        username: "username",
        displayName: "User Name",
        avatarUrl: "avatar.jpg",
        status: "online",
        lastSeen: new Date(),
        createdAt: new Date(),
        passwordHash: "hashed_password", // This should not be returned
      };

      vi.mocked(userService.getUserById).mockResolvedValueOnce(mockUser as any);

      // Execute
      await UserController.getUserById(
        mockRequest as AuthenticatedRequest,
        mockResponse as Response,
        nextFunction,
      );

      // Assert
      expect(userService.getUserById).toHaveBeenCalledWith(targetUserId);

      // Verify password is not included
      if (!mockResponse.json) {
        throw new Error("mockResponse.json is undefined");
      }
      const responseData = (mockResponse.json as Mock).mock.calls[0][0];
      expect(responseData).not.toHaveProperty("passwordHash");

      // Verify other props are included
      expect(responseData).toHaveProperty("_id", targetUserId);
      expect(responseData).toHaveProperty("email");
      expect(responseData).toHaveProperty("username");
    });

    it("should pass error to next function if service throws", async () => {
      // Setup
      mockRequest.params = { id: "nonexistent" };

      // Mock service error
      const error = new Error("User not found");
      vi.mocked(userService.getUserById).mockRejectedValueOnce(error);

      // Execute
      await UserController.getUserById(
        mockRequest as AuthenticatedRequest,
        mockResponse as Response,
        nextFunction,
      );

      // Assert
      expect(nextFunction).toHaveBeenCalledWith(error);
    });
  });
});
