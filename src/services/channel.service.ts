// src/services/channel.service.ts
import { createLogger } from "../common/logger";
import { channelRepository } from "../repositories/channel.repository";
import { channelMemberRepository } from "../repositories/channel-member.repository";
import { userRepository } from "../repositories/user.repository";
import { messageRepository } from "../repositories/message.repository";
import {
  NotFoundError,
  ForbiddenError,
  ConflictError,
  ValidationError,
} from "../common/errors";
import { v4 as uuidv4 } from "uuid";
import {
  Channel,
  ChannelType,
  ChannelMember,
  Message,
  ContentType,
  MemberRole,
  ChannelInterface,
} from "../models";
import {
  ChannelMemberInterface,
  NotificationPreference,
} from "../models/channel-member.model";
import mongoose from "mongoose";
import { threadRepository } from "../repositories/thread.repository";
import { unreadMessagesService } from "./unread-messages.service";

const logger = createLogger("channel-service");

export interface CreateChannelDTO {
  name: string;
  description?: string;
  type?: ChannelType;
  memberIds: string[];
}

export interface ChannelWithMembersDTO {
  channel: ChannelInterface;
  members: ChannelMemberInterface[];
}

export class ChannelService {
  private static instance: ChannelService;

  private constructor() {}

  static getInstance(): ChannelService {
    if (!ChannelService.instance) {
      ChannelService.instance = new ChannelService();
    }
    return ChannelService.instance;
  }

  async createChannel(
    data: CreateChannelDTO,
    creatorId: string,
  ): Promise<ChannelWithMembersDTO> {
    // Check if channel name already exists
    const existingChannel = await channelRepository.findOne({
      name: data.name,
    });

    if (existingChannel) {
      throw new ConflictError(
        `Channel with name '${data.name}' already exists`,
      );
    }

    // Create the channel
    const channel = await channelRepository.create({
      name: data.name,
      description: data.description || "",
      type: data.type || ChannelType.TEXT,
      creatorId: creatorId,
      isArchived: false,
      createdAt: new Date(),
    });

    // Add members to the channel
    const uniqueMemberIds = [...new Set([creatorId, ...data.memberIds])];

    // Validate that we're not exceeding member limit
    if (uniqueMemberIds.length > 100) {
      await channelRepository.delete(channel._id.toString());
      throw new ValidationError("Channel cannot have more than 100 members");
    }

    // Verify all users exist
    const users = await userRepository.find({
      _id: { $in: uniqueMemberIds },
    });

    if (users.length !== uniqueMemberIds.length) {
      await channelRepository.delete(channel._id.toString());
      throw new NotFoundError("One or more users do not exist");
    }

    // Add members
    const memberPromises = uniqueMemberIds.map((userId) => {
      const isCreator = userId === creatorId;

      return channelMemberRepository.create({
        channelId: channel._id,
        userId: userId,
        roles: isCreator ? [MemberRole.ADMIN] : [MemberRole.MEMBER],
        permissions: isCreator ? ["admin"] : [],
        notificationPreference: NotificationPreference.ALL,
        joinedAt: new Date(),
      });
    });

    const members = await Promise.all(memberPromises);

    // Create system message
    await messageRepository.createMessage({
      messageId: `${Date.now()}_${uuidv4()}`,
      senderId: creatorId,
      channelId: channel._id.toString(),
      content: `Channel "${channel.name}" created`,
      contentType: ContentType.SYSTEM,
    });

    return {
      channel,
      members,
    };
  }

  async getChannelById(
    channelId: string,
    userId: string,
  ): Promise<ChannelInterface> {
    const channel = await channelRepository.findById(channelId);

    if (!channel) {
      throw new NotFoundError("channel");
    }

    // Check if user is a member of the channel
    const membership = await channelMemberRepository.findOne({
      channelId,
      userId,
    });

    if (!membership) {
      throw new ForbiddenError("You are not a member of this channel");
    }

    return channel;
  }

  async getAllChannels(userId: string): Promise<ChannelInterface[]> {
    // Find all channel memberships for this user
    const memberships = await channelMemberRepository.find({ userId });

    if (!memberships.length) {
      return [];
    }

    // Get the channel IDs
    const channelIds = memberships.map((membership) => membership.channelId);

    // Fetch the channels
    const channels = await channelRepository.find({
      _id: { $in: channelIds },
      isArchived: false,
    });

    const channelsWithLastMessage = await Promise.all(
      channels.map(async (channel) => {
        const messages = await messageRepository.findByChannelId(
          channel._id.toString(),
          { limit: 1 },
        );

        return {
          ...channel.toObject(),
          lastMessage: messages.length > 0 ? messages[0] : null,
        };
      }),
    );
    return channelsWithLastMessage;
  }

  async getChannelMembers(
    channelId: string,
    userId: string,
  ): Promise<ChannelMemberInterface[]> {
    // First verify the user is a member of the channel
    const membership = await channelMemberRepository.findOne({
      channelId,
      userId,
    });

    if (!membership) {
      throw new ForbiddenError("You are not a member of this channel");
    }

    // Get all members
    return channelMemberRepository.find({ channelId });
  }

  async addMemberToChannel(
    channelId: string,
    newMemberId: string,
    addedByUserId: string,
  ): Promise<ChannelMemberInterface> {
    // Check if channel exists
    const channel = await channelRepository.findById(channelId);
    if (!channel) {
      throw new NotFoundError("channel");
    }

    // Check if the user who's adding is a member with admin permissions
    const adminMembership = await channelMemberRepository.findOne({
      channelId,
      userId: addedByUserId,
      roles: MemberRole.ADMIN,
    });

    if (!adminMembership) {
      throw new ForbiddenError(
        "You don't have permission to add members to this channel",
      );
    }

    // Check if user being added exists
    const newUser = await userRepository.findById(newMemberId);
    if (!newUser) {
      throw new NotFoundError("user");
    }

    // Check if user is already a member
    const existingMembership = await channelMemberRepository.findOne({
      channelId,
      userId: newMemberId,
    });

    if (existingMembership) {
      throw new ConflictError("User is already a member of this channel");
    }

    // Check if adding this member would exceed the limit
    const currentMemberCount = await channelMemberRepository.countDocuments({
      channelId,
    });
    if (currentMemberCount >= 100) {
      throw new ValidationError("Channel cannot have more than 100 members");
    }

    // Add the member
    const newMembership = await channelMemberRepository.create({
      channelId,
      userId: newMemberId,
      roles: [MemberRole.MEMBER],
      permissions: [],
      notificationPreference: NotificationPreference.ALL,
      joinedAt: new Date(),
    });

    // Create system message
    await messageRepository.createMessage({
      messageId: `${Date.now()}_${uuidv4()}`,
      senderId: addedByUserId,
      channelId: channel._id.toString(),
      content: `${newUser.displayName} was added to the channel`,
      contentType: ContentType.SYSTEM,
    });

    return newMembership;
  }

  async removeMemberFromChannel(
    channelId: string,
    memberIdToRemove: string,
    removedByUserId: string,
  ): Promise<void> {
    // Check if channel exists
    const channel = await channelRepository.findById(channelId);
    if (!channel) {
      throw new NotFoundError("channel");
    }

    // User can remove themselves or an admin can remove anyone
    const isRemovingSelf = memberIdToRemove === removedByUserId;

    if (!isRemovingSelf) {
      // Check if the user who's removing is a member with admin role
      const adminMembership = await channelMemberRepository.findOne({
        channelId,
        userId: removedByUserId,
        roles: MemberRole.ADMIN,
      });

      if (!adminMembership) {
        throw new ForbiddenError(
          "You don't have permission to remove members from this channel",
        );
      }
    }

    // Check if user being removed is a member
    const membershipToRemove = await channelMemberRepository.findOne({
      channelId,
      userId: memberIdToRemove,
    });

    if (!membershipToRemove) {
      throw new NotFoundError("channel membership");
    }

    // Check if user being removed is the last admin
    if (membershipToRemove.roles.includes(MemberRole.ADMIN)) {
      // Count admins
      const adminCount = await channelMemberRepository.countDocuments({
        channelId,
        roles: MemberRole.ADMIN,
      });

      if (adminCount <= 1) {
        throw new ForbiddenError(
          "Cannot remove the last admin from the channel",
        );
      }
    }

    // Get user info for system message
    const userBeingRemoved = await userRepository.findById(memberIdToRemove);

    // Remove the membership
    await channelMemberRepository.deleteOne({
      channelId: channelId,
      userId: memberIdToRemove,
    });

    // Create system message
    await messageRepository.createMessage({
      messageId: `${Date.now()}_${uuidv4()}`,
      senderId: removedByUserId,
      channelId: channel._id.toString(),
      content: isRemovingSelf
        ? `${userBeingRemoved?.displayName} left the channel`
        : `${userBeingRemoved?.displayName} was removed from the channel`,
      contentType: ContentType.SYSTEM,
    });
  }

  async getMessages(
    channelId: string,
    userId: string,
    options?: {
      limit?: number;
      before?: string;
      after?: string;
    },
  ) {
    // Verify user has access to this channel
    await this.getChannelById(channelId, userId);

    // Get messages
    return messageRepository.findByChannelId(channelId, options);
  }

  async sendMessage(data: {
    senderId: string;
    channelId: string;
    content: string;
  }) {
    // Verify channel exists and user is a member
    await this.getChannelById(data.channelId, data.senderId);

    // Create a unique messageId
    const messageId = `${Date.now()}_${uuidv4()}`;

    // Create the message
    const message = await messageRepository.createMessage({
      messageId,
      senderId: data.senderId,
      channelId: data.channelId,
      content: data.content,
      contentType: ContentType.TEXT,
    });

    // Update the channel's lastActivity timestamp
    await channelRepository.update(data.channelId, {
      lastActivity: new Date(),
    });

    const channelMembers = await channelMemberRepository.find({
      channelId: data.channelId,
    });
    const memberIds = channelMembers.map((member) =>
      member.userId instanceof mongoose.Types.ObjectId
        ? member.userId.toString()
        : member.userId,
    );

    await unreadMessagesService.incrementUnreadCount(
      "channel",
      data.channelId,
      data.senderId,
      memberIds,
    );

    return {
      message,
    };
  }
  async markMessagesAsRead(channelId: string, userId: string) {
    await this.getChannelById(channelId, userId);

    await unreadMessagesService.markAsRead(userId, "channel", channelId);

    return { success: true };
  }

  async getChannelUnreadCount(
    channelId: string,
    userId: string,
  ): Promise<number> {
    return unreadMessagesService.getUnreadCount(userId, "channel", channelId);
  }

  // Thread-related methods
  async createThread(data: {
    channelId: string;
    messageId: string;
    senderId: string;
    content: string;
    title?: string;
  }) {
    // Verify channel exists and user is a member
    await this.getChannelById(data.channelId, data.senderId);

    // Find the parent message
    const parentMessage = await messageRepository.findOne({
      messageId: data.messageId,
    });
    if (!parentMessage) {
      throw new NotFoundError("message");
    }

    // Mark the parent message as a thread starter
    await messageRepository.update(parentMessage._id.toString(), {
      isThreadStarter: true,
    });

    // Create the thread
    const thread = await threadRepository.create({
      channelId: data.channelId,
      parentMessageId: parentMessage._id,
      title: data.title,
      createdAt: new Date(),
      lastActivity: new Date(),
      participantIds: [data.senderId],
    });

    // Create the first message in the thread
    const threadMessageId = `${Date.now()}_${uuidv4()}`;
    const threadMessage = await messageRepository.createMessage({
      messageId: threadMessageId,
      senderId: data.senderId,
      threadId: thread._id.toString(),
      content: data.content,
      contentType: ContentType.TEXT,
    });

    return {
      thread,
      message: threadMessage,
    };
  }

  async getThreadMessages(
    threadId: string,
    userId: string,
    options?: {
      limit?: number;
      before?: string;
      after?: string;
    },
  ) {
    // Find the thread
    const thread = await threadRepository.findById(threadId);
    if (!thread) {
      throw new NotFoundError("thread");
    }

    // Verify user has access to the thread's channel
    await this.getChannelById(thread.channelId.toString(), userId);

    // Get messages
    return messageRepository.findByThreadId(threadId, options);
  }

  async sendThreadMessage(data: {
    senderId: string;
    threadId: string;
    content: string;
  }) {
    // Find the thread
    const thread = await threadRepository.findById(data.threadId);
    if (!thread) {
      throw new NotFoundError("thread");
    }

    // Verify user has access to the thread's channel
    await this.getChannelById(thread.channelId.toString(), data.senderId);

    // Create a unique messageId
    const messageId = `${Date.now()}_${uuidv4()}`;

    // Create the message
    const message = await messageRepository.createMessage({
      messageId,
      senderId: data.senderId,
      threadId: data.threadId,
      content: data.content,
      contentType: ContentType.TEXT,
    });

    // Update thread lastActivity and add participant if not already in the list
    const participants = new Set(
      thread.participantIds.map((id: mongoose.Types.ObjectId) => id.toString()),
    );
    participants.add(data.senderId);

    await threadRepository.update(data.threadId, {
      lastActivity: new Date(),
      participantIds: Array.from(participants),
    });

    return {
      message,
    };
  }

  async getThreadsByChannelId(channelId: string, userId: string) {
    // Verify user has access to the channel
    await this.getChannelById(channelId, userId);

    // Get threads for this channel
    return threadRepository.findByChannelId(channelId);
  }

  async getThreadById(threadId: string, userId: string) {
    // Find the thread
    const thread = await threadRepository.findById(threadId);
    if (!thread) {
      throw new NotFoundError("thread");
    }

    // Verify user has access to the thread's channel
    await this.getChannelById(thread.channelId.toString(), userId);

    return thread;
  }
}

export const channelService = ChannelService.getInstance();
