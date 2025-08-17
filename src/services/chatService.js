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

  // Generate MCQs specifically with answers and explanations
  async generateMCQWithExplanations(note, options = {}) {
    // Keep these variables in outer scope so catch blocks can use them for fallback
    const { count = 5, difficulty = "medium" } = options;

    try {
      if (!this.openai) {
        return this.getMockMCQs(note, count, difficulty);
      }

      const noteContext = this.buildNoteContext(note);

      const prompt = `Based on the following note content, generate ${count} multiple-choice questions at ${difficulty} difficulty level with detailed explanations:\n\n${noteContext}\n\nRequirements:\n- Generate exactly ${count} multiple-choice questions\n- Each question should have 4 options (A, B, C, D)\n- Include the correct answer\n- Provide detailed explanation for why the correct answer is right\n- Difficulty level: ${difficulty}\n\nPlease format the response as a JSON array with the following structure:\n[\n  {\n    "id": 1,\n    "question": "Question text here?",\n    "options": [\n      "Option A text",\n      "Option B text", \n      "Option C text",\n      "Option D text"\n    ],\n    "correct": 0,\n    "correctAnswer": "A",\n    "explanation": "Detailed explanation of why this is the correct answer and why other options are incorrect.",\n    "difficulty": "${difficulty}",\n    "subject": "${note.subject}",\n    "points": 5,\n    "topic": "Main topic this question covers"\n  }\n]\n\nMake sure all questions are based on the actual content from the notes and explanations are educational and help with learning.`;

      const completion = await this.openai.chat.completions.create({
        model: "deepseek/deepseek-r1:free",
        messages: [
          {
            role: "system",
            content: "You are an educational AI that creates high-quality multiple-choice questions with detailed explanations. Always respond with valid JSON only. Focus on creating questions that test understanding, not just memorization.",
          },
          {
            role: "user",
            content: prompt,
          },
        ],
        temperature: 0.7,
        max_tokens: 3000,
        extra_body: {},
      });

      const response = completion.choices[0].message.content;

      // Use the resilient extractor to handle markdown/code fences and partial JSON
      let questions;
      try {
        questions = this.extractJsonFromResponse(response);
      } catch (parseErr) {
        console.error("Failed to extract JSON for MCQs:", parseErr);
        console.log("Raw AI response:", response);
        return this.getMockMCQs(note, count, difficulty);
      }

      // Ensure proper structure
      return (questions || []).map((q, index) => ({
        id: q.id || index + 1,
        question: q.question,
        options: q.options || [],
        correct: typeof q.correct === 'number' ? q.correct : q.correct || 0,
        correctAnswer: q.correctAnswer || "A",
        explanation: q.explanation || "No explanation provided",
        difficulty: q.difficulty || difficulty,
        subject: q.subject || note.subject,
        points: q.points || 5,
        topic: q.topic || note.title,
      }));

    } catch (error) {
      console.error("Error generating MCQs:", error);
      return this.getMockMCQs(note, count, difficulty);
    }
  }

  // Mock MCQs for when AI is not available
  getMockMCQs(note, count = 5, difficulty = "medium") {
    const questions = [];
    for (let i = 0; i < count; i++) {
      questions.push({
        id: i + 1,
        question: `What is a key concept from "${note.title}"?`,
        options: [
          "Primary concept discussed in the material",
          "Secondary supporting detail",
          "Background information only", 
          "Unrelated information"
        ],
        correct: 0,
        correctAnswer: "A",
        explanation: `This question tests understanding of the main concepts from ${note.title}. Option A is correct because it directly relates to the primary material covered in the notes.`,
        difficulty: difficulty,
        subject: note.subject,
        points: 5,
        topic: note.title
      });
    }
    return questions;
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

  async generateNoteSummary(note, length = "medium", format = "structured") {
    try {
      if (!this.openai) {
        return this.getMockSummary(note, length, format);
      }

      const noteContext = this.buildNoteContext(note);
      
      let lengthInstruction;
      switch (length) {
        case "short":
          lengthInstruction = "Keep the summary concise (2-3 paragraphs max).";
          break;
        case "long":
          lengthInstruction = "Provide a detailed comprehensive summary (5+ paragraphs).";
          break;
        default:
          lengthInstruction = "Create a medium-length summary (3-4 paragraphs).";
      }

      let formatInstruction;
      switch (format) {
        case "bullet-points":
          formatInstruction = "Format the summary as bullet points with clear hierarchical structure.";
          break;
        case "paragraphs":
          formatInstruction = "Format the summary as flowing paragraphs with smooth transitions.";
          break;
        default:
          formatInstruction = "Use a structured format with clear sections, headings, and key points highlighted.";
      }

      const prompt = `Please create a comprehensive summary of the following study material:

${noteContext}

Requirements:
- ${lengthInstruction}
- ${formatInstruction}
- Include key concepts, main topics, and important details
- Highlight critical information that students should remember
- Use clear, academic language appropriate for studying
- If there are formulas, definitions, or important facts, make them prominent
- Structure the content logically for easy review

Please format your response using markdown with proper structure:
- Use ### for main section headings
- Use #### for subsection headings
- Use **bold text** for key terms and concepts
- Use bullet points for lists
- Use numbered lists for processes or steps
- Include relevant emojis to make sections visually distinct
- Add horizontal rules (---) to separate major sections`;

      const completion = await this.openai.chat.completions.create({
        model: "deepseek/deepseek-r1:free",
        messages: [
          {
            role: "system",
            content: "You are an educational AI that creates comprehensive study summaries. Always provide well-structured, informative summaries using proper markdown formatting.",
          },
          {
            role: "user",
            content: prompt,
          },
        ],
        temperature: 0.3, // Lower temperature for more consistent summaries
        max_tokens: 2500,
        extra_body: {},
      });

      const response = completion.choices[0].message.content;
      
      return {
        content: response,
        title: `Summary: ${note.title}`,
        subject: note.subject,
        length: length,
        format: format,
        keyPoints: this.extractKeyPoints(response),
        readTime: this.estimateReadTime(response),
        generatedAt: new Date(),
      };

    } catch (error) {
      console.error("Generate note summary error:", error);
      return this.getMockSummary(note, length, format);
    }
  }

  getMockSummary(note, length, format) {
    const baseContent = `### 📚 Summary of ${note.title}

**Subject:** ${note.subject}

---

#### 🔍 **Key Concepts**

This material covers fundamental concepts in ${note.subject}, providing essential knowledge for understanding the subject matter.

#### 💡 **Main Topics**

- **Primary Topic**: Core concepts and principles
- **Secondary Topics**: Supporting ideas and examples  
- **Applications**: Practical uses and implementations
- **Important Details**: Critical information to remember

---

#### 🛠️ **Study Points**

1. **Definition**: Key terms and their meanings
2. **Process**: Step-by-step procedures or methods
3. **Examples**: Illustrative cases and scenarios
4. **Practice**: Exercises and applications

---

#### 🧩 **Key Takeaways**

- Understanding the fundamental principles is crucial
- Practice with examples reinforces learning
- Regular review helps retention
- Connect concepts to real-world applications

*Note: This is a generated summary. Please refer to the original material for complete details.*`;

    return {
      content: baseContent,
      title: `Summary: ${note.title}`,
      subject: note.subject,
      length: length,
      format: format,
      keyPoints: [
        "Fundamental concepts and principles",
        "Supporting ideas and examples",
        "Practical applications",
        "Critical information to remember"
      ],
      readTime: "5 min",
      generatedAt: new Date(),
    };
  }

  extractKeyPoints(content) {
    const points = [];
    const lines = content.split('\n');
    
    for (const line of lines) {
      const trimmed = line.trim();
      // Extract bullet points
      if (trimmed.startsWith('- **') || trimmed.startsWith('* **')) {
        const point = trimmed.replace(/^[-*]\s*\*\*(.*?)\*\*.*/, '$1');
        if (point && point !== trimmed) {
          points.push(point);
        }
      }
      // Extract numbered points
      else if (trimmed.match(/^\d+\.\s*\*\*(.*?)\*\*/)) {
        const point = trimmed.replace(/^\d+\.\s*\*\*(.*?)\*\*.*/, '$1');
        if (point) {
          points.push(point);
        }
      }
    }
    
    return points.slice(0, 6); // Return max 6 key points
  }

  estimateReadTime(content) {
    const wordsPerMinute = 200; // Average reading speed
    const wordCount = content.split(/\s+/).length;
    const minutes = Math.ceil(wordCount / wordsPerMinute);
    return `${minutes} min`;
  }
}

module.exports = new ChatService();
