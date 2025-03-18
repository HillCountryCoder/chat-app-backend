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
}

export const userRepository = UserRepository.getInstance();
