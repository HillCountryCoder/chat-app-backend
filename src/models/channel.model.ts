import mongoose, { Document, Schema } from "mongoose";

export enum ChannelType {
  TEXT = "text",
  VOICE = "voice",
  ANNOUNCEMENT = "announcement",
}

export interface ChannelInterface extends Document {
  _id: mongoose.Types.ObjectId;
  name: string;
  description?: string;
  creatorId: mongoose.Types.ObjectId;
  avatarUrl?: string;
  createdAt: Date;
  type: ChannelType;
  isArchived: boolean;
}

const channelSchema = new Schema<ChannelInterface>(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      minLength: 2,
      maxLength: 50,
    },
    description: {
      type: String,
      trim: true,
      maxLength: 500,
    },
    creatorId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    avatarUrl: String,
    createdAt: { type: Date, default: Date.now },
    type: {
      type: String,
      enum: Object.values(ChannelType),
      default: ChannelType.TEXT,
    },
    isArchived: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
  },
);

// Index for faster lookups
channelSchema.index({ creatorId: 1 });
channelSchema.index({ isArchived: 1 });
channelSchema.index({ name: 1 }, { unique: true });

export const Channel = mongoose.model<ChannelInterface>(
  "Channel",
  channelSchema,
);
