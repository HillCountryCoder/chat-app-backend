/* eslint-disable @typescript-eslint/no-unused-vars */
import crypto from "crypto";
import { Tenant, ITenant } from "../models/tenant.model";
import { NotFoundError } from "../common/errors";

export class TenantService {
  /**
   * Store pending tenant registration (Admin generates credentials)
   */
  static async createPendingRegistration(data: {
    tenantId: string;
    name: string;
    adminEmail: string;
    sharedSecret: string;
    registrationToken: string;
    registrationExpiry: Date;
  }): Promise<ITenant> {
    // Validate tenantId format
    if (!/^[a-z0-9-_]+$/.test(data.tenantId)) {
      throw new Error(
        "Invalid tenantId format. Use lowercase alphanumeric, dashes, or underscores.",
      );
    }

    // Check if tenant already exists
    const existing = await Tenant.findOne({ tenantId: data.tenantId });
    if (existing) {
      throw new Error("Tenant with this ID already exists");
    }

    const tenant = await Tenant.create({
      tenantId: data.tenantId,
      name: data.name,
      domain: "pending", // Will be updated during registration
      allowedOrigins: [],
      sharedSecret: data.sharedSecret,
      status: "pending_registration",
      isActive: false,
      registrationToken: data.registrationToken,
      registrationExpiry: data.registrationExpiry,
    });

    console.log(`✅ Created pending registration for tenant: ${data.tenantId}`);

    return tenant;
  }

  /**
   * Complete tenant registration (Client calls with credentials)
   */
  static async completeRegistration(data: {
    tenantId: string;
    domain: string;
    allowedOrigins: string[];
    sharedSecret: string;
    registrationToken: string;
  }): Promise<ITenant> {
    // Find pending tenant
    const tenant = await Tenant.findOne({ tenantId: data.tenantId }).select(
      "+sharedSecret +registrationToken +registrationExpiry",
    );

    if (!tenant) {
      throw new Error("Tenant not found");
    }

    if (tenant.status !== "pending_registration") {
      throw new Error("Tenant is not in pending registration state");
    }

    // Verify registration token
    if (tenant.registrationToken !== data.registrationToken) {
      console.error("🚨 Invalid registration token for tenant:", data.tenantId);
      throw new Error("Invalid registration token");
    }

    // Check if token expired
    if (tenant.registrationExpiry && tenant.registrationExpiry < new Date()) {
      throw new Error("Registration token has expired");
    }

    // Verify shared secret matches
    if (tenant.sharedSecret !== data.sharedSecret) {
      console.error("🚨 Shared secret mismatch for tenant:", data.tenantId);
      throw new Error("Invalid shared secret");
    }

    // Update tenant with actual details
    tenant.domain = data.domain;
    tenant.allowedOrigins = data.allowedOrigins;
    tenant.status = "pending_verification";
    tenant.isActive = true;

    // Clear registration token (single use)
    tenant.registrationToken = undefined;
    tenant.registrationExpiry = undefined;

    await tenant.save();

    console.log(`✅ Completed registration for tenant: ${data.tenantId}`);

    return tenant;
  }

  /**
   * Verify tenant domain ownership
   */
  static async verifyTenant(
    tenantId: string,
    verificationCode: string,
  ): Promise<ITenant> {
    const tenant = await Tenant.findOne({ tenantId });

    if (!tenant) {
      throw new Error("Tenant not found");
    }

    if (tenant.status === "verified") {
      throw new Error("Tenant already verified");
    }

    // TODO: Verify the code against stored verification token
    // For MVP, we'll auto-verify

    tenant.status = "verified";
    await tenant.save();

    // Auto-provision default resources
    await this.provisionTenant(tenantId);

    console.log(`✅ Tenant verified: ${tenantId}`);

    return tenant;
  }

  /**
   * Auto-provision default channels and resources for a new tenant
   */
  static async provisionTenant(tenantId: string): Promise<void> {
    console.log(`📋 Tenant provisioned: ${tenantId}`);
    console.log(`ℹ️  Default channels will be created when first user logs in`);
  }

  /**
   * Get tenant by ID (with secret)
   */
  static async getTenantWithSecret(tenantId: string): Promise<ITenant> {
    return Tenant.findOne({ tenantId }).select("+sharedSecret");
  }

  /**
   * Get tenant by ID (without secret)
   */
  static async getTenant(tenantId: string): Promise<ITenant> {
    const tenant = await Tenant.findOne({ tenantId });
    if (!tenant) {
      throw new NotFoundError("Tenant not found");
    }

    return tenant;
  }

  /**
   * Get all tenants (admin function)
   */
  static async getAllTenants(): Promise<ITenant[]> {
    return Tenant.find().sort({ createdAt: -1 });
  }

  /**
   * Update tenant settings
   */
  static async updateTenant(
    tenantId: string,
    updates: Partial<Pick<ITenant, "name" | "allowedOrigins" | "settings">>,
  ): Promise<ITenant> {
    const tenant = await Tenant.findOne({ tenantId });

    if (!tenant) {
      throw new Error("Tenant not found");
    }

    if (updates.name) tenant.name = updates.name;
    if (updates.allowedOrigins) tenant.allowedOrigins = updates.allowedOrigins;
    if (updates.settings)
      tenant.settings = { ...tenant.settings, ...updates.settings };

    await tenant.save();

    console.log(`✅ Tenant updated: ${tenantId}`);

    return tenant;
  }

  /**
   * Suspend/activate tenant
   */
  static async setTenantStatus(
    tenantId: string,
    status: "verified" | "suspended",
  ): Promise<ITenant> {
    const tenant = await Tenant.findOne({ tenantId });

    if (!tenant) {
      throw new Error("Tenant not found");
    }

    tenant.status = status;
    tenant.isActive = status === "verified";
    await tenant.save();

    console.log(`✅ Tenant status updated: ${tenantId} -> ${status}`);

    return tenant;
  }

  /**
   * Get all active tenants
   */
  static async getActiveTenants(): Promise<ITenant[]> {
    return Tenant.find({ isActive: true, status: "verified" });
  }

  /**
   * Validate if origin is allowed for tenant
   */
  static async validateOrigin(
    tenantId: string,
    origin: string,
  ): Promise<boolean> {
    const tenant = await this.getTenant(tenantId);

    if (!tenant) {
      return false;
    }

    return tenant.allowedOrigins.some((allowed) => origin.startsWith(allowed));
  }
}
