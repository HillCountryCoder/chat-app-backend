// models/message.model.ts (Updated with Rich Content Support)
import mongoose, { Document, Schema } from "mongoose";

export enum ContentType {
  TEXT = "text",
  IMAGE = "image",
  FILE = "file",
  CODE = "code",
  SYSTEM = "system",
  RICH = "rich", // Add new rich content type
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
  threadId?: mongoose.Types.ObjectId;
  isThreadStarter?: boolean;
  content: string;
  richContent?: any; // Store Plate.js Value object
  contentType: ContentType;
  mentions: Mention[];
  reactions: Reaction[];
  attachments: mongoose.Types.ObjectId[];
  replyToId?: mongoose.Types.ObjectId;
  hasMedia: boolean;
  totalAttachmentSize?: number;
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
    // Add rich content field - stores Plate.js Value as flexible object
    richContent: { 
      type: Schema.Types.Mixed,
      validate: {
        validator: function(value: any) {
          // Only validate if richContent is provided
          if (value === null || value === undefined) return true;
          
          // Must be an array (Plate.js Value format)
          if (!Array.isArray(value)) return false;
          
          // Each item should be a node with children
          return value.every(node => 
            typeof node === 'object' && 
            node !== null && 
            Array.isArray(node.children)
          );
        },
        message: 'Rich content must be a valid Plate.js Value format'
      }
    },
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
    hasMedia: {
      type: Boolean,
      default: false,
      index: true,
    },
    totalAttachmentSize: {
      type: Number,
      min: 0,
    },
    replyToId: {
      type: Schema.Types.ObjectId,
      ref: "Message",
    },
    createdAt: { type: Date, default: Date.now },
    editedAt: { type: Date },
    isEdited: { type: Boolean, default: false },
    isPinned: { type: Boolean, default: false },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  },
);

// Virtual for replyTo
messageSchema.virtual("replyTo", {
  ref: "Message",
  localField: "replyToId",
  foreignField: "_id",
  justOne: true,
});

// Pre-hook to populate replyTo virtual
messageSchema.pre(["find", "findOne", "findOneAndUpdate"], function () {
  this.populate({
    path: "replyTo",
    select: "content richContent contentType senderId",
    populate: {
      path: "senderId",
      select: "displayName username",
    },
  });
});

// Pre-save hook to ensure data consistency
messageSchema.pre("save", function (next) {
  // Set hasMedia based on attachments
  this.hasMedia = this.attachments && this.attachments.length > 0;
  
  if (this.hasMedia) {
    this.totalAttachmentSize = undefined;
  }

  // Ensure content type consistency
  if (this.richContent && this.contentType !== ContentType.RICH) {
    this.contentType = ContentType.RICH;
  }

  // If no rich content but content type is rich, reset to text
  if (!this.richContent && this.contentType === ContentType.RICH) {
    this.contentType = ContentType.TEXT;
  }

  next();
});

messageSchema.pre("validate", function (next) {
  const hasChannel = !!this.channelId;
  const hasDirect = !!this.directMessageId;
  const hasThread = !!this.threadId;

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

// Indexes for performance
messageSchema.index({ messageId: 1 });
messageSchema.index({ senderId: 1 });
messageSchema.index({ channelId: 1, createdAt: -1 });
messageSchema.index({ directMessageId: 1, createdAt: -1 });
messageSchema.index({ threadId: 1, createdAt: -1 });
messageSchema.index({ isThreadStarter: 1 });
messageSchema.index({ "mentions.userId": 1 });
messageSchema.index({ isPinned: 1 });
messageSchema.index({ replyToId: 1 });
messageSchema.index({ hasMedia: 1, createdAt: -1 });
messageSchema.index({ channelId: 1, hasMedia: 1, createdAt: -1 });
messageSchema.index({ directMessageId: 1, hasMedia: 1, createdAt: -1 });
messageSchema.index({ contentType: 1 }); // Index for content type queries

export const Message = mongoose.model<MessageInterface>(
  "Message",
  messageSchema,
);