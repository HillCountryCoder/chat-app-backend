import { Schema, model, Document, Types } from "mongoose";
import { tenantIsolationPlugin } from "../plugins/tenantPlugin";

export interface RefreshTokenInterface extends Document {
  tenantId: string; // For multi-tenancy support
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
    tenantId: { type: String, required: true, index: true },
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
refreshTokenSchema.index({ userId: 1, expiresAt: 1 }); // For active sessions query
refreshTokenSchema.index({ userId: 1, userAgent: 1, ipAddress: 1 }); // For device detection
refreshTokenSchema.index({ userId: 1, lastUsed: -1 }); // For sorting by most recent
refreshTokenSchema.index({ expiresAt: 1 }); // For cleanup operations
refreshTokenSchema.index({
  userId: 1,
  userAgent: 1,
  ipAddress: 1,
  expiresAt: 1,
});

// Indexes for multi-tenancy if needed in future
refreshTokenSchema.index(
  { tenantId: 1, userId: 1, createdAt: -1 },
  { name: "tenant_user_createdAt_idx" },
);
refreshTokenSchema.index(
  { tenantId: 1, userId: 1, expiresAt: 1 },
  { name: "tenant_user_expiresAt_idx" },
);
refreshTokenSchema.index(
  { tenantId: 1, userId: 1, userAgent: 1, ipAddress: 1 },
  { name: "tenant_user_device_idx" },
);
refreshTokenSchema.index(
  { tenantId: 1, userId: 1, lastUsed: -1 },
  { name: "tenant_user_lastUsed_idx" },
);
refreshTokenSchema.index(
  { tenantId: 1, expiresAt: 1 },
  { name: "tenant_expiresAt_idx" },
);
refreshTokenSchema.index(
  { tenantId: 1, userId: 1, userAgent: 1, ipAddress: 1, expiresAt: 1 },
  { name: "tenant_user_device_expiresAt_idx" },
);

refreshTokenSchema.index(
  { token: 1, tenantId: 1 },
  { name: "token_tenant_idx" },
);

// Plugin for tenant isolation if needed in future
refreshTokenSchema.plugin(tenantIsolationPlugin);
export const RefreshToken = model<RefreshTokenInterface>(
  "RefreshToken",
  refreshTokenSchema,
);
