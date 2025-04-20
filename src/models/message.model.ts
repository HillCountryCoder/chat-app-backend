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
  _id: mongoose.Types.ObjectId;
  messageId: string;
  senderId: mongoose.Types.ObjectId;
  channelId?: mongoose.Types.ObjectId;
  directMessageId?: mongoose.Types.ObjectId;
  threadId?: mongoose.Types.ObjectId; // ID of the thread if this message is part of a thread
  isThreadStarter?: boolean; // Indicates if this message started a thread
  content: string;
  contentType: ContentType;
  mentions: Mention[];
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
    threadId: {
      type: Schema.Types.ObjectId,
      ref: "Thread",
    },
    isThreadStarter: {
      type: Boolean,
      default: false,
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
  const hasChannel = !!this.channelId;
  const hasDirect = !!this.directMessageId;
  const hasThread = !!this.threadId;

  // A message can be in ONE of the following:
  // 1. A channel (main channel message)
  // 2. A direct message
  // 3. A thread (which is associated with a channel via the Thread model)

  // Exactly one of these must be defined
  const validContextCount = [hasChannel, hasDirect, hasThread].filter(
    Boolean,
  ).length;

  if (validContextCount !== 1) {
    next(
      new Error(
        "Message must belong to exactly one of: channel, direct message, or thread",
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
messageSchema.index({ threadId: 1, createdAt: -1 });
messageSchema.index({ isThreadStarter: 1 });
messageSchema.index({ "mentions.userId": 1 });
messageSchema.index({ isPinned: 1 });

export const Message = mongoose.model<MessageInterface>(
  "Message",
  messageSchema,
);
