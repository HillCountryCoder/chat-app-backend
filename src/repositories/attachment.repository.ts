import {
  AttachmentInterface,
  Attachment,
  AttachmentMetadata,
} from "../models";
import { BaseRepository } from "./base.repository";

export class AttachmentRepository extends BaseRepository<AttachmentInterface> {
  private static instance: AttachmentRepository;

  private constructor() {
    super(Attachment);
  }

  static getInstance(): AttachmentRepository {
    if (!AttachmentRepository.instance) {
      AttachmentRepository.instance = new AttachmentRepository();
    }

    return AttachmentRepository.instance;
  }

  async findByS3Key(s3Key: string): Promise<AttachmentInterface | null> {
    return this.findOne({ "metadata.s3.key": s3Key });
  }
  async findByUploader(userId: string): Promise<AttachmentInterface[]> {
    return await this.model
      .find({ uploadedBy: userId })
      .sort({ uploadedAt: -1 });
  }

  async findByStatus(status: string): Promise<AttachmentInterface[]> {
    return this.find({ status });
  }

  async updateStatus(
    s3Key: string,
    status: "uploading" | "processing" | "ready" | "failed",
    metadata?: AttachmentMetadata,
  ): Promise<AttachmentInterface | null> {
    const updateData: any = { status };

    if (metadata) {
      updateData["$set"] = {
        "metadata.thumbnail": metadata.thumbnail,
        "metadata.compression": metadata.compression,
      };
    }

    return this.model.findOneAndUpdate(
      { "metadata.s3.key": s3Key },
      updateData,
      { new: true },
    );
  }

  async getTotalSizeByUser(userId: string): Promise<number> {
    const result = await this.model.aggregate([
      { $match: { uploadedBy: userId, status: "ready" } },
      { $group: { _id: null, totalSize: { $sum: "$size" } } },
    ]);

    return result.length > 0 ? result[0].totalSize : 0;
  }

  async findReadyAttachments(
    attachmentIds: string[],
  ): Promise<AttachmentInterface[]> {
    return this.find({
      _id: { $in: attachmentIds },
      status: "ready",
    });
  }
}

export const attachmentRepository = AttachmentRepository.getInstance();
