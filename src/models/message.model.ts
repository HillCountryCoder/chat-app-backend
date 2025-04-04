import mongoose, { Document, Schema } from "mongoose";

export enum ContentType {
  TEXT = "text",
  IMAGE = "image",
  FILE = "file",
  CODE = "code",
  SYSTEM = "system",
}

export interface Mention {
  userId: mongoose.Types.ObjectId;
  username: string;
}

export interface Reaction {
  emoji: string;
  count: number;
  users: mongoose.Types.ObjectId[];
}

export interface MessageInterface extends Document {
  messageId: string;
  senderId: mongoose.Types.ObjectId;
  channelId?: mongoose.Types.ObjectId;
  directMessageId?: mongoose.Types.ObjectId;
  content: string;
  contentType: ContentType;
  mentions: Mention;
  reactions: Reaction[];
  attachments: mongoose.Types.ObjectId[];
  createdAt: Date;
  editedAt?: Date;
  isEdited: boolean;
  isPinned: boolean;
}

const mentionSchema = new Schema<Mention>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    username: { type: String, required: true },
  },
  { _id: false },
);

const reactionSchema = new Schema<Reaction>(
  {
    emoji: { type: String, required: true },
    count: { type: Number, default: 0 },
    users: [
      {
        type: Schema.Types.ObjectId,
        ref: "User",
      },
    ],
  },
  { _id: false },
);

const messageSchema = new Schema<MessageInterface>(
  {
    messageId: {
      type: String,
      required: true,
    },
    senderId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    channelId: {
      type: Schema.Types.ObjectId,
      ref: "Channel",
    },
    directMessageId: {
      type: Schema.Types.ObjectId,
      ref: "DirectMessage",
    },
    content: { type: String, required: true },
    contentType: {
      type: String,
      enum: Object.values(ContentType),
      default: ContentType.TEXT,
    },
    mentions: [mentionSchema],
    reactions: [reactionSchema],
    attachments: [
      {
        type: Schema.Types.ObjectId,
        ref: "Attachment",
      },
    ],
    createdAt: { type: Date, default: Date.now },
    editedAt: { type: Date },
    isEdited: { type: Boolean, default: false },
    isPinned: { type: Boolean, default: false },
  },
  {
    timestamps: true,
  },
);

messageSchema.pre("validate", function (next) {
  if (
    (this.channelId && this.directMessageId) ||
    (!this.channelId && !this.directMessageId)
  ) {
    next(
      new Error(
        "Message must belong to either a channel or a direct message, but not both or none",
      ),
    );
  } else {
    next();
  }
});

messageSchema.index({ messageId: 1 });
messageSchema.index({ senderId: 1 });
messageSchema.index({ channelId: 1, createdAt: -1 });
messageSchema.index({ directMessageId: 1, createdAt: -1 });
messageSchema.index({ "mentions.userId": 1 });
messageSchema.index({ isPinned: 1 });

export const Message = mongoose.model<MessageInterface>(
  "Message",
  messageSchema,
);
