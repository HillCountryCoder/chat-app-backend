import mongoose from "mongoose";
import { Message } from './../src/models/message.model';
import { env } from "../src/common/environment";
import { createLogger } from "../src/common/logger";

const logger = createLogger("migration-phase2");

async function connectToDatabase() {
  try {
    await mongoose.connect(env.MONGODB_URI);
    logger.info("Connected to MongoDB for migration");
  } catch (error) {
    logger.error("Failed to connect to MongoDB", { error });
    throw error;
  }
}

async function migrateMessages() {
  logger.info("Starting message migration to add hasMedia field");

  try {
    // Add hasMedia field to existing messages without it
    const result = await Message.updateMany(
      { hasMedia: { $exists: false } },
      [
        {
          $set: {
            hasMedia: {
              $cond: {
                if: { $gt: [{ $size: { $ifNull: ["$attachments", []] } }, 0] },
                then: true,
                else: false,
              },
            },
          },
        },
      ]
    );

    logger.info("Message migration completed", {
      modifiedCount: result.modifiedCount,
    });

    // Update totalAttachmentSize for messages with attachments
    const messagesWithAttachments = await Message.find({
      hasMedia: true,
      totalAttachmentSize: { $exists: false },
    }).populate('attachments');

    let updatedCount = 0;
    for (const message of messagesWithAttachments) {
      if (message.attachments && message.attachments.length > 0) {
        const totalSize = message.attachments.reduce((sum: number, attachment: any) => {
          return sum + (attachment.size || 0);
        }, 0);

        await Message.updateOne(
          { _id: message._id },
          { totalAttachmentSize: totalSize }
        );
        updatedCount++;
      }
    }

    logger.info("Attachment size migration completed", {
      updatedCount,
    });

  } catch (error) {
    logger.error("Migration failed", { error });
    throw error;
  }
}

async function createIndexes() {
  logger.info("Creating new indexes for Phase 2");

  try {
    // Ensure new indexes are created
    await Message.collection.createIndex({ hasMedia: 1, createdAt: -1 });
    await Message.collection.createIndex({ channelId: 1, hasMedia: 1, createdAt: -1 });
    await Message.collection.createIndex({ directMessageId: 1, hasMedia: 1, createdAt: -1 });

    logger.info("Indexes created successfully");
  } catch (error) {
    logger.error("Failed to create indexes", { error });
    throw error;
  }
}

async function runMigration() {
  try {
    await connectToDatabase();
    await migrateMessages();
    await createIndexes();
    
    logger.info("Phase 2 migration completed successfully");
  } catch (error) {
    logger.error("Migration failed", { error });
    process.exit(1);
  } finally {
    await mongoose.disconnect();
  }
}

// Run migration if this file is executed directly
if (require.main === module) {
  runMigration();
}

export { runMigration };
