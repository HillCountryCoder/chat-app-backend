// Pick only the fields you need for authentication
export type UserFromToken = {
  _id: unknown;
  username: string;
  email: string;
  tenantId: string;
};
