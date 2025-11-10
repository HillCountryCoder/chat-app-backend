export interface SocketAuthenticatedEvent {
  success: boolean;
  accessToken: string;
  refreshToken: string;
  user: {
    _id: string;
    username: string;
    email: string;
    displayName: string;
    avatarUrl?: string;
    status: string;
  };
}

export interface SocketAuthErrorEvent {
  success: false;
  error: string;
  code?: string;
}