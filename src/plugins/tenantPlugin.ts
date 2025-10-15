/* eslint-disable @typescript-eslint/no-explicit-any */
import { Schema, Query } from "mongoose";
import { AsyncLocalStorage } from "async_hooks";

// Context storage for tenant ID
export const tenantContext = new AsyncLocalStorage<{ tenantId: string }>();

/**
 * Mongoose plugin to automatically enforce tenant isolation
 *
 * This plugin:
 * 1. Auto-injects tenantId into all queries
 * 2. Throws error if query attempted without tenant context
 * 3. Prevents accidental cross-tenant data access
 */
export function tenantIsolationPlugin(schema: Schema<any>) {
  // ===== QUERY HOOKS (READ OPERATIONS) =====
  const queryMiddleware = function (
    this: Query<any, any>,
    next: (err?: any) => void,
  ) {
    const context = tenantContext.getStore();

    // Get existing filter
    const filter = this.getFilter();

    // Check if tenantId is already in filter
    if (!filter.tenantId) {
      if (!context?.tenantId) {
        throw new Error(
          "🚨 SECURITY: Query attempted without tenant context! " +
            "All queries must have tenantId.",
        );
      }

      // Auto-inject tenantId
      this.where({ tenantId: context.tenantId });
    }

    next();
  };

  // Apply to all query operations
  schema.pre(
    [
      "find",
      "findOne",
      "findOneAndUpdate",
      "findOneAndDelete",
      "findOneAndReplace",
      "count",
	  "create",
      "countDocuments",
      "deleteOne",
      "deleteMany",
      "updateOne",
      "updateMany",
    ] as any,
    queryMiddleware,
  );

  // ===== SAVE HOOKS (CREATE/UPDATE) =====
  schema.pre("save", function (next) {
    const context = tenantContext.getStore();

    // For new documents, auto-inject tenantId
    if (this.isNew) {
      if (!this.tenantId) {
        if (!context?.tenantId) {
          throw new Error(
            "🚨 SECURITY: Cannot create document without tenant context!",
          );
        }
        this.tenantId = context.tenantId;
      }
    } else {
      // For updates, verify tenantId hasn't changed
      if (this.isModified("tenantId")) {
        throw new Error(
          "🚨 SECURITY: Cannot modify tenantId! This is immutable.",
        );
      }
    }

    next();
  });

  // ===== AGGREGATE HOOKS =====
  schema.pre("aggregate", function (next) {
    const context = tenantContext.getStore();

    if (!context?.tenantId) {
      throw new Error(
        "🚨 SECURITY: Aggregate query attempted without tenant context!",
      );
    }

    // Inject $match stage at the beginning
    this.pipeline().unshift({
      $match: { tenantId: context.tenantId },
    });

    next();
  });
}

/**
 * Middleware to set tenant context for the request
 * Use this in your Express middleware chain
 */
export function setTenantContext(tenantId: string) {
  return (req: any, res: any, next: any) => {
    tenantContext.run({ tenantId }, () => {
      req.tenantId = tenantId;
      next();
    });
  };
}

/**
 * Helper to run code within tenant context
 * Useful for background jobs, websockets, etc.
 */
export async function runInTenantContext<T>(
  tenantId: string,
  fn: () => Promise<T>,
): Promise<T> {
  return tenantContext.run({ tenantId }, fn);
}
