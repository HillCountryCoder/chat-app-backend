import mongoose from "mongoose";
import { Tenant } from "../models/tenant.model";

/**
 * Migration 001: Create tenants collection
 */
export async function migration_001_create_tenants_collection() {
  console.log("🚀 Running migration 001: Create tenants collection...");

  // The collection is created automatically when first document is inserted
  // Just verify it exists
  if (!mongoose.connection.db) {
    throw new Error("Database connection not established");
  }
  const collections = await mongoose.connection.db.listCollections().toArray();
  const tenantCollectionExists = collections.some((c) => c.name === "tenants");

  if (!tenantCollectionExists) {
    await mongoose.connection.db.createCollection("tenants");
    console.log("✅ Created tenants collection");
  } else {
    console.log("✅ Tenants collection already exists");
  }
}

/**
 * Migration 002: Add tenantId to all existing collections
 */
export async function migration_002_add_tenantId_fields() {
  console.log(
    "🚀 Running migration 002: Add tenantId to existing collections...",
  );

  if (!mongoose.connection.db) {
    throw new Error("Database connection not established");
  }

  const DEFAULT_TENANT_ID = "default";

  // Update Users
  const usersUpdated = await mongoose.connection.db
    .collection("users")
    .updateMany(
      { tenantId: { $exists: false } },
      { $set: { tenantId: DEFAULT_TENANT_ID } },
    );
  console.log(`✅ Updated ${usersUpdated.modifiedCount} users with tenantId`);

  // Update Channels
  const channelsUpdated = await mongoose.connection.db
    .collection("channels")
    .updateMany(
      { tenantId: { $exists: false } },
      { $set: { tenantId: DEFAULT_TENANT_ID } },
    );
  console.log(
    `✅ Updated ${channelsUpdated.modifiedCount} channels with tenantId`,
  );

  // Update Messages
  const messagesUpdated = await mongoose.connection.db
    .collection("messages")
    .updateMany(
      { tenantId: { $exists: false } },
      { $set: { tenantId: DEFAULT_TENANT_ID } },
    );
  console.log(
    `✅ Updated ${messagesUpdated.modifiedCount} messages with tenantId`,
  );

  // Update DirectMessages if exists
  const dmCollectionExists = (
    await mongoose.connection.db.listCollections().toArray()
  ).some((c) => c.name === "directmessages");

  if (dmCollectionExists) {
    const dmUpdated = await mongoose.connection.db
      .collection("directmessages")
      .updateMany(
        { tenantId: { $exists: false } },
        { $set: { tenantId: DEFAULT_TENANT_ID } },
      );
    console.log(
      `✅ Updated ${dmUpdated.modifiedCount} direct messages with tenantId`,
    );
  }
}

/**
 * Migration 003: Create default tenant for existing data
 */
export async function migration_003_create_default_tenant() {
  console.log("🚀 Running migration 003: Create default tenant...");

  const DEFAULT_TENANT_ID = "default";

  // Check if default tenant already exists
  const existingTenant = await Tenant.findOne({ tenantId: DEFAULT_TENANT_ID });

  if (existingTenant) {
    console.log("✅ Default tenant already exists");
    return;
  }

  // Create default tenant
  const defaultTenant = await Tenant.create({
    tenantId: DEFAULT_TENANT_ID,
    name: "Default Tenant",
    domain: "localhost",
    allowedOrigins: ["http://localhost:3000", "http://localhost:3001"],
    sharedSecret: "default_secret_change_in_production",
    status: "verified",
    isActive: true,
    settings: {
      maxUsers: 10000,
      features: ["chat", "channels", "direct-messages"],
    },
  });

  console.log("✅ Created default tenant:", defaultTenant.tenantId);
}

/**
 * Migration 004: Create indexes for tenant isolation
 */
export async function migration_004_create_tenant_indexes() {
  console.log("🚀 Running migration 004: Create tenant-based indexes...");
  if (!mongoose.connection.db) {
    throw new Error("Database connection not established");
  }
  // Users indexes
  await mongoose.connection.db
    .collection("users")
    .createIndex(
      { tenantId: 1, email: 1 },
      { unique: true, name: "tenant_email_unique" },
    );

  await mongoose.connection.db
    .collection("users")
    .createIndex(
      { tenantId: 1, username: 1 },
      { unique: true, name: "tenant_username_unique" },
    );

  await mongoose.connection.db
    .collection("users")
    .createIndex(
      { tenantId: 1, externalId: 1, externalSystem: 1 },
      { unique: true, sparse: true, name: "tenant_external_id_unique" },
    );

  await mongoose.connection.db
    .collection("users")
    .createIndex({ tenantId: 1, isActive: 1 }, { name: "tenant_active_users" });

  console.log("✅ Created user indexes");

  // Channels indexes
  await mongoose.connection.db
    .collection("channels")
    .createIndex(
      { tenantId: 1, name: 1 },
      { unique: true, name: "tenant_channel_name_unique" },
    );

  await mongoose.connection.db
    .collection("channels")
    .createIndex(
      { tenantId: 1, isPrivate: 1 },
      { name: "tenant_channel_visibility" },
    );

  console.log("✅ Created channel indexes");

  // Messages indexes
  await mongoose.connection.db
    .collection("messages")
    .createIndex(
      { tenantId: 1, channelId: 1, createdAt: -1 },
      { name: "tenant_channel_messages" },
    );

  await mongoose.connection.db
    .collection("messages")
    .createIndex(
      { tenantId: 1, senderId: 1, createdAt: -1 },
      { name: "tenant_user_messages" },
    );

  console.log("✅ Created message indexes");

  // Tenants indexes
  await mongoose.connection.db
    .collection("tenants")
    .createIndex({ tenantId: 1 }, { unique: true, name: "tenant_id_unique" });

  await mongoose.connection.db
    .collection("tenants")
    .createIndex({ domain: 1 }, { unique: true, name: "tenant_domain_unique" });

  await mongoose.connection.db
    .collection("tenants")
    .createIndex({ status: 1, isActive: 1 }, { name: "tenant_status" });

  console.log("✅ Created tenant indexes");
}

/**
 * Migration 005: Add new fields to users (non-breaking)
 */
export async function migration_005_add_new_user_fields() {
  console.log("🚀 Running migration 005: Add new fields to users...");
  if (!mongoose.connection.db) {
    throw new Error("Database connection not established");
  }
  // Add new fields with safe defaults
  const result = await mongoose.connection.db.collection("users").updateMany(
    {
      $or: [
        { externalId: { $exists: false } },
        { externalSystem: { $exists: false } },
        { emailVerified: { $exists: false } },
        { isActive: { $exists: false } },
      ],
    },
    {
      $set: {
        externalId: null,
        externalSystem: null,
        emailVerified: false, // Will be true for existing users who've been using the system
        isActive: true, // Assume existing users are active
      },
    },
  );

  console.log(`✅ Updated ${result.modifiedCount} users with new fields`);

  // Mark existing users as email verified (they've been using the system)
  const verifiedCount = await mongoose.connection.db
    .collection("users")
    .updateMany(
      {
        emailVerified: false,
        createdAt: { $exists: true }, // Existing users
      },
      {
        $set: { emailVerified: true },
      },
    );

  console.log(
    `✅ Marked ${verifiedCount.modifiedCount} existing users as email verified`,
  );
}

/**
 * Run all migrations in sequence
 */
export async function runAllMigrations() {
  console.log("🚀 Starting database migrations...\n");

  try {
    await migration_001_create_tenants_collection();
    await migration_002_add_tenantId_fields();
    await migration_003_create_default_tenant();
    await migration_004_create_tenant_indexes();
    await migration_005_add_new_user_fields();

    console.log("\n✅ All migrations completed successfully!");
  } catch (error) {
    console.error("❌ Migration failed:", error);
    throw error;
  }
}

/**
 * Rollback migration (emergency use only)
 */
export async function rollbackMigrations() {
  console.log("⚠️  Rolling back migrations...");
  if (!mongoose.connection.db) {
    throw new Error("Database connection not established");
  }
  // Drop tenant-specific indexes
  try {
    await mongoose.connection.db
      .collection("users")
      .dropIndex("tenant_email_unique");
    await mongoose.connection.db
      .collection("users")
      .dropIndex("tenant_username_unique");
    await mongoose.connection.db
      .collection("users")
      .dropIndex("tenant_external_id_unique");
  } catch (err) {
    console.log("Some indexes may not exist, continuing...", err);
  }

  // Remove tenantId fields
  await mongoose.connection.db.collection("users").updateMany(
    {},
    {
      $unset: {
        tenantId: "",
        externalId: "",
        externalSystem: "",
        externalUserType: "",
      },
    },
  );

  await mongoose.connection.db
    .collection("channels")
    .updateMany({}, { $unset: { tenantId: "" } });

  await mongoose.connection.db
    .collection("messages")
    .updateMany({}, { $unset: { tenantId: "" } });

  console.log("✅ Rollback complete");
}

// CLI Runner
if (require.main === module) {
  const command = process.argv[2];

  mongoose
    .connect(process.env.MONGODB_URI || "mongodb://localhost:27017/chat-app")
    .then(async () => {
      console.log("📦 Connected to MongoDB\n");

      if (command === "rollback") {
        await rollbackMigrations();
      } else {
        await runAllMigrations();
      }

      await mongoose.disconnect();
      process.exit(0);
    })
    .catch((error) => {
      console.error("❌ Migration error:", error);
      process.exit(1);
    });
}
