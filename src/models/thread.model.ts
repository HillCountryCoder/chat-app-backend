import mongoose, { Document, Schema } from "mongoose";

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
threadSchema.index({ parentMessageId: 1 }, { unique: true });
threadSchema.index({ participantIds: 1 });
threadSchema.index({ lastActivity: -1 });

export const Thread = mongoose.model<Thread>("Thread", threadSchema);
