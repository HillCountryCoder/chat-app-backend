// src/presence/models/user-connection.model.ts - UPDATED SIMPLIFIED VERSION
import mongoose, { Schema, Document } from "mongoose";
import { CONNECTION_TYPE } from "../constants";

export interface IUserConnection extends Document {
  userId: string;
  connectionId: string;
  connectionType:
    | CONNECTION_TYPE.DIRECT_MESSAGE
    | CONNECTION_TYPE.CHANNEL_MEMBER;
  channelId?: string;
  directMessageId?: string;
  createdAt: Date;
  updatedAt: Date;
}

const UserConnectionSchema = new Schema<IUserConnection>(
  {
    userId: {
      type: String,
      required: true,
      index: true,
    },
    connectionId: {
      type: String,
      required: true,
      index: true,
    },
    connectionType: {
      type: String,
      enum: ["direct_message", "channel_member"],
      required: true,
    },
    channelId: {
      type: String,
      index: true,
      required: function (this: IUserConnection) {
        return this.connectionType === "channel_member";
      },
    },
    directMessageId: {
      type: String,
      index: true,
      required: function (this: IUserConnection) {
        return this.connectionType === "direct_message";
      },
    },
  },
  {
    timestamps: true,
  },
);

// Compound indexes for efficient presence queries
UserConnectionSchema.index({ userId: 1, connectionType: 1 });
UserConnectionSchema.index({ connectionId: 1, connectionType: 1 });
UserConnectionSchema.index({ channelId: 1 }, { sparse: true });
UserConnectionSchema.index({ directMessageId: 1 }, { sparse: true });

// Ensure unique connections per context
UserConnectionSchema.index(
  { userId: 1, connectionId: 1, connectionType: 1, channelId: 1 },
  { unique: true, sparse: true, name: "unique_channel_connection" },
);

UserConnectionSchema.index(
  { userId: 1, connectionId: 1, connectionType: 1, directMessageId: 1 },
  { unique: true, sparse: true, name: "unique_dm_connection" },
);

// Validation to ensure contextId is provided based on type
UserConnectionSchema.pre("save", function (next) {
  if (this.connectionType === "channel_member" && !this.channelId) {
    next(new Error("channelId is required for channel_member connections"));
  } else if (
    this.connectionType === "direct_message" &&
    !this.directMessageId
  ) {
    next(
      new Error("directMessageId is required for direct_message connections"),
    );
  } else {
    next();
  }
});

export const UserConnection = mongoose.model<IUserConnection>(
  "UserConnection",
  UserConnectionSchema,
);
