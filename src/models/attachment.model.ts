import mongoose, { Document, Schema } from "mongoose";

export interface S3Metadata {
  bucket: string;
  key: string;
  region?: string;
  contentType: string;
  eTag?: string;
  encrypted: boolean;
}

export interface ThumbnailMetadata {
  s3Key: string;
  url: string; // CDN URL
  width: number;
  height: number;
}

export interface CompressionMetadata {
  algorithm: "webp" | "h264" | "none";
  quality: number;
  compressionRatio: number;
}

export interface AttachmentMetadata {
  width?: number;
  height?: number;
  duration?: number;

  s3: S3Metadata;

  thumbnail?: ThumbnailMetadata;

  compression?: CompressionMetadata;
}

export interface AttachmentInterface extends Document {
  _id: mongoose.Types.ObjectId;
  name: string;
  url: string; // CDN URL
  type: string; // MIME type
  size: number; // Original size
  compressedSize?: number;
  uploadedBy: mongoose.Types.ObjectId;
  uploadedAt: Date;
  status: "uploading" | "processing" | "ready" | "failed";
  metadata: AttachmentMetadata;
}

const s3MetadataSchema = new Schema<S3Metadata>(
  {
    bucket: { type: String, required: true },
    key: { type: String, required: true },
    region: { type: String, default: "us-east-1" },
    contentType: { type: String, required: true },
    eTag: String,
    encrypted: { type: Boolean, default: false },
  },
  { _id: false },
);

const thumbnailMetadataSchema = new Schema<ThumbnailMetadata>(
  {
    s3Key: { type: String, required: true },
    url: { type: String, required: true },
    width: { type: Number, required: true },
    height: { type: Number, required: true },
  },
  { _id: false },
);

const compressionMetadataSchema = new Schema<CompressionMetadata>(
  {
    algorithm: {
      type: String,
      enum: ["webp", "h264", "none"],
      required: true,
    },
    quality: { type: Number, min: 1, max: 100, required: true },
    compressionRatio: { type: Number, min: 0, max: 1, required: true },
  },
  { _id: false },
);

const attachmentMetadataSchema = new Schema<AttachmentMetadata>(
  {
    width: Number,
    height: Number,
    duration: Number,
    s3: {
      type: s3MetadataSchema,
      required: true,
    },
    thumbnail: thumbnailMetadataSchema,
    compression: compressionMetadataSchema,
  },
  { _id: false },
);

const attachmentSchema = new Schema<AttachmentInterface>(
  {
    name: {
      type: String,
      required: true,
    },
    url: {
      type: String,
      required: true,
    },
    type: {
      type: String,
      required: true,
    },
    size: {
      type: Number,
      required: true,
    },
    compressedSize: Number,
    uploadedBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    uploadedAt: {
      type: Date,
      default: Date.now,
    },
    status: {
      type: String,
      enum: ["uploading", "processing", "ready", "failed"],
      default: "uploading",
    },
    metadata: {
      type: attachmentMetadataSchema,
      required: true,
    },
  },
  {
    timestamps: true,
  },
);

// Indexes for performance
attachmentSchema.index({ uploadedBy: 1 });
attachmentSchema.index({ status: 1 });
attachmentSchema.index({ type: 1 });
attachmentSchema.index({ "metadata.s3.key": 1 }, { unique: true });
attachmentSchema.index({ "metadata.s3.encrypted": 1 });
attachmentSchema.index({ uploadedAt: -1 });

export const Attachment = mongoose.model<AttachmentInterface>(
  "Attachment",
  attachmentSchema,
);
