import { Request } from "express";
import { UserInterface } from "../../models";

export interface AuthenticatedRequest extends Request {
  user?: UserInterface;
}
