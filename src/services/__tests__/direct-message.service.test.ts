/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { directMessageService } from "../direct-message.service";
import { directMessageRepository } from "../../repositories/direct-message.repository";
import { messageRepository } from "../../repositories/message.repository";
import { userRepository } from "../../repositories/user.repository";
import { NotFoundError, ForbiddenError } from "../../common/errors";
import mongoose from "mongoose";
import { unreadMessagesService } from "../unread-messages.service";

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
    create: vi.fn(),
  },
}));

vi.mock("../../repositories/user.repository", () => ({
  userRepository: {
    findById: vi.fn(),
    findByIds: vi.fn(),
  },
}));

// Mock unread messages service
vi.mock("../unread-messages.service", () => ({
  unreadMessagesService: {
    incrementUnreadCount: vi.fn().mockResolvedValue(undefined),
    markAsRead: vi.fn().mockResolvedValue(undefined),
    getAllUnreadCounts: vi
      .fn()
      .mockResolvedValue({ directMessages: {}, channels: {} }),
    getUnreadCount: vi.fn().mockResolvedValue(0),
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

      vi.mocked(messageRepository.create).mockResolvedValueOnce(
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

      expect(messageRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          directMessageId,
          content: "Test message",
        }),
      );

      expect(directMessageRepository.update).toHaveBeenCalledWith(
        directMessageId,
        { lastActivity: expect.any(Date) },
      );

      expect(unreadMessagesService.incrementUnreadCount).toHaveBeenCalledWith(
        "dm",
        directMessageId,
        userId1,
        expect.any(Array),
      );
    });

    it("should create new direct message when receiverId is provided", async () => {
      // Mock that no existing direct message exists
      vi.mocked(
        directMessageRepository.findByParticipants,
      ).mockResolvedValueOnce(null);

      // Mock user validation
      vi.mocked(userRepository.findByIds).mockResolvedValueOnce([
        { _id: userId1 } as any,
        { _id: userId2 } as any,
      ]);

      // Mock direct message creation
      const mockCreatedDM = {
        _id: directMessageId,
        participantIds: [
          new mongoose.Types.ObjectId(userId1),
          new mongoose.Types.ObjectId(userId2),
        ],
      };

      vi.mocked(directMessageRepository.create).mockResolvedValueOnce(
        mockCreatedDM as any,
      );

      // Mock direct message retrieval for sendMessage
      vi.mocked(directMessageRepository.findById).mockResolvedValueOnce(
        mockCreatedDM as any,
      );

      // Mock message creation
      const mockMessage = {
        _id: new mongoose.Types.ObjectId().toString(),
        messageId: `${Date.now()}_mock-uuid`,
        content: "Test message",
      };

      vi.mocked(messageRepository.create).mockResolvedValueOnce(
        mockMessage as any,
      );

      // Execute
      const result = await directMessageService.sendMessage({
        senderId: userId1,
        receiverId: userId2,
        content: "Test message",
      });

      // Assert
      expect(directMessageRepository.findByParticipants).toHaveBeenCalledWith(
        userId1,
        userId2,
      );
      expect(directMessageRepository.create).toHaveBeenCalledWith({
        participantIds: [
          new mongoose.Types.ObjectId(userId1),
          new mongoose.Types.ObjectId(userId2),
        ],
      });

      expect(result).toEqual({
        message: mockMessage,
        directMessage: mockCreatedDM,
      });

      expect(unreadMessagesService.incrementUnreadCount).toHaveBeenCalledWith(
        "dm",
        directMessageId,
        userId1,
        expect.any(Array),
      );
    });

    it("should use existing direct message when receiverId is provided and DM exists", async () => {
      // Mock existing direct message
      const mockExistingDM = {
        _id: directMessageId,
        participantIds: [
          new mongoose.Types.ObjectId(userId1),
          new mongoose.Types.ObjectId(userId2),
        ],
      };

      vi.mocked(
        directMessageRepository.findByParticipants,
      ).mockResolvedValueOnce(mockExistingDM as any);

      // Mock user validation
      vi.mocked(userRepository.findByIds).mockResolvedValueOnce([
        { _id: userId1 } as any,
        { _id: userId2 } as any,
      ]);

      // Mock direct message retrieval for sendMessage
      vi.mocked(directMessageRepository.findById).mockResolvedValueOnce(
        mockExistingDM as any,
      );

      // Mock message creation
      const mockMessage = {
        _id: new mongoose.Types.ObjectId().toString(),
        messageId: `${Date.now()}_mock-uuid`,
        content: "Test message",
      };

      vi.mocked(messageRepository.create).mockResolvedValueOnce(
        mockMessage as any,
      );

      // Execute
      const result = await directMessageService.sendMessage({
        senderId: userId1,
        receiverId: userId2,
        content: "Test message",
      });

      // Assert
      expect(directMessageRepository.findByParticipants).toHaveBeenCalledWith(
        userId1,
        userId2,
      );
      expect(directMessageRepository.create).not.toHaveBeenCalled();

      expect(result).toEqual({
        message: mockMessage,
        directMessage: mockExistingDM,
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

    it("should throw NotFoundError if receiver user doesn't exist", async () => {
      // Mock user validation to return only one user
      vi.mocked(userRepository.findByIds).mockResolvedValueOnce([
        { _id: userId1 } as any,
      ]);

      // Execute & Assert
      await expect(
        directMessageService.sendMessage({
          senderId: userId1,
          receiverId: userId2,
          content: "Test message",
        }),
      ).rejects.toThrow(NotFoundError);
    });
  });

  describe("getUserDirectMessages", () => {
    it("should return user's direct messages with last message", async () => {
      const mockDMs = [
        {
          _id: directMessageId,
          participantIds: [userId1, userId2],
          toObject: () => ({
            _id: directMessageId,
            participantIds: [userId1, userId2],
          }),
        },
      ];

      const mockMessages = [
        {
          _id: new mongoose.Types.ObjectId().toString(),
          content: "Last message",
        },
      ];

      vi.mocked(directMessageRepository.findAllByUserId).mockResolvedValueOnce(
        mockDMs as any,
      );

      vi.mocked(messageRepository.findByDirectMessageId).mockResolvedValueOnce(
        mockMessages as any,
      );

      // Mock message service
      const mockMessageService = {
        populateMessageAttachments: vi.fn().mockResolvedValue(mockMessages),
      };

      // Execute
      const result = await directMessageService.getUserDirectMessages(userId1);

      // Assert
      expect(result).toEqual([
        {
          _id: directMessageId,
          participantIds: [userId1, userId2],
          lastMessage: mockMessages[0],
        },
      ]);
    });
  });

  describe("getMessages", () => {
    it("should return messages for a direct message", async () => {
      const mockDM = {
        _id: directMessageId,
        participantIds: [
          new mongoose.Types.ObjectId(userId1),
          new mongoose.Types.ObjectId(userId2),
        ],
      };

      const mockMessages = [
        {
          _id: new mongoose.Types.ObjectId().toString(),
          content: "Message 1",
        },
        {
          _id: new mongoose.Types.ObjectId().toString(),
          content: "Message 2",
        },
      ];

      vi.mocked(directMessageRepository.findById).mockResolvedValueOnce(
        mockDM as any,
      );

      vi.mocked(messageRepository.findByDirectMessageId).mockResolvedValueOnce(
        mockMessages as any,
      );

      // Execute
      const result = await directMessageService.getMessages(
        directMessageId,
        userId1,
        { limit: 50 },
      );

      // Assert
      expect(directMessageRepository.findById).toHaveBeenCalledWith(
        directMessageId,
      );
      expect(messageRepository.findByDirectMessageId).toHaveBeenCalledWith(
        directMessageId,
        { limit: 50 },
      );
    });

    it("should throw ForbiddenError if user is not a participant", async () => {
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

      const nonParticipantId = new mongoose.Types.ObjectId().toString();

      // Execute & Assert
      await expect(
        directMessageService.getMessages(directMessageId, nonParticipantId),
      ).rejects.toThrow(ForbiddenError);
    });
  });
});
