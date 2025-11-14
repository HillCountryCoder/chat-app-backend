import mongoose, { Document, Schema } from "mongoose";
import { tenantIsolationPlugin } from "../plugins/tenantPlugin";

export interface Thread extends Document {
  channelId: mongoose.Types.ObjectId;
  parentMessageId: mongoose.Types.ObjectId; // The message that started the thread
  title?: string; // Optional title for the thread
  createdAt: Date;
  lastActivity: Date;
  participantIds: mongoose.Types.ObjectId[]; // Users who have participated in the thread
}

const threadSchema = new Schema<Thread>(
  {
    channelId: {
      type: Schema.Types.ObjectId,
      ref: "Channel",
      required: true,
    },
    parentMessageId: {
      type: Schema.Types.ObjectId,
      ref: "Message",
      required: true,
    },
    title: {
      type: String,
      trim: true,
      maxLength: 100,
    },
    createdAt: { type: Date, default: Date.now },
    lastActivity: { type: Date, default: Date.now },
    participantIds: [
      {
        type: Schema.Types.ObjectId,
        ref: "User",
      },
    ],
  },
  {
    timestamps: true,
  },
);

// Indexes for faster lookups
threadSchema.index({ channelId: 1 });
threadSchema.index({ participantIds: 1 });
threadSchema.index({ lastActivity: -1 });

// New Indexes for multi-tenancy
threadSchema.index(
  { tenantId: 1, channelId: 1 },
  { name: "tenant_channel_idx" },
);
threadSchema.index(
  { tenantId: 1, parentMessageId: 1 },
  { name: "tenant_parentMessage_idx" },
);
threadSchema.index(
  { tenantId: 1, participantIds: 1 },
  { name: "tenant_participant_idx" },
);
threadSchema.index(
  { tenantId: 1, lastActivity: -1 },
  { name: "tenant_lastActivity_idx" },
);
threadSchema.index(
  { tenantId: 1, parentMessageId: 1 },
  { unique: true, name: "tenant_parentMessage_unique_idx" },
);

// Plugin to enforce tenant isolation if needed in future
threadSchema.plugin(tenantIsolationPlugin);

export const Thread = mongoose.model<Thread>("Thread", threadSchema);
