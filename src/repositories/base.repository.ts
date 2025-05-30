/* eslint-disable @typescript-eslint/no-explicit-any */
import { Document, Model } from "mongoose";

export abstract class BaseRepository<T extends Document> {
  constructor(protected readonly model: Model<T>) {}
  async findById(id: string): Promise<T | null> {
    return this.model.findById(id);
  }

  async findOne(filter: any): Promise<T | null> {
    return this.model.findOne(filter);
  }

  async find(filter: any): Promise<T[]> {
    return this.model.find(filter);
  }

  async create(data: any): Promise<T> {
    const entity = new this.model(data);
    return entity.save();
  }

  async update(id: string, data: any): Promise<T | null> {
    return this.model.findByIdAndUpdate(id, data, {
      new: true,
      runValidators: true,
    });
  }

  async delete(id: string): Promise<T | null> {
    return this.model.findByIdAndDelete(id);
  }
  async aggregate(pipeline: any[]): Promise<any[]> {
    return this.model.aggregate(pipeline);
  }
  async findWithPopulate(
    query: any,
    options: {
      sort?: any;
      limit?: number;
      populate?: any[];
    } = {},
  ): Promise<any[]> {
    const { sort, limit, populate } = options;

    let findQuery = this.model.find(query);

    if (sort) {
      findQuery = findQuery.sort(sort);
    }

    if (limit) {
      findQuery = findQuery.limit(limit);
    }

    if (populate) {
      findQuery = findQuery.populate(populate);
    }

    return findQuery.lean();
  }

  // Protected method for direct model access (use sparingly)
  protected getModel(): Model<T> {
    return this.model;
  }
}
