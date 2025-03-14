import { Request } from "express";
import { User } from "./user.types";

export interface AuthenticatedRequest extends Request {
  user?: User;
}
