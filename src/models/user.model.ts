import mongoose, { Document, Schema } from "mongoose";
import bcrypt from "bcrypt";
import { tenantIsolationPlugin } from "../plugins/tenantPlugin";

export enum UserStatus {
  ONLINE = "online",
  OFFLINE = "offline",
  AWAY = "away",
  DO_NOT_DISTURB = "do_not_disturb",
}

export interface UserSettings {
  notifications: boolean;
  theme: string;
  messagePreview: boolean;
  soundEnabled: boolean;
}

export interface UserInterface extends Document {
  _id: mongoose.Types.ObjectId;
  email: string;
  username: string;
  passwordHash: string;
  displayName: string;
  avatarUrl?: string;
  createdAt: Date;
  lastSeen: Date;
  settings: UserSettings;
  status: UserStatus;
  // ===== NEW: TENANT ISOLATION =====
  tenantId: string; // Required for multi-tenancy, defaults to 'default'

  // ===== NEW: FEDERATED IDENTITY (Optional - only for SSO users) =====
  externalId?: string; // External system's user ID (e.g., WNP user/client ID)
  externalSystem?: string; // 'wnp', 'shopify', etc.

  // ===== NEW: FLAGS =====
  emailVerified: boolean; // Track email verification status
  isActive: boolean; // Soft delete / account suspension
  comparePassword(candidatePassword: string): Promise<boolean>;
}

const userSettingsSchema = new Schema<UserSettings>(
  {
    notifications: { type: Boolean, default: true },
    theme: { type: String, default: "light" },
    messagePreview: { type: Boolean, default: true },
    soundEnabled: { type: Boolean, default: true },
  },
  { _id: false },
);

const userSchema = new Schema<UserInterface>(
  {
    email: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
    },
    username: {
      type: String,
      required: true,
      trim: true,
      minLength: 3,
      maxLength: 30,
    },
    passwordHash: {
      type: String,
      required: function (this: UserInterface) {
        // only required if not a federated user
        return !this.externalId;
      },
    },
    displayName: { type: String, required: true },
    avatarUrl: { type: String, default: "https://github.com/shadcn.png" },
    createdAt: { type: Date, default: Date.now },
    lastSeen: { type: Date, default: Date.now },
    settings: { type: userSettingsSchema, default: () => ({}) },
    status: {
      type: String,
      enum: Object.values(UserStatus),
      default: UserStatus.OFFLINE,
    },

    tenantId: {
      type: String,
      required: true,
      index: true,
    },

    externalId: {
      type: String,
      sparse: true, // Allow multiple nulls
    },
    externalSystem: {
      type: String,
      sparse: true, // Allow multiple nulls
    },

    emailVerified: {
      type: Boolean,
      default: false,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
    toJSON: {
      transform: (_, user) => {
        delete user.passwordHash;
        return user;
      },
    },
    methods: {
      comparePassword(candidatePassword: string): Promise<boolean> {
        // for federated users without passwords always return false
        if (!this.passwordHash) {
          return Promise.resolve(false);
        }
        return bcrypt.compare(candidatePassword, this.passwordHash);
      },
    },
  },
);

// Add new tenant-scoped indexes (will be primary after migration)
userSchema.index(
  { tenantId: 1, email: 1 },
  { unique: true, name: "tenant_email_unique" },
);
userSchema.index(
  { tenantId: 1, username: 1 },
  { unique: true, name: "tenant_username_unique" },
);
userSchema.index(
  { tenantId: 1, externalId: 1, externalSystem: 1 },
  {
    unique: true,
    sparse: true,
    name: "tenant_external_id_unique",
  },
);

// Performance Index
userSchema.index({ tenantId: 1, isActive: 1 });
userSchema.index({ tenantId: 1, status: 1 });

userSchema.pre("save", async function hashPassword(next) {
  if (!this.passwordHash) return next();
  if (!this.isModified("passwordHash")) return next();

  try {
    const salt = await bcrypt.genSalt(10);
    this.passwordHash = await bcrypt.hash(this.passwordHash, salt);
    next();
  } catch (error) {
    if (error instanceof Error) {
      next(error);
    }
  }
});

userSchema.plugin(tenantIsolationPlugin);
export const User = mongoose.model<UserInterface>("User", userSchema);
