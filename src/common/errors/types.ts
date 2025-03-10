export interface ErrorResponse {
  status: number;
  code: string;
  message: string;
  details?: unknown;
}

export interface ErrorDetails {
  [key: string]: unknown;
}

export interface RequestContext {
  method: string;
  path: string;
  ip?: string;
  userAgent?: string;
  userId?: string;
  socketId?: string;
}
