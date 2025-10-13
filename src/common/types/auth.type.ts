import { Request } from "express";
import { UserInterface } from "../../models";
export interface TenantContext {
  tenantId: string;
  userId: string;
  email: string;
  displayName?: string;
}
export interface AuthenticatedRequest extends Request {
  user?: UserInterface;
}

// Request with tenant context (for SSO/multi-tenant operations)
export interface TenantAuthenticatedRequest extends Request {
  user?: UserInterface;
  tenantContext?: TenantContext;
  tenantId?: string; // Also add tenantId directly for convenience
}

// Type guard to check if request has tenant context
export function hasTenantContext(
  req: Request,
): req is TenantAuthenticatedRequest {
  return "tenantContext" in req && req.tenantContext !== undefined;
}

// Type guard to check if request is authenticated
export function isAuthenticated(req: Request): req is AuthenticatedRequest {
  return "user" in req && req.user !== undefined;
}
