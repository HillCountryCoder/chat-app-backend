import { describe, it, expect, vi, beforeEach } from "vitest";
import { directMessageService } from "../direct-message.service";
import { directMessageRepository } from "../../repositories/direct-message.repository";
import { messageRepository } from "../../repositories/message.repository";
import { userRepository } from "../../repositories/user.repository";
import { NotFoundError, ForbiddenError } from "../../common/errors";
import mongoose from "mongoose";

// Mock repositories
vi.mock("../../repositories/direct-message.repository", () => ({
  directMessageRepository: {
    findByParticipants: vi.fn(),
    findById: vi.fn(),
    findAllByUserId: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
}));

vi.mock("../../repositories/message.repository", () => ({
  messageRepository: {
    findByDirectMessageId: vi.fn(),
    createMessage: vi.fn(),
  },
}));

vi.mock("../../repositories/user.repository", () => ({
  userRepository: {
    findById: vi.fn(),
  },
}));

// Mock uuid
vi.mock("uuid", () => ({
  v4: () => "mock-uuid",
}));

describe("DirectMessageService", () => {
  let userId1: string;
  let userId2: string;
  let directMessageId: string;

  beforeEach(() => {
    vi.clearAllMocks();

    userId1 = new mongoose.Types.ObjectId().toString();
    userId2 = new mongoose.Types.ObjectId().toString();
    directMessageId = new mongoose.Types.ObjectId().toString();
  });

  describe("getOrCreateDirectMessage", () => {
    it("should return existing direct message if found", async () => {
      // Mock user repository
      vi.mocked(userRepository.findById).mockResolvedValueOnce({
        _id: userId1,
      } as any);
      vi.mocked(userRepository.findById).mockResolvedValueOnce({
        _id: userId2,
      } as any);

      // Mock direct message repository
      const mockDM = {
        _id: directMessageId,
        participantIds: [userId1, userId2],
      };
      vi.mocked(
        directMessageRepository.findByParticipants,
      ).mockResolvedValueOnce(mockDM as any);

      // Execute
      const result = await directMessageService.getOrCreateDirectMessage(
        userId1,
        userId2,
      );

      // Assert
      expect(result).toEqual(mockDM);
      expect(directMessageRepository.findByParticipants).toHaveBeenCalledWith(
        userId1,
        userId2,
      );
      expect(directMessageRepository.create).not.toHaveBeenCalled();
    });

    it("should create new direct message if none exists", async () => {
      // Mock user repository
      vi.mocked(userRepository.findById).mockResolvedValueOnce({
        _id: userId1,
      } as any);
      vi.mocked(userRepository.findById).mockResolvedValueOnce({
        _id: userId2,
      } as any);

      // Mock direct message repository
      vi.mocked(
        directMessageRepository.findByParticipants,
      ).mockResolvedValueOnce(null);

      const mockCreatedDM = {
        _id: directMessageId,
        participantIds: [userId1, userId2].sort(),
      };
      vi.mocked(directMessageRepository.create).mockResolvedValueOnce(
        mockCreatedDM as any,
      );

      // Execute
      const result = await directMessageService.getOrCreateDirectMessage(
        userId1,
        userId2,
      );

      // Assert
      expect(result).toEqual(mockCreatedDM);
      expect(directMessageRepository.create).toHaveBeenCalledWith({
        participantIds: [userId1, userId2].sort(),
        lastActivity: expect.any(Date),
      });
    });

    it("should throw NotFoundError if a user doesn't exist", async () => {
      // Mock user repository to return null for second user
      vi.mocked(userRepository.findById).mockResolvedValueOnce({
        _id: userId1,
      } as any);
      vi.mocked(userRepository.findById).mockResolvedValueOnce(null);

      // Execute & Assert
      await expect(
        directMessageService.getOrCreateDirectMessage(userId1, userId2),
      ).rejects.toThrow(NotFoundError);
    });
  });

  describe("getDirectMessageById", () => {
    it("should return direct message if user is a participant", async () => {
      // Mock direct message repository
      const mockDM = {
        _id: directMessageId,
        participantIds: [
          new mongoose.Types.ObjectId(userId1),
          new mongoose.Types.ObjectId(userId2),
        ],
      };

      vi.mocked(directMessageRepository.findById).mockResolvedValueOnce(
        mockDM as any,
      );

      // Execute
      const result = await directMessageService.getDirectMessageById(
        directMessageId,
        userId1,
      );

      // Assert
      expect(result).toEqual(mockDM);
    });

    it("should throw NotFoundError if direct message doesn't exist", async () => {
      vi.mocked(directMessageRepository.findById).mockResolvedValueOnce(null);

      // Execute & Assert
      await expect(
        directMessageService.getDirectMessageById(directMessageId, userId1),
      ).rejects.toThrow(NotFoundError);
    });

    it("should throw ForbiddenError if user is not a participant", async () => {
      // Mock direct message repository
      const mockDM = {
        _id: directMessageId,
        participantIds: [
          new mongoose.Types.ObjectId(userId1),
          new mongoose.Types.ObjectId(userId2),
        ],
      };

      vi.mocked(directMessageRepository.findById).mockResolvedValueOnce(
        mockDM as any,
      );

      // Execute & Assert
      const nonParticipantId = new mongoose.Types.ObjectId().toString();
      await expect(
        directMessageService.getDirectMessageById(
          directMessageId,
          nonParticipantId,
        ),
      ).rejects.toThrow(ForbiddenError);
    });
  });

  describe("sendMessage", () => {
    it("should send message to existing direct message", async () => {
      // Mock direct message
      const mockDM = {
        _id: directMessageId,
        participantIds: [
          new mongoose.Types.ObjectId(userId1),
          new mongoose.Types.ObjectId(userId2),
        ],
      };

      vi.mocked(directMessageRepository.findById).mockResolvedValueOnce(
        mockDM as any,
      );

      // Mock message creation
      const mockMessage = {
        _id: new mongoose.Types.ObjectId().toString(),
        messageId: `${Date.now()}_mock-uuid`,
        content: "Test message",
      };

      vi.mocked(messageRepository.createMessage).mockResolvedValueOnce(
        mockMessage as any,
      );

      // Execute
      const result = await directMessageService.sendMessage({
        senderId: userId1,
        directMessageId,
        content: "Test message",
      });

      // Assert
      expect(result).toEqual({
        message: mockMessage,
        directMessage: mockDM,
      });

      expect(messageRepository.createMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          directMessageId,
          content: "Test message",
        }),
      );

      expect(directMessageRepository.update).toHaveBeenCalledWith(
        directMessageId,
        { lastActivity: expect.any(Date) },
      );
    });

    it("should get or create direct message when receiverId is provided", async () => {
      // Mock getOrCreateDirectMessage
      const mockDM = {
        _id: directMessageId,
        participantIds: [userId1, userId2],
      };

      const spy = vi
        .spyOn(directMessageService, "getOrCreateDirectMessage")
        .mockResolvedValueOnce(mockDM as any);

      // Mock direct message for getDirectMessageById
      vi.mocked(directMessageRepository.findById).mockResolvedValueOnce(
        mockDM as any,
      );

      // Mock message creation
      const mockMessage = {
        _id: new mongoose.Types.ObjectId().toString(),
        messageId: `${Date.now()}_mock-uuid`,
        content: "Test message",
      };

      vi.mocked(messageRepository.createMessage).mockResolvedValueOnce(
        mockMessage as any,
      );

      // Execute
      const result = await directMessageService.sendMessage({
        senderId: userId1,
        receiverId: userId2,
        content: "Test message",
      });

      // Assert
      expect(spy).toHaveBeenCalledWith(userId1, userId2);
      expect(result).toEqual({
        message: mockMessage,
        directMessage: mockDM,
      });
    });

    it("should throw error if neither directMessageId nor receiverId is provided", async () => {
      // Execute & Assert
      await expect(
        directMessageService.sendMessage({
          senderId: userId1,
          content: "Test message",
        }),
      ).rejects.toThrow(
        "Either directMessageId or receiverId must be provided",
      );
    });
  });
});
