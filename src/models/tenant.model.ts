import mongoose, { Schema, Document } from "mongoose";

export interface ITenant extends Document {
  tenantId: string;
  name: string;
  domain: string;
  allowedOrigins: string[];
  sharedSecret: string;
  status:
    | "pending_registration"
    | "pending_verification"
    | "verified"
    | "suspended";
  registrationToken?: string;
  registrationExpiry?: Date;
  settings: {
    maxUsers?: number;
    features?: string[];
    customBranding?: {
      logo?: string;
      primaryColor?: string;
      accentColor?: string;
    };
  };
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}
const TenantSchema = new Schema<ITenant>(
  {
    tenantId: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      index: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    domain: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
    },
    allowedOrigins: {
      type: [String],
      required: true,
      default: [],
    },
    sharedSecret: {
      type: String,
      required: true,
      select: false, // Don't return in queries by default
    },
    status: {
      type: String,
      enum: [
        "pending_registration",
        "pending_verification",
        "verified",
        "suspended",
      ], // UPDATED
      default: "pending_registration",
    },
    registrationToken: {
      type: String,
      select: false,
    },
    registrationExpiry: {
      type: Date,
      select: false,
    },
    settings: {
      maxUsers: { type: Number, default: 1000 },
      features: { type: [String], default: [] },
      customBranding: {
        logo: String,
        primaryColor: String,
        accentColor: String,
      },
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
  },
);

// Indexes for performance
TenantSchema.index({ domain: 1 });
TenantSchema.index({ status: 1 });
TenantSchema.index({ isActive: 1 });

export const Tenant = mongoose.model<ITenant>("Tenant", TenantSchema);
