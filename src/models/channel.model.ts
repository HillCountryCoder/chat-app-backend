import mongoose, { Document, Schema } from "mongoose";

export enum ChannelType {
  TEXT = "text",
  VOICE = "voice",
  ANNOUNCEMENT = "announcement",
}

export interface ChannelInterface extends Document {
  _id: mongoose.Types.ObjectId;
  spaceId: mongoose.Types.ObjectId;
  name: string;
  description?: string;
  createdAt: Date;
  type: ChannelType;
  isArchived: boolean;
}

const channelSchema = new Schema<ChannelInterface>(
  {
    spaceId: {
      type: Schema.Types.ObjectId,
      ref: "Space",
      required: true,
    },
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

channelSchema.index({ spaceId: 1 });
channelSchema.index({ isArchived: 1 });

// compound index so that space have unique channels

channelSchema.index({ spaceId: 1, name: 1 }, { unique: true });

export const Channel = mongoose.model<ChannelInterface>(
  "Channel",
  channelSchema,
);
