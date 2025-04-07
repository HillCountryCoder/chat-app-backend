import { UserInterface as User, User as UserModel } from "../models";
import { BaseRepository } from "./base.repository";

export class UserRepository extends BaseRepository<User> {
  private static instance: UserRepository;

  private constructor() {
    super(UserModel);
  }

  static getInstance(): UserRepository {
    if (!UserRepository.instance) {
      UserRepository.instance = new UserRepository();
    }
    return UserRepository.instance;
  }

  async findByEmail(email: string): Promise<User | null> {
    return this.findOne({ email });
  }

  async findByUsername(username: string): Promise<User | null> {
    return this.findOne({ username });
  }

  async findByEmailOrUsername(emailOrUsername: string): Promise<User | null> {
    return this.findOne({
      $or: [{ email: emailOrUsername }, { username: emailOrUsername }],
    });
  }

  async findAllUsers(options: {
    search?: string;
    limit?: number;
    skip?: number;
    excludeId?: string;
  }): Promise<User[]> {
    const { search, limit = 50, skip = 0, excludeId } = options;
    let query: any = {};

    if (search) {
      query = {
        $or: [
          { displayName: { $regex: search, $options: "i" } },
          { username: { $regex: search, $options: "i" } },
          { email: { $regex: search, $options: "i" } },
        ],
      };
    }
    if (excludeId) {
      query._id = { $ne: excludeId };
    }
    return this.model
      .find(query)
      .select("-passwordHash") // Exclude password hash
      .sort({ displayName: 1 })
      .limit(limit)
      .skip(skip);
  }
  async countUsers(
    options: {
      search?: string;
      excludeId?: string;
    } = {},
  ): Promise<number> {
    const { search, excludeId } = options;

    let query: any = {};

    if (search) {
      query = {
        $or: [
          { displayName: { $regex: search, $options: "i" } },
          { username: { $regex: search, $options: "i" } },
          { email: { $regex: search, $options: "i" } },
        ],
      };
    }

    if (excludeId) {
      query._id = { $ne: excludeId };
    }

    return this.model.countDocuments(query);
  }
}

export const userRepository = UserRepository.getInstance();
