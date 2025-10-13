import crypto from "crypto";
import { Tenant, ITenant } from "../models/tenant.model";
import { Channel } from "../models/channel.model";
import { runInTenantContext } from "../plugins/tenantPlugin";

export class TenantService {
  /**
   * Register a new tenant
   */
  static async registerTenant(data: {
    tenantId: string;
    name: string;
    domain: string;
    allowedOrigins: string[];
    adminEmail: string;
  }): Promise<ITenant> {
    // Validate tenantId format (alphanumeric + dashes/underscores)
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

    // Check domain uniqueness
    const existingDomain = await Tenant.findOne({ domain: data.domain });
    if (existingDomain) {
      throw new Error("Tenant with this domain already exists");
    }

    // Generate shared secret for this tenant
    const sharedSecret = crypto.randomBytes(32).toString("hex");

    // Create tenant
    const tenant = await Tenant.create({
      tenantId: data.tenantId,
      name: data.name,
      domain: data.domain,
      allowedOrigins: data.allowedOrigins,
      sharedSecret,
      status: "pending_verification",
      isActive: true,
    });

    console.log(`✅ Tenant registered: ${data.tenantId}`);
    console.log(`📧 Verification email should be sent to: ${data.adminEmail}`);

    // TODO: Send verification email
    // await this.sendVerificationEmail(tenant, data.adminEmail);

    return tenant;
  }

  /**
   * Verify tenant domain ownership
   */
  static async verifyTenant(
    tenantId: string,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
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
    await runInTenantContext(tenantId, async () => {
      // Create default channels
      const defaultChannels = [
        {
          name: "general",
          description: "General discussion",
          isPrivate: false,
          tenantId,
        },
        {
          name: "announcements",
          description: "Important announcements",
          isPrivate: false,
          tenantId,
        },
        {
          name: "random",
          description: "Off-topic conversations",
          isPrivate: false,
          tenantId,
        },
      ];

      for (const channelData of defaultChannels) {
        await Channel.create(channelData);
      }

      console.log(`✅ Provisioned default channels for tenant: ${tenantId}`);

      // TODO: Create default roles/permissions if needed
      // TODO: Send welcome email to admin
    });
  }

  /**
   * Get tenant by ID (with secret)
   */
  static async getTenantWithSecret(tenantId: string): Promise<ITenant | null> {
    return Tenant.findOne({ tenantId }).select("+sharedSecret");
  }

  /**
   * Get tenant by ID (without secret)
   */
  static async getTenant(tenantId: string): Promise<ITenant | null> {
    return Tenant.findOne({ tenantId });
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

    // Apply updates
    if (updates.name) tenant.name = updates.name;
    if (updates.allowedOrigins) tenant.allowedOrigins = updates.allowedOrigins;
    if (updates.settings)
      tenant.settings = { ...tenant.settings, ...updates.settings };

    await tenant.save();

    console.log(`✅ Tenant updated: ${tenantId}`);

    return tenant;
  }

  /**
   * Suspend/unsuspend tenant
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
