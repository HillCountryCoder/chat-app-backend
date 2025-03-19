import mongoose, { Document, Schema } from "mongoose";
import bcrypt from "bcrypt";

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
  email: string;
  username: string;
  passwordHash: string;
  displayName: string;
  avatarUrl?: string;
  createdAt: Date;
  lastSeen: Date;
  settings: UserSettings;
  status: UserStatus;
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
    passwordHash: { type: String, required: true },
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
        return bcrypt.compare(candidatePassword, this.passwordHash);
      },
    },
  },
);

userSchema.index({ email: 1 });
userSchema.index({ username: 1 });

userSchema.pre("save", async function hashPassword(next) {
  if (!this.isModified("passwordHash")) return next();

  try {
    const salt = await bcrypt.genSalt(10);
    this.passwordHash = await bcrypt.hash(this.passwordHash, salt);
    next();
  } catch (error: any) {
    next(error);
  }
});

export const User = mongoose.model<UserInterface>("User", userSchema);
