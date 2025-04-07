import mongoose, { Document, Schema } from "mongoose";

export interface DirectMessageInterface extends Document {
  _id: mongoose.Types.ObjectId;
  participantIds: mongoose.Types.ObjectId[];
  createdAt: Date;
  lastActivity: Date;
}

const directMessageSchema = new Schema<DirectMessageInterface>(
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
    this.participantIds.sort((a, b) =>
      a.toString().localeCompare(b.toString()),
    );
  }
  next();
});

export const DirectMessage = mongoose.model<DirectMessageInterface>(
  "DirectMessage",
  directMessageSchema,
);
