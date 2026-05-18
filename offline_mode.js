/**
 * Offline mode setup - temporary solution while production server is down
 * Creates a local database with sample data to continue development
 */

import { db } from "./server/db.js";
import { users, campaigns, campaignContent, globalApiKeys } from "./shared/schema.js";

async function setupOfflineMode() {
  console.log("Setting up offline development mode...");
  
  try {
    // Create sample admin user
    await db.insert(users).values({
      id: "admin-offline-001",
      email: "admin@roboflow.tech",
      firstName: "Admin",
      lastName: "User",
      profileImageUrl: null,
      createdAt: new Date(),
      updatedAt: new Date()
    }).onConflictDoNothing();

    // Create sample campaign
    const campaignId = "campaign-offline-001";
    await db.insert(campaigns).values({
      id: campaignId,
      name: "Offline Development Campaign",
      description: "Sample campaign for offline development",
      userId: "admin-offline-001",
      createdAt: new Date(),
      updatedAt: new Date()
    }).onConflictDoNothing();

    // Create sample content
    await db.insert(campaignContent).values({
      id: "content-offline-001",
      campaignId: campaignId,
      title: "Sample Content",
      content: "This is sample content for offline development",
      status: "draft",
      platforms: ["telegram", "vk"],
      createdAt: new Date(),
      updatedAt: new Date()
    }).onConflictDoNothing();

    // Create API keys
    const apiKeys = [
      { name: "CLAUDE_API_KEY", value: process.env.ANTHROPIC_API_KEY, service: "claude" },
      { name: "GOOGLE_SERVICE_ACCOUNT_KEY", value: process.env.GOOGLE_SERVICE_ACCOUNT_KEY, service: "gemini" },
      { name: "QWEN_API_KEY", value: "demo-key", service: "qwen" }
    ];

    for (const key of apiKeys) {
      await db.insert(globalApiKeys).values({
        id: `key-${key.service}`,
        keyName: key.name,
        keyValue: key.value,
        service: key.service,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date()
      }).onConflictDoNothing();
    }

    console.log("✅ Offline mode setup complete");
    console.log("- Admin user created: admin@roboflow.tech");
    console.log("- Sample campaign and content created");
    console.log("- API keys configured");
    
  } catch (error) {
    console.error("❌ Error setting up offline mode:", error);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  setupOfflineMode();
}

export { setupOfflineMode };