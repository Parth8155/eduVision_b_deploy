const { json } = require("express");
const ChatConversation = require("../models/ChatConversation");
const Note = require("../models/Note");
const chatService = require("../services/chatService");
const { validationResult } = require("express-validator");

class ChatController {
  // Start or get existing conversation for a note
  async getOrCreateConversation(req, res) {
    try {
      const { noteId } = req.params;
      const userId = req.user.id;

      // Validate note exists and user has access
      const note = await Note.findOne({ _id: noteId, userId });
      if (!note) {
        return res.status(404).json({
          success: false,
          message: "Note not found or access denied",
        });
      }

      // Find existing conversation or create new one
      let conversation = await ChatConversation.findByUserAndNote(
        userId,
        noteId
      );

      if (!conversation) {
        // Pre-build note context for efficiency
        const noteContext = chatService.buildNoteContext(note);

        conversation = new ChatConversation({
          userId,
          noteId,
          title: `Chat about ${note.title}`,
          messages: [
            {
              role: "system",
              content: `You are an AI assistant helping with studying from the note titled "${note.title}". The note is about ${note.subject}. You can answer questions about the content, help explain concepts, create practice questions, and assist with studying. Always be helpful, accurate, and educational.`,
            },
          ],
          noteContext: {
            title: note.title,
            subject: note.subject,
            description: note.description,
            extractedText: noteContext,
            lastUpdated: new Date(),
          },
          settings: {
            model: "deepseek/deepseek-r1:free",
            temperature: 0.7,
            maxTokens: 1000,
            contextWindow: 10,
          },
        });
        await conversation.save();
      }

      res.json({
        success: true,
        data: {
          conversationId: conversation._id,
          title: conversation.title,
          messages: conversation.messages.filter(
            (msg) => msg.role !== "system"
          ), // Don't send system message to client
          settings: conversation.settings,
          metadata: conversation.metadata,
        },
      });
    } catch (error) {
      console.error("Get/Create conversation error:", error);
      res.status(500).json({
        success: false,
        message: "Failed to get conversation",
        error: error.message,
      });
    }
  }

  // Send a message and get AI response
  async sendMessage(req, res) {
    try {
      console.log("messaged...");
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          message: "Validation failed",
          errors: errors.array(),
        });
      }

      const { noteId, message, context } = req.body;
      const userId = req.user.id;

      // Verify note exists and user has access
      const note = await Note.findOne({ _id: noteId, userId });
      if (!note) {
        return res.status(404).json({
          success: false,
          message: "Note not found or access denied",
        });
      }

      // Find existing conversation or create new one
      let conversation = await ChatConversation.findByUserAndNote(
        userId,
        noteId
      );

      if (!conversation) {
        // Pre-build note context for efficiency
        const noteContext = chatService.buildNoteContext(note);

        conversation = new ChatConversation({
          userId,
          noteId,
          title: `Chat about ${note.title}`,
          messages: [
            {
              role: "system",
              content: `You are an AI assistant helping with studying from the note titled "${note.title}". The note is about ${note.subject}. You can answer questions about the content, help explain concepts, create practice questions, and assist with studying. Always be helpful, accurate, and educational.`,
            },
          ],
          noteContext: {
            title: note.title,
            subject: note.subject,
            description: note.description,
            extractedText: noteContext,
            lastUpdated: new Date(),
          },
          settings: {
            model: "deepseek/deepseek-r1:free",
            temperature: 0.7,
            maxTokens: 1000,
            contextWindow: 10,
          },
        });
        await conversation.save();
      }

      // Add user message to conversation
      await conversation.addMessage("user", message);

      // Get AI response
      const aiResponse = await chatService.generateResponse(
        conversation,
        message,
        context
      );
      console.log("responce from ai " + aiResponse);

      // Add AI response to conversation
      await conversation.addMessage(
        "assistant",
        aiResponse.content,
        aiResponse.noteReferences
      );

      // Update conversation metadata
      conversation.metadata.totalTokensUsed += aiResponse.tokensUsed || 0;
      await conversation.save();

      console.log("data :- " + aiResponse.content);
      res.json({
        success: true,
        data: {
          message: {
            role: "assistant",
            content: aiResponse.content,
            timestamp: new Date(),
            noteReferences: aiResponse.noteReferences,
          },
          tokensUsed: aiResponse.tokensUsed,
          metadata: conversation.metadata,
        },
      });
    } catch (error) {
      console.error("Send message error:", error);
      res.status(500).json({
        success: false,
        message: "Failed to send message",
        error: error.message,
      });
    }
  }

  // Get conversation history
  async getConversationHistory(req, res) {
    try {
      const { conversationId } = req.params;
      const { limit = 50, offset = 0 } = req.query;
      const userId = req.user.id;

      const conversation = await ChatConversation.findOne({
        _id: conversationId,
        userId,
        isActive: true,
      }).populate("noteId", "title subject");

      if (!conversation) {
        return res.status(404).json({
          success: false,
          message: "Conversation not found",
        });
      }

      // Get messages (excluding system messages for client)
      const messages = conversation.messages
        .filter((msg) => msg.role !== "system")
        .slice(offset, offset + parseInt(limit));

      res.json({
        success: true,
        data: {
          conversation: {
            id: conversation._id,
            title: conversation.title,
            noteId: conversation.noteId._id,
            noteTitle: conversation.noteId.title,
            noteSubject: conversation.noteId.subject,
          },
          messages,
          pagination: {
            total: conversation.messages.filter((msg) => msg.role !== "system")
              .length,
            offset: parseInt(offset),
            limit: parseInt(limit),
          },
          metadata: conversation.metadata,
        },
      });
    } catch (error) {
      console.error("Get conversation history error:", error);
      res.status(500).json({
        success: false,
        message: "Failed to get conversation history",
        error: error.message,
      });
    }
  }

  // Get user's recent conversations
  async getUserConversations(req, res) {
    try {
      const userId = req.user.id;
      const { limit = 20 } = req.query;

      const conversations = await ChatConversation.findUserConversations(
        userId,
        parseInt(limit)
      );

      res.json({
        success: true,
        data: conversations.map((conv) => ({
          id: conv._id,
          title: conv.title,
          noteId: conv.noteId._id,
          noteTitle: conv.noteId.title,
          noteSubject: conv.noteId.subject,
          lastActivity: conv.metadata.lastActivity,
          messageCount: conv.metadata.totalMessages,
        })),
      });
    } catch (error) {
      console.error("Get user conversations error:", error);
      res.status(500).json({
        success: false,
        message: "Failed to get conversations",
        error: error.message,
      });
    }
  }

  // Update conversation settings
  async updateConversationSettings(req, res) {
    try {
      const { conversationId } = req.params;
      const { temperature, maxTokens, contextWindow } = req.body;
      const userId = req.user.id;

      const conversation = await ChatConversation.findOne({
        _id: conversationId,
        userId,
        isActive: true,
      });

      if (!conversation) {
        return res.status(404).json({
          success: false,
          message: "Conversation not found",
        });
      }

      // Update settings
      if (temperature !== undefined)
        conversation.settings.temperature = temperature;
      if (maxTokens !== undefined) conversation.settings.maxTokens = maxTokens;
      if (contextWindow !== undefined)
        conversation.settings.contextWindow = contextWindow;

      await conversation.save();

      res.json({
        success: true,
        data: {
          settings: conversation.settings,
        },
      });
    } catch (error) {
      console.error("Update conversation settings error:", error);
      res.status(500).json({
        success: false,
        message: "Failed to update settings",
        error: error.message,
      });
    }
  }

  // Delete conversation
  async deleteConversation(req, res) {
    try {
      const { conversationId } = req.params;
      const userId = req.user.id;

      const conversation = await ChatConversation.findOne({
        _id: conversationId,
        userId,
        isActive: true,
      });

      if (!conversation) {
        return res.status(404).json({
          success: false,
          message: "Conversation not found",
        });
      }

      // Soft delete
      conversation.isActive = false;
      await conversation.save();

      res.json({
        success: true,
        message: "Conversation deleted successfully",
      });
    } catch (error) {
      console.error("Delete conversation error:", error);
      res.status(500).json({
        success: false,
        message: "Failed to delete conversation",
        error: error.message,
      });
    }
  }

  // Generate study questions from note content
  async generateStudyQuestions(req, res) {
    try {
      const { noteId } = req.params;
      const {
        questionType = "mixed",
        difficulty = "medium",
        count = 5,
      } = req.body;
      const userId = req.user.id;

      // Validate note exists and user has access
      const note = await Note.findOne({ _id: noteId, userId });
      if (!note) {
        return res.status(404).json({
          success: false,
          message: "Note not found or access denied",
        });
      }

      // Generate questions using AI service
      const questions = await chatService.generateStudyQuestions(
        note,
        questionType,
        difficulty,
        count
      );

      res.json({
        success: true,
        data: {
          questions,
          noteId: note._id,
          noteTitle: note.title,
          generatedAt: new Date(),
        },
      });
    } catch (error) {
      console.error("Generate study questions error:", error);
      res.status(500).json({
        success: false,
        message: "Failed to generate study questions",
        error: error.message,
      });
    }
  }

  // Get suggested conversation starters
  async getConversationStarters(req, res) {
    try {
      const { noteId } = req.params;
      const userId = req.user.id;

      // Validate note exists and user has access
      const note = await Note.findOne({ _id: noteId, userId });
      if (!note) {
        return res.status(404).json({
          success: false,
          message: "Note not found or access denied",
        });
      }

      const starters = await chatService.generateConversationStarters(note);

      res.json({
        success: true,
        data: {
          starters,
          noteId: note._id,
          noteTitle: note.title,
        },
      });
    } catch (error) {
      console.error("Get conversation starters error:", error);
      res.status(500).json({
        success: false,
        message: "Failed to get conversation starters",
        error: error.message,
      });
    }
  }
  // Get all conversations for a specific note
  async getConversationsForNote(req, res) {
    try {
      const { noteId } = req.params;
      const userId = req.user.id;

      // Validate note exists and user has access
      const note = await Note.findOne({ _id: noteId, userId });
      if (!note) {
        return res.status(404).json({
          success: false,
          message: "Note not found or access denied",
        });
      }

      // Find all conversations for this note
      const conversations = await ChatConversation.find({
        userId,
        noteId,
        isActive: true,
      })
        .sort({ "metadata.lastActivity": -1 }) // Sort by most recent activity
        .select("-noteContext") // Exclude large noteContext field
        .exec();

      res.json({
        success: true,
        conversations: conversations.map((conv) => ({
          _id: conv._id,
          userId: conv.userId,
          noteId: conv.noteId,
          title: conv.title,
          messages: conv.messages.filter((msg) => msg.role !== "system"),
          isActive: conv.isActive,
          settings: conv.settings,
          metadata: conv.metadata,
          createdAt: conv.createdAt,
          updatedAt: conv.updatedAt,
        })),
      });
    } catch (error) {
      console.error("Get conversations for note error:", error);
      res.status(500).json({
        success: false,
        message: "Failed to get conversations",
        error: error.message,
      });
    }
  }

  // Create a new conversation for a note
  async createNewConversation(req, res) {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          message: "Validation failed",
          errors: errors.array(),
        });
      }

      const { noteId } = req.body;
      const userId = req.user.id;

      // Validate note exists and user has access
      const note = await Note.findOne({ _id: noteId, userId });
      if (!note) {
        return res.status(404).json({
          success: false,
          message: "Note not found or access denied",
        });
      }

      // Count existing conversations for this note
      const existingCount = await ChatConversation.countDocuments({
        userId,
        noteId,
        isActive: true,
      });

      // Pre-build note context for efficiency
      const noteContext = chatService.buildNoteContext(note);

      // Create new conversation
      const conversation = new ChatConversation({
        userId,
        noteId,
        title: `Chat ${existingCount + 1} - ${note.title}`,
        messages: [
          {
            role: "system",
            content: `You are an AI assistant helping with studying from the note titled "${note.title}". The note is about ${note.subject}. You can answer questions about the content, help explain concepts, create practice questions, and assist with studying. Always be helpful, accurate, and educational.`,
          },
        ],
        noteContext: {
          title: note.title,
          subject: note.subject,
          description: note.description,
          extractedText: noteContext,
          lastUpdated: new Date(),
        },
        settings: {
          model: "deepseek/deepseek-r1:free",
          temperature: 0.7,
          maxTokens: 1000,
          contextWindow: 10,
        },
      });

      await conversation.save();

      res.json({
        success: true,
        conversation: {
          _id: conversation._id,
          userId: conversation.userId,
          noteId: conversation.noteId,
          title: conversation.title,
          messages: conversation.messages.filter(
            (msg) => msg.role !== "system"
          ),
          isActive: conversation.isActive,
          settings: conversation.settings,
          metadata: conversation.metadata,
          createdAt: conversation.createdAt,
          updatedAt: conversation.updatedAt,
        },
      });
    } catch (error) {
      console.error("Create new conversation error:", error);
      res.status(500).json({
        success: false,
        message: "Failed to create new conversation",
        error: error.message,
      });
    }
  }

  // Generate summary from note content
  async generateSummary(req, res) {
    try {
      const { noteId } = req.params;
      const { length = "medium", format = "structured" } = req.body;
      const userId = req.user.id;

      // Validate note exists and user has access
      const note = await Note.findOne({ _id: noteId, userId });
      if (!note) {
        return res.status(404).json({
          success: false,
          message: "Note not found or access denied",
        });
      }

      // Generate summary using AI service
      const summary = await chatService.generateNoteSummary(
        note,
        length,
        format
      );

      res.json({
        success: true,
        data: {
          summary,
          noteId: note._id,
          noteTitle: note.title,
          generatedAt: new Date(),
        },
      });
    } catch (error) {
      console.error("Generate summary error:", error);
      res.status(500).json({
        success: false,
        message: "Failed to generate summary",
        error: error.message,
      });
    }
  }
}

module.exports = new ChatController();
