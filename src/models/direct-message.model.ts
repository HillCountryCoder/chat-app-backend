import mongoose, { Document, Schema } from "mongoose";
import { tenantIsolationPlugin } from "../plugins/tenantPlugin";

export interface DirectMessageInterface extends Document {
  _id: mongoose.Types.ObjectId;
  tenantId: string;
  participantIds: mongoose.Types.ObjectId[];
  createdAt: Date;
  lastActivity: Date;
}

const directMessageSchema = new Schema<DirectMessageInterface>(
  {
    tenantId: {
      type: String,
      required: true,
      default: "default",
    },
    participantIds: [
      {
        type: Schema.Types.ObjectId,
        ref: "User",
        required: true,
      },
    ],
    createdAt: { type: Date, default: Date.now },
    lastActivity: { type: Date, default: Date.now },
  },
  {
    timestamps: true,
  },
);

directMessageSchema.index({ participantIds: 1 });
directMessageSchema.index({ lastActivity: -1 }); // arragne in descending order

directMessageSchema.pre("save", function (next) {
  if (this.isModified("participantIds")) {
    this.participantIds.sort((a, b) =>
      a.toString().localeCompare(b.toString()),
    );
  }
  next();
});

// New Indexes for multi-tenancy
directMessageSchema.index(
  { tenantId: 1, participantIds: 1 },
  { name: "tenant_participants_idx" },
);
directMessageSchema.index(
  { tenantId: 1, lastActivity: -1 },
  { name: "tenant_lastActivity_idx" },
);

directMessageSchema.plugin(tenantIsolationPlugin);

export const DirectMessage = mongoose.model<DirectMessageInterface>(
  "DirectMessage",
  directMessageSchema,
);
