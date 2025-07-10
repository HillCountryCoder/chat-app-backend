import mongoose, { Schema, Document } from "mongoose";

export interface IPresenceHistory extends Document {
  _id: mongoose.Types.ObjectId;
  userId: string;
  status: "online" | "offline" | "away" | "busy";
  sessionStart: Date;
  sessionEnd?: Date;
  duration?: number;
  deviceInfo: {
    type: "web" | "mobile" | "desktop";
    userAgent?: string;
    ip?: string;
    socketId?: string;
  };
  createdAt: Date;
  updatedAt: Date;
}
const PresenceHistorySchema = new Schema<IPresenceHistory>(
  {
    userId: {
      type: String,
      required: true,
      index: true,
    },
    status: {
      type: String,
      enum: ["online", "offline", "away", "busy"],
      required: true,
    },
    sessionStart: {
      type: Date,
      required: true,
    },
    sessionEnd: {
      type: Date,
    },
    duration: {
      type: Number,
    },
    deviceInfo: {
      type: {
        type: String,
        enum: ["web", "mobile", "desktop"],
        required: true,
      },
      userAgent: String,
      ip: String,
      socketId: String,
    },
  },
  {
    timestamps: true,
  },
);

// Compound index for efficient queries
PresenceHistorySchema.index({ userId: 1, sessionStart: -1 });
PresenceHistorySchema.index({ createdAt: -1 });
PresenceHistorySchema.index({ sessionStart: -1, sessionEnd: -1 });

// Index for finding active sessions
PresenceHistorySchema.index({ sessionEnd: 1 }, { sparse: true });

export const PresenceHistory = mongoose.model<IPresenceHistory>(
  "PresenceHistory",
  PresenceHistorySchema,
);
