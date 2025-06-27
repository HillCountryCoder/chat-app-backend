/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach, Mock } from "vitest";
import { DirectMessageController } from "../direct-message.controller";
import { directMessageService } from "../../services/direct-message.service";
import { Response } from "express";
import { AuthenticatedRequest } from "../../common/types/auth.type";
import { ValidationError } from "../../common/errors";
import mongoose from "mongoose";

// Mock service
vi.mock("../../services/direct-message.service", () => ({
  directMessageService: {
    getUserDirectMessages: vi.fn(),
    getDirectMessageById: vi.fn(),
    getMessages: vi.fn(),
    sendMessage: vi.fn(),
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

describe("DirectMessageController", () => {
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
      body: {},
    };

    mockResponse = {
      json: vi.fn().mockReturnThis(),
      status: vi.fn().mockReturnThis(),
    };

    nextFunction = vi.fn();
  });

  describe("getDirectMessages", () => {
    it("should return direct messages for current user", async () => {
      // Mock service response
      const mockDMs = [{ _id: "dm1" }, { _id: "dm2" }];
      vi.mocked(
        directMessageService.getUserDirectMessages,
      ).mockResolvedValueOnce(mockDMs as any);

      // Execute
      await DirectMessageController.getDirectMessages(
        mockRequest as AuthenticatedRequest,
        mockResponse as Response,
        nextFunction,
      );

      // Assert
      expect(directMessageService.getUserDirectMessages).toHaveBeenCalledWith(
        userId,
      );
      expect(mockResponse.json).toHaveBeenCalledWith(mockDMs);
      expect(nextFunction).not.toHaveBeenCalled();
    });

    it("should call next with error if service throws", async () => {
      // Mock service error
      const error = new Error("Service error");
      vi.mocked(
        directMessageService.getUserDirectMessages,
      ).mockRejectedValueOnce(error);

      // Execute
      await DirectMessageController.getDirectMessages(
        mockRequest as AuthenticatedRequest,
        mockResponse as Response,
        nextFunction,
      );

      // Assert
      expect(nextFunction).toHaveBeenCalledWith(error);
    });
  });

  describe("getDirectMessageById", () => {
    it("should return direct message by ID", async () => {
      // Setup params
      mockRequest.params = { id: "dm1" };

      // Mock service response
      const mockDM = { _id: "dm1" };
      vi.mocked(
        directMessageService.getDirectMessageById,
      ).mockResolvedValueOnce(mockDM as any);

      // Execute
      await DirectMessageController.getDirectMessageById(
        mockRequest as AuthenticatedRequest,
        mockResponse as Response,
        nextFunction,
      );

      // Assert
      expect(directMessageService.getDirectMessageById).toHaveBeenCalledWith(
        "dm1",
        userId,
      );
      expect(mockResponse.json).toHaveBeenCalledWith(mockDM);
    });
  });

  describe("getMessages", () => {
    it("should return messages for a direct message", async () => {
      // Setup params and query
      mockRequest.params = { id: "dm1" };
      mockRequest.query = { limit: "50" };

      // Mock service response
      const mockMessages = [{ content: "msg1" }, { content: "msg2" }];
      vi.mocked(directMessageService.getMessages).mockResolvedValueOnce(
        mockMessages as any,
      );

      // Execute
      await DirectMessageController.getMessages(
        mockRequest as AuthenticatedRequest,
        mockResponse as Response,
        nextFunction,
      );

      // Assert
      expect(directMessageService.getMessages).toHaveBeenCalledWith(
        "dm1",
        userId,
        { limit: 50 },
      );
      expect(mockResponse.json).toHaveBeenCalledWith(mockMessages);
    });

    it("should handle invalid query parameters", async () => {
      // Setup invalid query
      mockRequest.params = { id: "dm1" };
      mockRequest.query = { limit: "invalid" };

      // Execute
      await DirectMessageController.getMessages(
        mockRequest as AuthenticatedRequest,
        mockResponse as Response,
        nextFunction,
      );

      // Assert
      expect(nextFunction).toHaveBeenCalledWith(expect.any(ValidationError));
    });
  });

  describe("sendMessage", () => {
    it("should create and return a new message", async () => {
      // Setup body
      mockRequest.body = {
        content: "Test message",
        directMessageId: "dm1",
      };

      // Mock service response
      const mockResult = {
        message: { content: "Test message" },
        directMessage: { _id: "dm1" },
      };
      vi.mocked(directMessageService.sendMessage).mockResolvedValueOnce(
        mockResult as any,
      );

      // Execute
      await DirectMessageController.sendMessage(
        mockRequest as AuthenticatedRequest,
        mockResponse as Response,
        nextFunction,
      );

      // Assert - Updated to match what the controller actually sends
      expect(directMessageService.sendMessage).toHaveBeenCalledWith({
        senderId: userId,
        directMessageId: "dm1",
        receiverId: undefined,
        content: "Test message",
        richContent: undefined,
        contentType: "text", // Controller determines this based on richContent
        attachmentIds: [],
        replyToId: undefined,
      });

      expect(mockResponse.status).toHaveBeenCalledWith(201);
      expect(mockResponse.json).toHaveBeenCalledWith(mockResult);
    });

    it("should handle rich content message", async () => {
      // Setup body with rich content
      mockRequest.body = {
        content: "Test message",
        directMessageId: "dm1",
        richContent: [{ type: "paragraph", children: [{ text: "Rich text" }] }],
        attachmentIds: ["attachment1"],
      };

      // Mock service response
      const mockResult = {
        message: { content: "Test message" },
        directMessage: { _id: "dm1" },
      };
      vi.mocked(directMessageService.sendMessage).mockResolvedValueOnce(
        mockResult as any,
      );

      // Execute
      await DirectMessageController.sendMessage(
        mockRequest as AuthenticatedRequest,
        mockResponse as Response,
        nextFunction,
      );

      // Assert
      expect(directMessageService.sendMessage).toHaveBeenCalledWith({
        senderId: userId,
        directMessageId: "dm1",
        receiverId: undefined,
        content: "Test message",
        richContent: [{ type: "paragraph", children: [{ text: "Rich text" }] }],
        contentType: "rich", // Controller determines this based on richContent
        attachmentIds: ["attachment1"],
        replyToId: undefined,
      });

      expect(mockResponse.status).toHaveBeenCalledWith(201);
      expect(mockResponse.json).toHaveBeenCalledWith(mockResult);
    });

    it("should handle message with receiverId", async () => {
      // Setup body with receiverId instead of directMessageId
      mockRequest.body = {
        content: "Test message",
        receiverId: "user123",
      };

      // Mock service response
      const mockResult = {
        message: { content: "Test message" },
        directMessage: { _id: "dm1" },
      };
      vi.mocked(directMessageService.sendMessage).mockResolvedValueOnce(
        mockResult as any,
      );

      // Execute
      await DirectMessageController.sendMessage(
        mockRequest as AuthenticatedRequest,
        mockResponse as Response,
        nextFunction,
      );

      // Assert
      expect(directMessageService.sendMessage).toHaveBeenCalledWith({
        senderId: userId,
        directMessageId: undefined,
        receiverId: "user123",
        content: "Test message",
        richContent: undefined,
        contentType: "text",
        attachmentIds: [],
        replyToId: undefined,
      });

      expect(mockResponse.status).toHaveBeenCalledWith(201);
      expect(mockResponse.json).toHaveBeenCalledWith(mockResult);
    });

    it("should handle validation errors", async () => {
      // Setup invalid body (missing content)
      mockRequest.body = {
        directMessageId: "dm1",
      };

      // Execute
      await DirectMessageController.sendMessage(
        mockRequest as AuthenticatedRequest,
        mockResponse as Response,
        nextFunction,
      );

      // Assert
      expect(nextFunction).toHaveBeenCalledWith(expect.any(ValidationError));
    });
  });
});