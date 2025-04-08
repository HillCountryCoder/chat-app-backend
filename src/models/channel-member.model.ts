// src/models/channel-member.model.ts
import mongoose, { Document, Schema } from "mongoose";

export enum NotificationPreference {
  ALL = "all",
  MENTIONS = "mentions",
  NONE = "none",
}

export interface ChannelMemberInterface extends Document {
  channelId: mongoose.Types.ObjectId;
  userId: mongoose.Types.ObjectId;
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
  },
);

// Compound index to ensure a user can only be a member of a channel once
channelMemberSchema.index({ channelId: 1, userId: 1 }, { unique: true });
// Indexes for faster lookups
channelMemberSchema.index({ channelId: 1 });
channelMemberSchema.index({ userId: 1 });

export const ChannelMember = mongoose.model<ChannelMemberInterface>(
  "ChannelMember",
  channelMemberSchema,
);
