import mongoose from "mongoose";
import { User as UserModel } from "../../models/user.model";

// Pick only the fields you need for authentication
export type User = Pick<
  UserModel,
  "_id" | "username" | "email" | "displayName" | "status" | "avatarUrl"
>;
