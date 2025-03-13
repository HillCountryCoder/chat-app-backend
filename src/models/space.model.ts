import mongoose, { Document, Schema } from "mongoose";

export enum SpaceVisibility {
  PUBLIC = "public",
  PRIVATE = "private",
}

export enum SpaceType {
  TEAM = "team",
  PROJECT = "project",
  SOCIAL = "social",
}

export interface Space extends Document {
  name: string;
  description?: string;
  creatorId: mongoose.Types.ObjectId;
  avatarUrl?: string;
  createdAt: Date;
  visibility: SpaceVisibility;
  type: SpaceType;
}

const spaceSchema = new Schema<Space>(
  {
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
    avatarUrl: String,
    createdAt: { type: Date, default: Date.now },
    visibility: {
      type: String,
      enum: Object.values(SpaceVisibility),
      default: SpaceVisibility.PRIVATE,
    },
    type: {
      type: String,
      enum: Object.values(SpaceType),
      default: SpaceType.TEAM,
    },
  },
  {
    timestamps: true,
  },
);

spaceSchema.index({ creatorId: 1 });
spaceSchema.index({ visibility: 1 });
spaceSchema.index({ type: 1 });

export const Space = mongoose.model<Space>("Space", spaceSchema);
