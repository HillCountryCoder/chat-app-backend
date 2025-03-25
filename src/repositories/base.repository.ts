import mongoose, { Document, Model } from "mongoose";

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
}
