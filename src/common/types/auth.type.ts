import { Request } from "express";
import { UserInterface as User } from "../../models";

export interface AuthenticatedRequest extends Request {
  user?: User;
}
