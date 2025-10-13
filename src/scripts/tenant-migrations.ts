/* eslint-disable @typescript-eslint/no-explicit-any */
import mongoose from "mongoose";
import dotenv from "dotenv";
import path from "path";
import { Tenant } from "../models/tenant.model";

// Load environment variables FIRST
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

/**
 * Migration 001: Create tenants collection
 */
export async function migration_001_create_tenants_collection() {
  console.log("🚀 Running migration 001: Create tenants collection...");

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
 * Migration 001b: Drop old tenant indexes that might conflict
 */
export async function migration_001b_drop_old_tenant_indexes() {
  console.log("🚀 Running migration 001b: Dropping old tenant indexes...");

  if (!mongoose.connection.db) {
    throw new Error("Database connection not established");
  }

  const collections = await mongoose.connection.db.listCollections().toArray();
  const usersExists = collections.some((c) => c.name === "users");

  if (!usersExists) {
    console.log(
      "ℹ️  Users collection doesn't exist, skipping index cleanup...",
    );
    return;
  }

  // List of tenant indexes that might exist and cause conflicts
  const indexesToDrop = [
    "tenant_email_unique",
    "tenant_username_unique",
    "tenant_external_id_unique",
    "tenant_active_users",
  ];

  for (const indexName of indexesToDrop) {
    try {
      await mongoose.connection.db.collection("users").dropIndex(indexName);
      console.log(`✅ Dropped index: ${indexName}`);
    } catch (error: any) {
      if (error.code === 27 || error.codeName === "IndexNotFound") {
        console.log(`ℹ️  Index ${indexName} doesn't exist, skipping...`);
      } else {
        console.log(`⚠️  Could not drop ${indexName}:`, error.message);
      }
    }
  }

  // Drop channel tenant indexes
  const channelsExists = collections.some((c) => c.name === "channels");
  if (channelsExists) {
    const channelIndexes = [
      "tenant_name_idx",
      "tenant_archived_idx",
      "tenant_creator_idx",
    ];
    for (const indexName of channelIndexes) {
      try {
        await mongoose.connection.db
          .collection("channels")
          .dropIndex(indexName);
        console.log(`✅ Dropped channel index: ${indexName}`);
      } catch (error: any) {
        if (error.code === 27 || error.codeName === "IndexNotFound") {
          console.log(
            `ℹ️  Channel index ${indexName} doesn't exist, skipping...`,
          );
        }
      }
    }
  }

  console.log("✅ Completed index cleanup");
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

  // Helper function to check if collection exists
  const collectionExists = async (name: string): Promise<boolean> => {
    const collections = await mongoose.connection
      .db!.listCollections()
      .toArray();
    return collections.some((c) => c.name === name);
  };

  // Helper function to add tenantId to a collection
  const addTenantIdToCollection = async (
    collectionName: string,
    displayName: string,
  ) => {
    if (await collectionExists(collectionName)) {
      const result = await mongoose.connection
        .db!.collection(collectionName)
        .updateMany(
          { tenantId: { $exists: false } },
          { $set: { tenantId: DEFAULT_TENANT_ID } },
        );
      console.log(
        `✅ Updated ${result.modifiedCount} ${displayName} with tenantId`,
      );
      return result.modifiedCount;
    } else {
      console.log(`ℹ️  ${displayName} collection doesn't exist, skipping...`);
      return 0;
    }
  };

  // Update all collections that have the tenant plugin
  let totalUpdated = 0;

  // Core collections
  totalUpdated += await addTenantIdToCollection("users", "users");
  totalUpdated += await addTenantIdToCollection("channels", "channels");
  totalUpdated += await addTenantIdToCollection("messages", "messages");
  totalUpdated += await addTenantIdToCollection(
    "directmessages",
    "direct messages",
  );

  // Additional collections
  totalUpdated += await addTenantIdToCollection(
    "channelmembers",
    "channel members",
  );
  totalUpdated += await addTenantIdToCollection("threads", "threads");
  totalUpdated += await addTenantIdToCollection("attachments", "attachments");
  totalUpdated += await addTenantIdToCollection(
    "refreshtokens",
    "refresh tokens",
  );

  // Presence collections
  totalUpdated += await addTenantIdToCollection(
    "presencehistories",
    "presence histories",
  );
  totalUpdated += await addTenantIdToCollection(
    "userconnections",
    "user connections",
  );

  console.log(`\n📊 Total documents updated: ${totalUpdated}`);
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
 * Migration 004: Add new fields to users (non-breaking)
 */
export async function migration_004_add_new_user_fields() {
  console.log("🚀 Running migration 004: Add new fields to users...");

  if (!mongoose.connection.db) {
    throw new Error("Database connection not established");
  }

  // Check if users collection exists
  const collections = await mongoose.connection.db.listCollections().toArray();
  const usersExists = collections.some((c) => c.name === "users");

  if (!usersExists) {
    console.log("ℹ️  Users collection doesn't exist yet, skipping...");
    return;
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
        emailVerified: false,
        isActive: true,
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
    await migration_001b_drop_old_tenant_indexes(); // NEW: Drop conflicting indexes first
    await migration_002_add_tenantId_fields();
    await migration_003_create_default_tenant();
    await migration_004_add_new_user_fields();

    console.log("\n✅ All migrations completed successfully!");
    console.log("\n📝 Next steps:");
    console.log(
      "1. Restart your server to let Mongoose create indexes from models",
    );
    console.log("2. Verify that all collections have tenantId field");
    console.log("3. Test that tenant isolation is working");
    console.log("\n💡 To verify migration:");
    console.log("   db.users.findOne() - should have tenantId: 'default'");
    console.log("   db.channels.findOne() - should have tenantId: 'default'");
    console.log("   db.tenants.find() - should show default tenant");
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
  console.log("⚠️  WARNING: This will remove all tenant-related data!");

  if (!mongoose.connection.db) {
    throw new Error("Database connection not established");
  }

  // Helper function to check if collection exists
  const collectionExists = async (name: string): Promise<boolean> => {
    const collections = await mongoose.connection
      .db!.listCollections()
      .toArray();
    return collections.some((c) => c.name === name);
  };

  // Helper function to remove tenantId from a collection
  const removeTenantIdFromCollection = async (
    collectionName: string,
    displayName: string,
  ) => {
    if (await collectionExists(collectionName)) {
      await mongoose.connection
        .db!.collection(collectionName)
        .updateMany({}, { $unset: { tenantId: "" } });
      console.log(`✅ Removed tenantId from ${displayName}`);
    }
  };

  // Remove tenantId from users and new fields
  if (await collectionExists("users")) {
    await mongoose.connection.db!.collection("users").updateMany(
      {},
      {
        $unset: {
          tenantId: "",
          externalId: "",
          externalSystem: "",
          emailVerified: "",
          isActive: "",
        },
      },
    );
    console.log("✅ Removed tenant and new fields from users");
  }

  // Remove tenantId from other collections
  await removeTenantIdFromCollection("channels", "channels");
  await removeTenantIdFromCollection("messages", "messages");
  await removeTenantIdFromCollection("directmessages", "direct messages");
  await removeTenantIdFromCollection("channelmembers", "channel members");
  await removeTenantIdFromCollection("threads", "threads");
  await removeTenantIdFromCollection("attachments", "attachments");
  await removeTenantIdFromCollection("refreshtokens", "refresh tokens");
  await removeTenantIdFromCollection("presencehistories", "presence histories");
  await removeTenantIdFromCollection("userconnections", "user connections");

  // Delete tenants collection
  if (await collectionExists("tenants")) {
    await mongoose.connection.db!.collection("tenants").drop();
    console.log("✅ Dropped tenants collection");
  }

  console.log("\n✅ Rollback complete");
  console.log("⚠️  Note: You may need to manually drop tenant-related indexes");
}

// CLI Runner
if (require.main === module) {
  const command = process.argv[2];

  // Check if MONGODB_URI is set
  const mongoUri = process.env.MONGODB_URI;
  if (!mongoUri) {
    console.error("❌ Error: MONGODB_URI environment variable not set!");
    console.error("Please check your .env file.");
    process.exit(1);
  }

  console.log("📦 Connecting to MongoDB...");
  console.log(`📍 URI: ${mongoUri.replace(/:[^:]*@/, ":****@")}`); // Hide password in logs

  mongoose
    .connect(mongoUri)
    .then(async () => {
      console.log("✅ Connected to MongoDB\n");

      if (command === "rollback") {
        await rollbackMigrations();
      } else {
        await runAllMigrations();
      }

      await mongoose.disconnect();
      console.log("\n📦 Disconnected from MongoDB");
      process.exit(0);
    })
    .catch((error) => {
      console.error("❌ Migration error:", error);
      console.error("\n💡 Troubleshooting:");
      console.error("1. Check if MongoDB is running at the specified URI");
      console.error("2. Verify your credentials in .env file");
      console.error("3. Ensure network connectivity to the MongoDB server");
      process.exit(1);
    });
}
