/* eslint-disable @typescript-eslint/no-explicit-any */
// src/services/channel.service.ts - Phase 3 additions only
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
  ChannelType,
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
import { messageService } from "./message.service"; // Phase 3 addition
import { attachmentService } from "./attachment.service"; // Phase 3 addition
import {
  MAX_ATTACHMENTS_PER_MESSAGE,
  MAX_TOTAL_MESSAGE_SIZE,
} from "../constants";
import { runInTenantContext, tenantContext } from "../plugins/tenantPlugin";
import { createLogger } from "../common/logger";

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

type PlateValue = Array<{
  id?: string;
  type: string;
  children: Array<{ text: string; [key: string]: any }>;
  [key: string]: any;
}>;

const logger = createLogger("channel-service");
export class ChannelService {
  private static instance: ChannelService;

  private constructor() {}

  static getInstance(): ChannelService {
    if (!ChannelService.instance) {
      ChannelService.instance = new ChannelService();
    }
    return ChannelService.instance;
  }
  private getTenantId(): string {
    const context = tenantContext.getStore();
    if (!context?.tenantId) {
      throw new Error("Channel operation attempted without tenant context");
    }
    return context.tenantId;
  }

  async createChannel(
    data: CreateChannelDTO,
    creatorId: string,
  ): Promise<ChannelWithMembersDTO> {
    return runInTenantContext(this.getTenantId(), async () => {
      const tenantId = this.getTenantId();
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
      logger.info("Channel created", {
        channelId: channel._id,
        channelName: channel.name,
        creatorId,
        tenantId,
        memberCount: members.length,
      });

      return {
        channel,
        members,
      };
    });
  }

  async getChannelById(
    channelId: string,
    userId: string,
  ): Promise<ChannelInterface> {
    return runInTenantContext(this.getTenantId(), async () => {
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
    });
  }

  async getAllChannels(userId: string): Promise<ChannelInterface[]> {
    return runInTenantContext(this.getTenantId(), async () => {
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
    });
  }

  async getChannelMembers(
    channelId: string,
    userId: string,
  ): Promise<ChannelMemberInterface[]> {
    return runInTenantContext(this.getTenantId(), async () => {
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
    });
  }

  async addMemberToChannel(
    channelId: string,
    newMemberId: string,
    addedByUserId: string,
  ): Promise<ChannelMemberInterface> {
    return runInTenantContext(this.getTenantId(), async () => {
      const tenantId = this.getTenantId();
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

      logger.info("Member added to channel", {
        channelId,
        newMemberId,
        addedByUserId,
        tenantId,
      });

      return newMembership;
    });
  }

  async removeMemberFromChannel(
    channelId: string,
    memberIdToRemove: string,
    removedByUserId: string,
  ): Promise<void> {
    return runInTenantContext(this.getTenantId(), async () => {
      const tenantId = this.getTenantId();
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
      logger.info("Member removed from channel", {
        channelId,
        memberIdToRemove,
        removedByUserId,
        tenantId,
        isRemovingSelf,
      });
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
    return runInTenantContext(this.getTenantId(), async () => {
      // Verify user has access to this channel
      await this.getChannelById(channelId, userId);

      // Phase 3 enhancement: Get messages with populated attachments
      const messages = await messageRepository.findByChannelId(
        channelId,
        options,
      );
      return await messageService.populateMessageAttachments(messages);
    });
  }

  async sendMessage(data: {
    senderId: string;
    channelId: string;
    content: string;
    richContent?: PlateValue; // Add this
    contentType?: ContentType; // Add this
    replyToId?: string;
    attachmentIds?: string[];
  }) {
    return runInTenantContext(this.getTenantId(), async () => {
      const tenantId = this.getTenantId();
      const { attachmentIds = [], richContent, contentType } = data; // Add richContent and contentType

      if (attachmentIds.length > 0) {
        await this.validateMessageWithAttachments(attachmentIds, data.senderId);
      }

      // Verify channel exists and user is a member
      await this.getChannelById(data.channelId, data.senderId);

      let finalContentType = contentType;
      if (!finalContentType) {
        finalContentType = richContent ? ContentType.RICH : ContentType.TEXT;
      }

      // Phase 3: Use messageService for attachment support
      const message =
        attachmentIds.length > 0 || richContent
          ? await messageService.createMessageWithAttachments({
              senderId: data.senderId,
              channelId: data.channelId,
              content: data.content,
              richContent,
              contentType: finalContentType,
              replyToId: data.replyToId,
              attachmentIds,
            })
          : await messageRepository.createMessage({
              messageId: `${Date.now()}_${uuidv4()}`,
              senderId: data.senderId,
              channelId: data.channelId,
              content: data.content,
              contentType: finalContentType,
              replyToId: data.replyToId,
            });

      // Existing population logic preserved
      const messageDocument = await messageRepository.findById(
        message._id.toString(),
      );
      const populatedMessage = await messageDocument?.populate({
        path: "replyTo",
        select: "content senderId",
        populate: {
          path: "senderId",
          select: "displayName",
        },
      });
      const populatedMessageWithSenderId = await populatedMessage.populate({
        path: "senderId",
        select: "_id username displayName avatarUrl",
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
      logger.info("Channel message sent", {
        messageId: message.messageId,
        channelId: data.channelId,
        senderId: data.senderId,
        tenantId,
        hasRichContent: !!richContent,
        attachmentCount: attachmentIds.length,
      });
      return {
        message: populatedMessageWithSenderId,
      };
    });
  }

  private async validateMessageWithAttachments(
    attachmentIds: string[],
    senderId: string,
  ): Promise<void> {
    if (!attachmentIds.length) return;

    // Check attachment count limit
    if (attachmentIds.length > MAX_ATTACHMENTS_PER_MESSAGE) {
      throw new ValidationError(
        `Cannot attach more than ${MAX_ATTACHMENTS_PER_MESSAGE} files per message`,
      );
    }

    // Validate attachment access and calculate total size
    await messageService.validateAttachmentAccess(attachmentIds, senderId);

    const totalSize = await attachmentService.calculateMessageAttachmentSize(
      attachmentIds,
    );

    if (totalSize > MAX_TOTAL_MESSAGE_SIZE) {
      throw new ValidationError(
        `Total attachment size (${Math.round(
          totalSize / 1024 / 1024,
        )}MB) exceeds limit of ${MAX_TOTAL_MESSAGE_SIZE / 1024 / 1024}MB`,
      );
    }
  }

  async markMessagesAsRead(channelId: string, userId: string) {
    return runInTenantContext(this.getTenantId(), async () => {
      await this.getChannelById(channelId, userId);

      await unreadMessagesService.markAsRead(userId, "channel", channelId);

      return { success: true };
    });
  }

  async getChannelUnreadCount(
    channelId: string,
    userId: string,
  ): Promise<number> {
    return unreadMessagesService.getUnreadCount(userId, "channel", channelId);
  }

  async createThread(data: {
    channelId: string;
    messageId: string;
    senderId: string;
    content: string;
    title?: string;
  }) {
    return runInTenantContext(this.getTenantId(), async () => {
      const tenantId = this.getTenantId();
      await this.getChannelById(data.channelId, data.senderId);

      const parentMessage = await messageRepository.findOne({
        messageId: data.messageId,
      });
      if (!parentMessage) {
        throw new NotFoundError("message");
      }

      await messageRepository.update(parentMessage._id.toString(), {
        isThreadStarter: true,
      });

      const thread = await threadRepository.create({
        channelId: data.channelId,
        parentMessageId: parentMessage._id,
        title: data.title,
        createdAt: new Date(),
        lastActivity: new Date(),
        participantIds: [data.senderId],
      });

      const threadMessageId = `${Date.now()}_${uuidv4()}`;
      const threadMessage = await messageRepository.createMessage({
        messageId: threadMessageId,
        senderId: data.senderId,
        threadId: thread._id.toString(),
        content: data.content,
        contentType: ContentType.TEXT,
      });
      logger.info("Thread created", {
        threadId: thread._id,
        channelId: data.channelId,
        senderId: data.senderId,
        tenantId,
      });
      return {
        thread,
        message: threadMessage,
      };
    });
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
    return runInTenantContext(this.getTenantId(), async () => {
      const thread = await threadRepository.findById(threadId);
      if (!thread) {
        throw new NotFoundError("thread");
      }

      await this.getChannelById(thread.channelId.toString(), userId);

      const messages = await messageRepository.findByThreadId(
        threadId,
        options,
      );
      return await messageService.populateMessageAttachments(messages);
    });
  }

  // Phase 3 enhancement: Updated sendThreadMessage to support attachments
  async sendThreadMessage(data: {
    senderId: string;
    threadId: string;
    content: string;
    attachmentIds?: string[]; // Phase 3 addition
  }) {
    return runInTenantContext(this.getTenantId(), async () => {
      const tenantId = this.getTenantId();
      const { attachmentIds = [] } = data; // Phase 3 addition

      // Phase 3: Validate attachments if provided
      if (attachmentIds.length > 0) {
        await this.validateMessageWithAttachments(attachmentIds, data.senderId);
      }

      // Find the thread
      const thread = await threadRepository.findById(data.threadId);
      if (!thread) {
        throw new NotFoundError("thread");
      }

      // Verify user has access to the thread's channel
      await this.getChannelById(thread.channelId.toString(), data.senderId);

      // Phase 3: Use messageService for attachment support
      const message =
        attachmentIds.length > 0
          ? await messageService.createMessageWithAttachments({
              senderId: data.senderId,
              threadId: data.threadId,
              content: data.content,
              attachmentIds,
            })
          : await messageRepository.createMessage({
              messageId: `${Date.now()}_${uuidv4()}`,
              senderId: data.senderId,
              threadId: data.threadId,
              content: data.content,
              contentType: ContentType.TEXT,
            });

      // Update thread lastActivity and add participant if not already in the list
      const participants = new Set(
        thread.participantIds.map((id: mongoose.Types.ObjectId) =>
          id.toString(),
        ),
      );
      participants.add(data.senderId);

      await threadRepository.update(data.threadId, {
        lastActivity: new Date(),
        participantIds: Array.from(participants),
      });
      logger.info("Thread message sent", {
        messageId: message.messageId,
        threadId: data.threadId,
        senderId: data.senderId,
        tenantId,
        attachmentCount: attachmentIds.length,
      });
      return {
        message,
      };
    });
  }

  async getThreadsByChannelId(channelId: string, userId: string) {
    return runInTenantContext(this.getTenantId(), async () => {
      // Verify user has access to the channel
      await this.getChannelById(channelId, userId);

      // Get threads for this channel
      return threadRepository.findByChannelId(channelId);
    });
  }

  async getThreadById(threadId: string, userId: string) {
    return runInTenantContext(this.getTenantId(), async () => {
      // Find the thread
      const thread = await threadRepository.findById(threadId);
      if (!thread) {
        throw new NotFoundError("thread");
      }

      // Verify user has access to the thread's channel
      await this.getChannelById(thread.channelId.toString(), userId);

      return thread;
    });
  }

  async getAttachmentStats(channelId: string, userId: string) {
    return runInTenantContext(this.getTenantId(), async () => {
      await this.getChannelById(channelId, userId);
      return await messageService.getAttachmentStatistics(channelId, "channel");
    });
  }

  async getMediaMessages(
    channelId: string,
    userId: string,
    options?: {
      limit?: number;
      before?: string;
      after?: string;
    },
  ) {
    return runInTenantContext(this.getTenantId(), async () => {
      await this.getChannelById(channelId, userId);
      const mediaMessages = await messageService.getMediaMessages(
        undefined,
        channelId,
        undefined,
        options,
      );
      return await messageService.populateMessageAttachments(mediaMessages);
    });
  }

  async editMessage(data: {
    channelId: string;
    messageId: string;
    userId: string;
    content: string;
    richContent?: PlateValue;
    contentType?: string;
  }) {
    return runInTenantContext(this.getTenantId(), async () => {
      const tenantId = this.getTenantId();
      const {
        channelId,
        messageId,
        userId,
        content,
        richContent,
        contentType,
      } = data;

      // Verify user has access to this channel
      await this.getChannelById(channelId, userId);

      // Edit the message using messageService
      const updatedMessage = await messageService.editMessage({
        messageId,
        userId,
        content,
        richContent,
        contentType,
        contextType: "channel",
        contextId: channelId,
      });
      logger.info("Channel message edited", {
        messageId,
        channelId,
        userId,
        tenantId,
        hasRichContent: !!richContent,
      });
      return {
        message: updatedMessage,
        success: true,
      };
    });
  }
}

export const channelService = ChannelService.getInstance();
