const Note = require("../models/Note");

class ChatService {
  constructor() {
    this.openai = null;
    this.initializeOpenAI();
  }

  initializeOpenAI() {
    try {
      // Only initialize if API key is available
      if (process.env.DEEPSEEK_API_KEY) {
        const { OpenAI } = require("openai");
        this.openai = new OpenAI({
          baseURL: "https://openrouter.ai/api/v1",
          apiKey: process.env.DEEPSEEK_API_KEY,
        });
        console.log("DeepSeek service initialized successfully");
      } else {
        console.warn(
          "DeepSeek API key not found. Chat functionality will use mock responses."
        );
      }
    } catch (error) {
      console.error("Failed to initialize DeepSeek:", error.message);
      this.openai = null;
    }
  }

  // Make buildNoteContext accessible for pre-caching
  buildNoteContext(note, context = {}) {
    let noteContent = "";

    // Debug logging to understand note structure
    console.log("Note structure:", {
      title: note.title,
      subject: note.subject,
      extractedTextType: typeof note.extractedText,
      extractedTextIsArray: Array.isArray(note.extractedText),
      extractedTextKeys: note.extractedText
        ? Object.keys(note.extractedText)
        : null,
      otherFields: Object.keys(note).filter((key) =>
        ["content", "text", "body"].includes(key)
      ),
    });

    // Add basic note information
    noteContent += `Note Title: ${note.title}\n`;
    noteContent += `Subject: ${note.subject}\n`;
    if (note.description) {
      noteContent += `Description: ${note.description}\n`;
    }

    // Add extracted text content - handle different formats
    if (note.extractedText) {
      noteContent += "\nNote Content:\n";

      // Handle if extractedText is an array
      if (Array.isArray(note.extractedText)) {
        note.extractedText.forEach((page, index) => {
          if (typeof page === "string" && page.trim()) {
            // If page is a string
            noteContent += `\nPage ${index + 1}:\n${page.trim()}\n`;
          } else if (page && page.text && page.text.trim()) {
            // If page is an object with text property
            noteContent += `\nPage ${index + 1}:\n${page.text.trim()}\n`;
          }
        });
      } else if (typeof note.extractedText === "string") {
        // Handle if extractedText is just a string
        noteContent += `\n${note.extractedText.trim()}\n`;
      } else if (note.extractedText.text) {
        // Handle if extractedText is an object with text property
        noteContent += `\n${note.extractedText.text.trim()}\n`;
      }
    }

    // Also check for other possible text fields
    if (
      !noteContent.includes("Note Content:") ||
      noteContent.split("Note Content:")[1].trim().length === 0
    ) {
      // If no content found, try other fields
      if (note.content) {
        noteContent += `\nNote Content:\n${note.content}\n`;
      } else if (note.text) {
        noteContent += `\nNote Content:\n${note.text}\n`;
      } else if (note.body) {
        noteContent += `\nNote Content:\n${note.body}\n`;
      }
    }

    // Add any specific context from the user (like selected text)
    if (context.selectedText) {
      noteContent += `\nSelected Text: ${context.selectedText}\n`;
    }

    return noteContent;
  }

  async generateResponse(conversation, userMessage, context = {}) {
    try {
      if (!this.openai) {
        return this.getMockResponse(userMessage);
      }

      // Use cached note content if available, otherwise fetch and cache it
      let noteContext;
      let note = null;

      if (conversation.noteContext && conversation.noteContext.extractedText) {
        console.log("Using cached note context");
        noteContext = this.formatCachedNoteContext(conversation.noteContext);

        // For cached context, we'll need the note for extractNoteReferences
        // We can either store more info in cache or fetch just for references
        // For now, let's create a minimal note object from cached data
        note = {
          _id: conversation.noteId,
          title: conversation.noteContext.title,
          subject: conversation.noteContext.subject,
          description: conversation.noteContext.description,
          extractedText: conversation.noteContext.extractedText,
        };
      } else {
        console.log("Fetching and caching note context");
        note = await Note.findById(conversation.noteId);
        if (!note) {
          throw new Error("Note not found");
        }

        // Build and cache the note context
        noteContext = this.buildNoteContext(note, context);

        // Cache the processed note content
        conversation.noteContext = {
          title: note.title,
          subject: note.subject,
          description: note.description,
          extractedText: noteContext,
          lastUpdated: new Date(),
        };

        // Save the updated conversation with cached content
        await conversation.save();
      }

      // Prepare messages for OpenAI
      const messages = this.prepareMessages(
        conversation,
        userMessage,
        noteContext
      );

      // Call DeepSeek API with fallback model validation
      const modelToUse =
        conversation.settings?.model || "deepseek/deepseek-r1:free";

      // Ensure we're using a valid DeepSeek model for OpenRouter
      const validModel = modelToUse.includes("deepseek")
        ? modelToUse
        : "deepseek/deepseek-r1:free";

      const completion = await this.openai.chat.completions.create({
        model: validModel,
        messages: messages,
        temperature: conversation.settings?.temperature || 0.7,
        max_tokens: conversation.settings?.maxTokens || 1000,
        extra_body: {},
      });

      const response = completion.choices[0].message.content;
      const tokensUsed = completion.usage?.total_tokens || 0;

      // Extract note references if any
      const noteReferences = this.extractNoteReferences(response, note);

      return {
        content: response,
        tokensUsed,
        noteReferences,
      };
    } catch (error) {
      console.error("Generate response error:", error);

      // Fallback to mock response on error
      if (error.code === "insufficient_quota" || error.status === 429) {
        throw new Error("API quota exceeded. Please try again later.");
      }

      return this.getMockResponse(userMessage);
    }
  }

  formatCachedNoteContext(cachedContext) {
    // Simply return the cached formatted context
    return cachedContext.extractedText;
  }

  prepareMessages(conversation, userMessage, noteContext) {
    const messages = [];

    // System message with note context
    messages.push({
      role: "system",
      content: `You are an AI study assistant helping a student with their notes. Here is the context of the note they're studying:

${noteContext}

Instructions:
- Answer questions about the note content accurately
- Help explain concepts and provide additional context
- Create practice questions when asked
- Suggest study strategies
- Be encouraging and supportive
- If asked about content not in the notes, clearly state that and offer to help with what is available
- Keep responses focused on learning and studying

FORMAT YOUR RESPONSES WITH PROPER STRUCTURE:
- Use ### for main section headings
- Use #### for subsection headings  
- Use 📚 🚀 💡 🛠️ 🧩 🔍 emojis with **bold text** for major topic headers
- Use horizontal rules (---) to separate major sections
- Use bullet points (- or •) for lists
- Use numbered lists (1. 2. 3.) for step-by-step instructions
- Use code blocks with language specification:
  \`\`\`assembly
  MOV AX, 5
  ADD AX, 3
  \`\`\`
- Use **bold text** for emphasis on key terms
- Use inline \`code\` for short code snippets or commands
- Use tables with | cell | cell | format for comparisons
- Use ❓ for questions to encourage further learning
- Keep responses well-organized and visually appealing
- Add appropriate spacing between sections
- Make content easy to scan and read`,
    });

    // Add recent conversation history
    const recentMessages = conversation.getRecentMessages();
    recentMessages.forEach((msg) => {
      if (msg.role !== "system") {
        messages.push({
          role: msg.role,
          content: msg.content,
        });
      }
    });

    // Add current user message
    messages.push({
      role: "user",
      content: userMessage,
    });

    return messages;
  }

  extractNoteReferences(response, note) {
    const references = [];

    // Simple implementation - look for page references in response
    const pageRegex = /page\s+(\d+)/gi;
    let match;

    while ((match = pageRegex.exec(response)) !== null) {
      const pageNumber = parseInt(match[1]);
      if (pageNumber <= note.extractedText?.length) {
        references.push({
          noteId: note._id,
          pageNumber,
          excerpt: match[0],
        });
      }
    }

    return references;
  }

  // Helper function to extract JSON from markdown code blocks
  extractJsonFromResponse(response) {
    try {
      // First try to parse as-is
      return JSON.parse(response);
    } catch (e) {
      // If that fails, try to extract from markdown code blocks
      const jsonMatch = response.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
      if (jsonMatch) {
        try {
          return JSON.parse(jsonMatch[1]);
        } catch (innerError) {
          console.error("Failed to parse extracted JSON:", innerError);
          // Try to fix incomplete JSON if it's an array
          let jsonContent = jsonMatch[1].trim();
          if (jsonContent.startsWith("[") && !jsonContent.endsWith("]")) {
            // Try to close incomplete array
            jsonContent = jsonContent.replace(/,\s*$/, "") + "]";
            try {
              return JSON.parse(jsonContent);
            } catch (fixError) {
              console.error("Failed to fix incomplete JSON:", fixError);
            }
          }
          throw new Error("Invalid JSON in markdown code block");
        }
      }

      // If no code blocks, try to find JSON-like content
      const lines = response.split("\n");
      let jsonStart = -1;
      let jsonEnd = -1;

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (line.startsWith("[") || line.startsWith("{")) {
          jsonStart = i;
          break;
        }
      }

      if (jsonStart >= 0) {
        for (let i = lines.length - 1; i >= jsonStart; i--) {
          const line = lines[i].trim();
          if (line.endsWith("]") || line.endsWith("}")) {
            jsonEnd = i;
            break;
          }
        }

        if (jsonEnd >= jsonStart) {
          const jsonContent = lines.slice(jsonStart, jsonEnd + 1).join("\n");
          try {
            return JSON.parse(jsonContent);
          } catch (innerError) {
            console.error(
              "Failed to parse extracted JSON content:",
              innerError
            );
          }
        } else {
          // Try to fix incomplete JSON array from lines
          let jsonContent = lines.slice(jsonStart).join("\n").trim();
          if (jsonContent.startsWith("[") && !jsonContent.endsWith("]")) {
            // Remove incomplete last entry and close array
            const lastCommaIndex = jsonContent.lastIndexOf(",");
            if (lastCommaIndex > 0) {
              jsonContent = jsonContent.substring(0, lastCommaIndex) + "]";
              try {
                return JSON.parse(jsonContent);
              } catch (fixError) {
                console.error(
                  "Failed to fix incomplete JSON from lines:",
                  fixError
                );
              }
            }
          }
        }
      }

      throw new Error("Could not extract valid JSON from response");
    }
  }

  getMockResponse(userMessage) {
    // Mock responses for when OpenAI is not available
    const mockResponses = [
      "I understand you're asking about your notes. While I can't access the AI service right now, I'd be happy to help you think through this topic. Could you share more specific details?",
      "That's an interesting question about your study material. Since I'm currently in offline mode, I recommend reviewing the relevant sections of your notes and perhaps creating a summary to help consolidate your understanding.",
      "I see you're working through this concept. While I can't provide detailed AI-generated responses at the moment, I suggest breaking down the topic into smaller parts and testing your understanding with practice questions.",
      "Great question! Although the AI chat service is temporarily unavailable, you could try explaining this concept in your own words or connecting it to other topics you've studied.",
      "That's a thoughtful inquiry. In the meantime, consider creating a mind map or outline of the key points in your notes to help organize your understanding.",
    ];

    const randomResponse =
      mockResponses[Math.floor(Math.random() * mockResponses.length)];

    return {
      content: randomResponse,
      tokensUsed: 0,
      noteReferences: [],
    };
  }

  async generateStudyQuestions(
    note,
    questionType = "mixed",
    difficulty = "medium",
    count = 5
  ) {
    try {
      if (!this.openai) {
        return this.getMockStudyQuestions(note, questionType, count);
      }

      const noteContext = this.buildNoteContext(note);

      const prompt = `Based on the following note content, generate ${count} ${questionType} study questions at ${difficulty} difficulty level:

${noteContext}

Question Type: ${questionType}
Difficulty: ${difficulty}
Number of questions: ${count}

Please format the response as a JSON array with the following structure:
[
  {
    "question": "Question text",
    "type": "multiple-choice|short-answer|essay",
    "difficulty": "easy|medium|hard",
    "options": ["A", "B", "C", "D"] // Only for multiple-choice
    "correctAnswer": "A" // Only for multiple-choice
    "points": 5,
    "topic": "Main topic this question covers"
  }
]`;

      const completion = await this.openai.chat.completions.create({
        model: "deepseek/deepseek-r1:free",
        messages: [
          {
            role: "system",
            content:
              "You are an educational AI that creates study questions. Always respond with valid JSON only.",
          },
          {
            role: "user",
            content: prompt,
          },
        ],
        temperature: 0.7,
        max_tokens: 2000,
        extra_body: {},
      });

      const response = completion.choices[0].message.content;

      try {
        return this.extractJsonFromResponse(response);
      } catch (parseError) {
        console.error("Failed to parse AI response as JSON:", parseError);
        console.log("Raw AI response:", response);
        return this.getMockStudyQuestions(note, questionType, count);
      }
    } catch (error) {
      console.error("Generate study questions error:", error);
      return this.getMockStudyQuestions(note, questionType, count);
    }
  }

  getMockStudyQuestions(note, questionType, count) {
    const questions = [];

    for (let i = 0; i < count; i++) {
      if (questionType === "multiple-choice" || questionType === "mixed") {
        questions.push({
          question: `What is the main concept discussed in ${note.title}?`,
          type: "multiple-choice",
          difficulty: "medium",
          options: [
            "Option A - Primary concept",
            "Option B - Secondary concept",
            "Option C - Related topic",
            "Option D - Background information",
          ],
          correctAnswer: "A",
          points: 5,
          topic: note.subject,
        });
      } else if (questionType === "short-answer") {
        questions.push({
          question: `Explain the key points from ${note.title}.`,
          type: "short-answer",
          difficulty: "medium",
          points: 10,
          topic: note.subject,
        });
      } else if (questionType === "essay") {
        questions.push({
          question: `Analyze and discuss the main themes presented in ${note.title}.`,
          type: "essay",
          difficulty: "hard",
          points: 20,
          topic: note.subject,
        });
      }
    }

    return questions;
  }

  async generateConversationStarters(note) {
    try {
      if (!this.openai) {
        return this.getMockConversationStarters(note);
      }

      const noteContext = this.buildNoteContext(note);

      const prompt = `Based on this note content, suggest 5 short conversation starters that would help a student engage with and understand the material better:

${noteContext}

Please provide 5 concise questions or prompts (each under 100 characters) that would:
1. Help review key concepts
2. Encourage deeper thinking
3. Connect to practical applications
4. Test understanding
5. Relate to broader topics

Format as a simple JSON array of strings. Keep each question short and focused.

Example format:
[
  "What are the main concepts in this material?",
  "How does this topic apply in real life?",
  "Can you explain the key differences between X and Y?",
  "Why is this concept important?",
  "How does this relate to other topics you've studied?"
]`;

      const completion = await this.openai.chat.completions.create({
        model: "deepseek/deepseek-r1:free",
        messages: [
          {
            role: "system",
            content:
              "You are an educational AI that creates engaging conversation starters for students. Respond with JSON only.",
          },
          {
            role: "user",
            content: prompt,
          },
        ],
        temperature: 0.8,
        max_tokens: 1000,
        extra_body: {},
      });

      const response = completion.choices[0].message.content;

      try {
        return this.extractJsonFromResponse(response);
      } catch (parseError) {
        console.error(
          "Failed to parse conversation starters response:",
          parseError
        );
        console.log("Raw AI response:", response);
        return this.getMockConversationStarters(note);
      }
    } catch (error) {
      console.error("Generate conversation starters error:", error);
      return this.getMockConversationStarters(note);
    }
  }

  getMockConversationStarters(note) {
    return [
      `What are the main concepts covered in ${note.title}?`,
      `Can you explain the key points from this ${note.subject} material?`,
      `How does this topic relate to other concepts in ${note.subject}?`,
      `What are some practical applications of these ideas?`,
      `Can you help me create practice questions for this material?`,
    ];
  }
}

module.exports = new ChatService();
