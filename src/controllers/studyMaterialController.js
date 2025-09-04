const StudyMaterial = require("../models/StudyMaterial");
const Note = require("../models/Note");
const chatService = require("../services/chatService");
const { validationResult } = require("express-validator");

class StudyMaterialController {
  // Create new study material (MCQ, Summary, Practice Questions)
  async createStudyMaterial(req, res) {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          message: "Validation failed",
          errors: errors.array(),
        });
      }

      const { 
        sourceNoteId, 
        type, 
        generationOptions = {} 
      } = req.body;
      const userId = req.user.id;

      // Validate source note exists and user has access
      const sourceNote = await Note.findOne({ _id: sourceNoteId, userId }).select('title subject originalFile folder extractedText');
      if (!sourceNote) {
        return res.status(404).json({
          success: false,
          message: "Source note not found or access denied",
        });
      }

      let generatedContent;
      let title;

      // Generate content based on type
      switch (type) {
        case "mcq":
          generatedContent = await chatService.generateMCQWithExplanations(
            sourceNote,
            {
              difficulty: generationOptions.difficulty || "medium",
              count: generationOptions.count || 10
            }
          );
          title = StudyMaterialController.generateStudyMaterialTitle(sourceNote, "MCQ");
          break;

        case "summary":
          generatedContent = await chatService.generateNoteSummary(
            sourceNote,
            generationOptions.length || "medium",
            generationOptions.format || "structured"
          );
          title = StudyMaterialController.generateStudyMaterialTitle(sourceNote, "Summary");
          break;

        case "practice":
          generatedContent = await chatService.generateStudyQuestions(
            sourceNote,
            "mixed",
            generationOptions.difficulty || "medium",
            generationOptions.count || 5
          );
          title = StudyMaterialController.generateStudyMaterialTitle(sourceNote, "Practice");
          break;

        default:
          return res.status(400).json({
            success: false,
            message: "Invalid study material type",
          });
      }

      // Create study material record
      const studyMaterial = new StudyMaterial({
        userId,
        sourceNoteId,
        title,
        type,
        subject: sourceNote.subject,
        content: generatedContent,
        metadata: {
          difficulty: generationOptions.difficulty || "medium",
          questionCount: Array.isArray(generatedContent) ? generatedContent.length : 1,
          estimatedTime: StudyMaterialController.calculateEstimatedTime(type, generatedContent),
          format: generationOptions.format || "default",
        },
        generationSettings: {
          aiModel: "deepseek/deepseek-r1:free",
          parameters: generationOptions,
        },
        folder: sourceNote.folder || "",
      });

      await studyMaterial.save();

      // Populate source note details
      await studyMaterial.populate("sourceNoteId", "title subject folder");

      res.status(201).json({
        success: true,
        data: {
          studyMaterial: StudyMaterialController.formatStudyMaterialResponse(studyMaterial),
        },
        message: `${type.toUpperCase()} generated and saved successfully`,
      });

    } catch (error) {
      console.error("Create study material error:", error);
      res.status(500).json({
        success: false,
        message: "Failed to create study material",
        error: error.message,
      });
    }
  }

  // Get user's study materials with filtering and pagination
  async getUserStudyMaterials(req, res) {
    try {
      const userId = req.user.id;
      const {
        type = "all",
        subject,
        page = 1,
        limit = 20,
        sortBy = "createdAt",
        sortOrder = "desc",
        search,
        starred,
        recent,
      } = req.query;

      let query = { userId, status: { $ne: "archived" } };

      // Apply filters
      if (type && type !== "all") {
        query.type = type;
      }

      if (subject) {
        query.subject = subject;
      }

      if (starred === "true") {
        query.isStarred = true;
      }

      if (recent === "true") {
        const dateThreshold = new Date();
        dateThreshold.setDate(dateThreshold.getDate() - 7);
        query["stats.lastAccessed"] = { $gte: dateThreshold };
      }

      if (search) {
        query.$or = [
          { title: { $regex: search, $options: "i" } },
          { subject: { $regex: search, $options: "i" } },
          { "metadata.tags": { $regex: search, $options: "i" } },
        ];
      }

      // Pagination
      const skip = (parseInt(page) - 1) * parseInt(limit);
      const sort = {};
      sort[sortBy] = sortOrder === "desc" ? -1 : 1;

      // Execute query
      const [studyMaterials, totalCount] = await Promise.all([
        StudyMaterial.find(query)
          .sort(sort)
          .populate("sourceNoteId", "title subject folder")
          .limit(parseInt(limit))
          .skip(skip),
        StudyMaterial.countDocuments(query),
      ]);

      // Calculate pagination info
      const totalPages = Math.ceil(totalCount / parseInt(limit));
      const hasNext = parseInt(page) < totalPages;
      const hasPrev = parseInt(page) > 1;

      res.json({
        success: true,
        data: {
          studyMaterials: studyMaterials.map(material => 
            StudyMaterialController.formatStudyMaterialResponse(material)
          ),
          pagination: {
            currentPage: parseInt(page),
            totalPages,
            totalItems: totalCount,
            hasNext,
            hasPrev,
            limit: parseInt(limit),
          },
        },
      });

    } catch (error) {
      console.error("Get user study materials error:", error);
      res.status(500).json({
        success: false,
        message: "Failed to get study materials",
        error: error.message,
      });
    }
  }

  // Get single study material by ID
  async getStudyMaterialById(req, res) {
    try {
      const { id } = req.params;
      const userId = req.user.id;

      const studyMaterial = await StudyMaterial.findOne({
        _id: id,
        userId,
        status: { $ne: "archived" },
      }).populate("sourceNoteId", "title subject folder");

      if (!studyMaterial) {
        return res.status(404).json({
          success: false,
          message: "Study material not found",
        });
      }

      // Increment view count
      await studyMaterial.updateStats(1);

      res.json({
        success: true,
        data: {
          studyMaterial: StudyMaterialController.formatStudyMaterialResponse(studyMaterial),
        },
      });

    } catch (error) {
      console.error("Get study material by ID error:", error);
      res.status(500).json({
        success: false,
        message: "Failed to get study material",
        error: error.message,
      });
    }
  }

  // Update study material
  async updateStudyMaterial(req, res) {
    try {
      const { id } = req.params;
      const userId = req.user.id;
      const updates = req.body;

      const studyMaterial = await StudyMaterial.findOne({
        _id: id,
        userId,
        status: { $ne: "archived" },
      });

      if (!studyMaterial) {
        return res.status(404).json({
          success: false,
          message: "Study material not found",
        });
      }

      // Update allowed fields
      const allowedUpdates = ["title", "folder", "metadata", "isStarred"];
      allowedUpdates.forEach((field) => {
        if (updates[field] !== undefined) {
          if (field === "metadata") {
            studyMaterial.metadata = { ...studyMaterial.metadata, ...updates[field] };
          } else {
            studyMaterial[field] = updates[field];
          }
        }
      });

      await studyMaterial.save();
      await studyMaterial.populate("sourceNoteId", "title subject folder");

      res.json({
        success: true,
        data: {
          studyMaterial: StudyMaterialController.formatStudyMaterialResponse(studyMaterial),
        },
        message: "Study material updated successfully",
      });

    } catch (error) {
      console.error("Update study material error:", error);
      res.status(500).json({
        success: false,
        message: "Failed to update study material",
        error: error.message,
      });
    }
  }

  // Delete study material (soft delete)
  async deleteStudyMaterial(req, res) {
    try {
      const { id } = req.params;
      const userId = req.user.id;

      const studyMaterial = await StudyMaterial.findOne({
        _id: id,
        userId,
        status: { $ne: "archived" },
      });

      if (!studyMaterial) {
        return res.status(404).json({
          success: false,
          message: "Study material not found",
        });
      }

      studyMaterial.status = "archived";
      await studyMaterial.save();

      res.json({
        success: true,
        message: "Study material deleted successfully",
      });

    } catch (error) {
      console.error("Delete study material error:", error);
      res.status(500).json({
        success: false,
        message: "Failed to delete study material",
        error: error.message,
      });
    }
  }

  // Toggle star status
  async toggleStar(req, res) {
    try {
      const { id } = req.params;
      const userId = req.user.id;

      const studyMaterial = await StudyMaterial.findOne({
        _id: id,
        userId,
        status: { $ne: "archived" },
      });

      if (!studyMaterial) {
        return res.status(404).json({
          success: false,
          message: "Study material not found",
        });
      }

      await studyMaterial.toggleStar();
      await studyMaterial.populate("sourceNoteId", "title subject folder");

      res.json({
        success: true,
        data: {
          studyMaterial: StudyMaterialController.formatStudyMaterialResponse(studyMaterial),
        },
        message: `Study material ${studyMaterial.isStarred ? "starred" : "unstarred"}`,
      });

    } catch (error) {
      console.error("Toggle star error:", error);
      res.status(500).json({
        success: false,
        message: "Failed to toggle star",
        error: error.message,
      });
    }
  }

  // Record study session (for score tracking)
  async recordStudySession(req, res) {
    try {
      const { id } = req.params;
      const { score, timeSpent } = req.body;
      const userId = req.user.id;

      const studyMaterial = await StudyMaterial.findOne({
        _id: id,
        userId,
        status: { $ne: "archived" },
      });

      if (!studyMaterial) {
        return res.status(404).json({
          success: false,
          message: "Study material not found",
        });
      }

      // Update stats with score
      await studyMaterial.updateStats(0, score);

      res.json({
        success: true,
        message: "Study session recorded successfully",
        data: {
          averageScore: studyMaterial.stats.averageScore,
          timesCompleted: studyMaterial.stats.timesCompleted,
        },
      });

    } catch (error) {
      console.error("Record study session error:", error);
      res.status(500).json({
        success: false,
        message: "Failed to record study session",
        error: error.message,
      });
    }
  }

  // Get study material statistics
  async getStudyMaterialStats(req, res) {
    try {
      const userId = req.user.id;

      const [typeCounts, subjectCounts, recentActivity] = await Promise.all([
        StudyMaterial.getTypeCounts(userId),
        StudyMaterial.getSubjectCounts(userId),
        StudyMaterial.getRecent(userId, 7),
      ]);

      res.json({
        success: true,
        data: {
          typeCounts: typeCounts.reduce((acc, item) => {
            acc[item._id] = item.count;
            return acc;
          }, {}),
          subjectCounts,
          recentActivity: recentActivity.slice(0, 10).map(material =>
            this.formatStudyMaterialResponse(material)
          ),
        },
      });

    } catch (error) {
      console.error("Get study material stats error:", error);
      res.status(500).json({
        success: false,
        message: "Failed to get statistics",
        error: error.message,
      });
    }
  }

  // Helper methods
  static calculateEstimatedTime(type, content) {
    switch (type) {
      case "mcq":
        const questionCount = Array.isArray(content) ? content.length : 0;
        return `${Math.max(5, Math.ceil(questionCount * 1.5))} min`;
      case "summary":
        return content.readTime || "5 min";
      case "practice":
        const practiceCount = Array.isArray(content) ? content.length : 0;
        return `${Math.max(10, Math.ceil(practiceCount * 3))} min`;
      default:
        return "10 min";
    }
  }

  // Generate study material title based on original filename
  static generateStudyMaterialTitle(sourceNote, materialType) {
    // Priority: User-entered title > Original filename (without extension)
    let baseName;

    if (sourceNote.title && sourceNote.title.trim() && sourceNote.title !== 'Untitled Note') {
      // Use the user-entered title if it's meaningful
      baseName = sourceNote.title.trim();
    } else if (sourceNote.originalFile && sourceNote.originalFile.originalName) {
      // Fall back to original filename without extension
      baseName = sourceNote.originalFile.originalName.replace(/\.[^/.]+$/, "");
    } else {
      // Final fallback
      baseName = 'Study Material';
    }

    // Create title based on material type
    switch (materialType.toLowerCase()) {
      case "mcq":
        return `${baseName} - MCQs`;
      case "summary":
        return `${baseName} - Summary`;
      case "practice":
        return `${baseName} - Practice Questions`;
      default:
        return `${baseName} - ${materialType}`;
    }
  }

  static formatStudyMaterialResponse(studyMaterial) {
    return {
      _id: studyMaterial._id,
      title: studyMaterial.title,
      type: studyMaterial.type,
      subject: studyMaterial.subject,
      folder: studyMaterial.folder,
      content: studyMaterial.content,
      metadata: studyMaterial.metadata,
      stats: studyMaterial.stats,
      isStarred: studyMaterial.isStarred,
      status: studyMaterial.status,
      sourceNote: studyMaterial.sourceNoteId ? {
        _id: studyMaterial.sourceNoteId._id,
        title: studyMaterial.sourceNoteId.title,
        subject: studyMaterial.sourceNoteId.subject,
        folder: studyMaterial.sourceNoteId.folder,
      } : null,
      createdAt: studyMaterial.createdAt,
      updatedAt: studyMaterial.updatedAt,
    };
  }
}

module.exports = new StudyMaterialController();
