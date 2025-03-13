import mongoose, { Document, Schema } from "mongoose";

export interface DirectMessage extends Document {
  participantIds: mongoose.Types.ObjectId[];
  createdAt: Date;
  lastActivity: Date;
}

const directMessageSchema = new Schema<DirectMessage>(
  {
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
    this.participantIds.sort((a, b) => a.toString().localeCompare(b.toString()));
  }
  next();
});

export const DirectMessage = mongoose.model<DirectMessage>(
  "DirectMessage",
  directMessageSchema,
);
