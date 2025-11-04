import mongoose, { Document, Schema } from "mongoose";
import { tenantIsolationPlugin } from "../plugins/tenantPlugin";

export enum ChannelType {
  TEXT = "text",
  VOICE = "voice",
  ANNOUNCEMENT = "announcement",
}

export interface ChannelInterface extends Document {
  _id: mongoose.Types.ObjectId;
  tenantId: string;
  name: string;
  description?: string;
  creatorId: mongoose.Types.ObjectId;
  avatarUrl?: string;
  lastActivity: Date;
  createdAt: Date;
  type: ChannelType;
  isArchived: boolean;
}

const channelSchema = new Schema<ChannelInterface>(
  {
    tenantId: {
      type: String,
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
    creatorId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    lastActivity: {
      type: Date,
      default: Date.now(),
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
// New Indexes for multi-tenancy
channelSchema.index(
  { tenantId: 1, name: 1 },
  { unique: true, name: "tenant_name_idx" },
);
channelSchema.index(
  { tenantId: 1, isArchived: 1 },
  { name: "tenant_archived_idx" },
);
channelSchema.index(
  { tenantId: 1, creatorId: 1 },
  { name: "tenant_creator_idx" },
);
channelSchema.plugin(tenantIsolationPlugin);
export const Channel = mongoose.model<ChannelInterface>(
  "Channel",
  channelSchema,
);
