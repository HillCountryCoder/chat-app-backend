// src/models/channel-member.model.ts
import mongoose, { Document, Schema } from "mongoose";

export enum NotificationPreference {
  ALL = "all",
  MENTIONS = "mentions",
  NONE = "none",
}

export enum MemberRole {
  ADMIN = "admin",
  MODERATOR = "moderator",
  MEMBER = "member",
}

export interface ChannelMemberInterface extends Document {
  channelId: mongoose.Types.ObjectId;
  userId: mongoose.Types.ObjectId;
  roles: MemberRole[];
  permissions: string[];
  joinedAt: Date;
  notificationPreference: NotificationPreference;
}

const channelMemberSchema = new Schema<ChannelMemberInterface>(
  {
    channelId: {
      type: Schema.Types.ObjectId,
      ref: "Channel",
      required: true,
    },
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    roles: [
      {
        type: String,
        enum: Object.values(MemberRole),
        default: [MemberRole.MEMBER],
      },
    ],
    permissions: [
      {
        type: String,
        default: [],
      },
    ],
    joinedAt: { type: Date, default: Date.now },
    notificationPreference: {
      type: String,
      enum: Object.values(NotificationPreference),
      default: NotificationPreference.ALL,
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  },
);

channelMemberSchema.virtual("user", {
  ref: "User",
  localField: "userId",
  foreignField: "_id",
  justOne: true,
});

// Pre-hook to populate user virtual
channelMemberSchema.pre(["find", "findOne", "findOneAndUpdate"], function () {
  this.populate({
    path: "user",
    select: "_id username displayName avatarUrl email status",
  });
});

// Compound index to ensure a user can only be a member of a channel once
channelMemberSchema.index({ channelId: 1, userId: 1 }, { unique: true });
// Indexes for faster lookups
channelMemberSchema.index({ channelId: 1 });
channelMemberSchema.index({ userId: 1 });

export const ChannelMember = mongoose.model<ChannelMemberInterface>(
  "ChannelMember",
  channelMemberSchema,
);
