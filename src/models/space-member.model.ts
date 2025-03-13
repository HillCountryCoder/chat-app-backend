import mongoose, { Document, Schema } from "mongoose";

export enum SpaceMemberRole {
  ADMIN = "admin",
  MODERATOR = "moderator",
  MEMBER = "member",
  GUEST = "guest",
}

export enum SpaceMemberStatus {
  ACTIVE = "active",
  INVITED = "invited",
  BANNED = "banned",
}

export interface SpaceMemeber extends Document {
  spaceId: mongoose.Types.ObjectId;
  userId: mongoose.Types.ObjectId;
  roles: SpaceMemberRole[];
  joinedAt: Date;
  status: SpaceMemberStatus;
}

const spaceMemberSchema = new Schema<SpaceMemeber>(
  {
    spaceId: {
      type: Schema.Types.ObjectId,
      ref: "Space",
      required: true,
    },
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    roles: [
      {
        type: String,
        enum: Object.values(SpaceMemberRole),
        default: [SpaceMemberRole.MEMBER],
      },
    ],
    joinedAt: { type: Date, default: Date.now },
    status: {
      type: String,
      enum: Object.values(SpaceMemberStatus),
      default: SpaceMemberStatus.ACTIVE,
    },
  },
  {
    timestamps: true,
  },
);

// compound index so a user can only be memeber of space once
spaceMemberSchema.index({ spaceId: 1, userId: 1 }, { unique: true });

spaceMemberSchema.index({ spaceId: 1 });
spaceMemberSchema.index({ userId: 1 });
spaceMemberSchema.index({ status: 1 });

export const SpaceMember = mongoose.model<SpaceMemeber>(
  "SpaceMember",
  spaceMemberSchema,
);
