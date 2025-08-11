import { z } from "zod";

// Edit time limit in milliseconds (1 hour)
export const EDIT_TIME_LIMIT = 60 * 60 * 1000;

export const validateEditTimeLimit = (messageCreatedAt: Date): boolean => {
  const now = new Date();
  const timeDiff = now.getTime() - messageCreatedAt.getTime();
  return timeDiff <= EDIT_TIME_LIMIT;
};

export const editMessageSchema = z.object({
  content: z.string().min(1).max(2000),
  richContent: z.any().optional(),
  contentType: z.string().optional(),
});
