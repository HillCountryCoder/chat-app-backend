import { Request } from "express";
import { UserInterface } from "../../models";
import mongoose from "mongoose";

export interface AuthenticatedRequest extends Request {
  user?: UserInterface;
}
