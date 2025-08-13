const mongoose = require("mongoose");
const ChatConversation = require("../src/models/ChatConversation");

// Connect to MongoDB
mongoose.connect("mongodb://localhost:27017/eduVision", {
  useNewUrlParser: true,
  useUnifiedTopology: true,
});

async function fixConversationModels() {
  try {
    console.log("Fixing conversation model settings...");

    // Find all conversations with invalid or missing model settings
    const conversations = await ChatConversation.find({
      $or: [
        { "settings.model": { $exists: false } },
        { "settings.model": "gpt-3.5-turbo" },
        { "settings.model": "gpt-4" },
        { "settings.model": { $not: /deepseek/ } },
      ],
    });

    console.log(`Found ${conversations.length} conversations to fix`);

    for (const conversation of conversations) {
      // Update the settings to use the correct DeepSeek model
      await ChatConversation.updateOne(
        { _id: conversation._id },
        {
          $set: {
            "settings.model": "deepseek/deepseek-r1:free",
            "settings.temperature": conversation.settings?.temperature || 0.7,
            "settings.maxTokens": conversation.settings?.maxTokens || 1000,
            "settings.contextWindow":
              conversation.settings?.contextWindow || 10,
          },
        }
      );

      console.log(
        `Fixed conversation ${conversation._id}: ${conversation.title}`
      );
    }

    console.log("All conversations fixed successfully!");
    process.exit(0);
  } catch (error) {
    console.error("Error fixing conversations:", error);
    process.exit(1);
  }
}

fixConversationModels();
