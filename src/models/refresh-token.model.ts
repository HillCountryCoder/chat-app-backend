import { Schema, model, Document, Types } from "mongoose";

export interface RefreshTokenInterface extends Document {
  token: string;
  userId: Types.ObjectId;
  deviceInfo?: string;
  ipAddress?: string;
  userAgent?: string;
  rememberMe: boolean;
  expiresAt: Date;
  createdAt: Date;
  lastUsed?: Date;
}

const refreshTokenSchema = new Schema<RefreshTokenInterface>(
  {
    token: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    deviceInfo: {
      type: String,
      maxlength: 500,
    },
    ipAddress: {
      type: String,
      maxlength: 45, // IPv6 max length
    },
    userAgent: {
      type: String,
      maxlength: 1000,
    },
    expiresAt: {
      type: Date,
      required: true,
      index: { expireAfterSeconds: 0 }, // MongoDB TTL index
    },
    rememberMe: {
      type: Boolean,
      default: false,
    },
    lastUsed: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
  },
);

refreshTokenSchema.index({ userId: 1, createdAt: -1 });

export const RefreshToken = model<RefreshTokenInterface>(
  "RefreshToken",
  refreshTokenSchema,
);
