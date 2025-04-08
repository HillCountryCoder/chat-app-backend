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
  ChannelInterface,
} from "../models";
import {
  ChannelMemberInterface,
  NotificationPreference,
} from "../models/channel-member.model";
import mongoose from "mongoose";

const logger = createLogger("channel-service");

export interface CreateChannelDTO {
  name: string;
  description?: string;
  spaceId: string;
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
    const existingChannel = await channelRepository.findOne({
      spaceId: data.spaceId,
      name: data.name,
    });
    if (existingChannel) {
      throw new ConflictError(
        `Channel with name '${data.name}' already exists in this space`,
      );
    }
    // Create the channel
    const channel = await channelRepository.create({
      spaceId: data.spaceId,
      name: data.name,
      description: data.description || "",
      type: data.type || ChannelType.TEXT,
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
  async getChannelsByUserId(userId: string): Promise<ChannelInterface[]> {
    // Find all channel memberships for this user
    const memberships = await channelMemberRepository.find({ userId });

    if (!memberships.length) {
      return [];
    }

    // Get the channel IDs
    const channelIds = memberships.map((membership) => membership.channelId);

    // Fetch the channels
    return channelRepository.find({
      _id: { $in: channelIds },
      isArchived: false,
    });
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
      permissions: "admin",
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
      // Check if the user who's removing is a member with admin permissions
      const adminMembership = await channelMemberRepository.findOne({
        channelId,
        userId: removedByUserId,
        permissions: "admin",
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

    return {
      message,
    };
  }
}
export const channelService = ChannelService.getInstance();
