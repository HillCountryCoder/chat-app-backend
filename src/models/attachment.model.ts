import mongoose, { Document, Schema } from "mongoose";

export interface S3Metadata {
  bucket: string;
  key: string;
  region?: string;
  isPublic: boolean;
  contentType: string;
  eTag?: string;
}

export interface AttachmentMetadata {
  width?: number;
  height?: number;
  duration?: number;
  thumbnailUrl?: string;
  s3: S3Metadata;
}

export interface Attachment extends Document {
  name: string;
  url: string;
  type: string;
  size: number;
  uploadedBy: mongoose.Types.ObjectId;
  uploadedAt: Date;
  metadata: AttachmentMetadata;
}

const s3MetadataSchema = new Schema<S3Metadata>(
  {
    bucket: { type: String, required: true },
    key: { type: String, required: true },
    region: String,
    isPublic: { type: Boolean, default: true },
    contentType: { type: String, required: true },
    eTag: String,
  },
  {
    _id: false,
  },
);

const attachmentMetadataSchema = new Schema<AttachmentMetadata>(
  {
    width: Number,
    height: Number,
    duration: Number,
    thumbnailUrl: String,
    s3: {
      type: s3MetadataSchema,
      required: true,
    },
  },
  {
    _id: false,
  },
);

const attachmentSchema = new Schema<Attachment>(
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
    uploadedBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    uploadedAt: { type: Date, default: Date.now },
    metadata: {
      type: attachmentMetadataSchema,
      required: true,
    },
  },
  {
    timestamps: true,
  },
);

attachmentSchema.index({ uploadedBy: 1 });
attachmentSchema.index({ type: 1 });
attachmentSchema.index({ "metadata.s3.isPublic": 1 });
attachmentSchema.index({ "metadata.s3.key": 1 });

export const Attachment = mongoose.model<Attachment>(
  "Attachment",
  attachmentSchema,
);
