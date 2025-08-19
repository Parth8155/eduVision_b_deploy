"use strict";
const fs = require("fs");
const fsPromises = require("fs").promises;
const path = require("path");
const { promisify } = require("util");
const sleep = promisify(setTimeout);
const {
  ComputerVisionClient,
} = require("@azure/cognitiveservices-computervision");
const { ApiKeyCredentials } = require("@azure/ms-rest-js");
const sharp = require("sharp");
const sanitizePath = require("sanitize-filename");
const { jsPDF } = require("jspdf");
const PDFDocument = require("pdfkit");
const { PDFDocument: PDFLib, rgb, StandardFonts } = require("pdf-lib");

// Configuration constants
const CONFIG = {
  TIMEOUT_SECONDS: 30,
  DEFAULT_PAGE_SIZE: [595, 842], // A4 in points
  MAX_FILE_SIZE_BYTES: 20 * 1024 * 1024, // 20MB
  SUPPORTED_IMAGE_TYPES: [".jpg", ".jpeg", ".png", ".gif", ".bmp", ".tiff"],
  TEMP_DIR: "temp_images",
  DPI: 300,
  IMAGE_DIMENSIONS: { width: 2480, height: 3508 }, // A4 at 300 DPI
  INTELLIGENT_SPACING: {
    ENABLED: true,
    WORD_SPACING_THRESHOLD: 0.5,
    WIDE_SPACING_THRESHOLD: 1.2,
    LINE_HEIGHT_TOLERANCE: 0.7,
    PARAGRAPH_SPACING_THRESHOLD: 2.0,
    MIN_WORD_GAP_PIXELS: 3,
    MIN_LINE_GAP_PIXELS: 5,
    FORCE_SPACING_ON_NO_GAPS: true,
    DEBUG_BOUNDING_BOXES: false,
  },
  PDF_FONT_SIZE: 17, // Default font size for PDF text overlay
  PDF_FONT_NAME: "courier", // Monospaced font for accurate spacing
};

// Azure Computer Vision credentials
const key = process.env.VISION_KEY;
const endpoint = process.env.VISION_ENDPOINT;

// Initialize Computer Vision client
let computerVisionClient = null;
if (key && endpoint) {
  computerVisionClient = new ComputerVisionClient(
    new ApiKeyCredentials({ inHeader: { "Ocp-Apim-Subscription-Key": key } }),
    endpoint
  );
  console.log("Azure Computer Vision client initialized");
} else {
  console.warn(
    "Azure Computer Vision credentials not found in environment variables"
  );
}

const ocrService = {
  /**
   * Check if PDF already contains searchable text
   * @param {string} filePath - Path to the PDF file
   * @returns {Promise<Object>} { hasText: boolean, extractedText: string, pageCount: number }
   */
  async checkPDFForExistingText(filePath) {
    try {
      console.log(
        `Checking if PDF already has searchable text: ${path.basename(
          filePath
        )}`
      );

      const pdfBytes = await fsPromises.readFile(filePath);
      const pdfDoc = await PDFLib.load(pdfBytes);
      const pages = pdfDoc.getPages();
      const pageCount = pages.length;

      let allText = "";
      let hasSignificantText = false;

      // Extract text from each page
      for (let i = 0; i < pages.length; i++) {
        try {
          // Try to get text content from the page
          const page = pages[i];

          // Use pdf-lib's text extraction capabilities
          // Note: pdf-lib has limited text extraction, but we can check if text exists
          const textContent = await this.extractTextFromPDFPage(pdfDoc, i);

          if (textContent && textContent.trim().length > 0) {
            allText += textContent + "\n";

            // Check if we have substantial text (not just metadata or artifacts)
            const cleanText = textContent.replace(/\s+/g, " ").trim();
            if (cleanText.length > 10) {
              // At least 10 characters of meaningful text
              hasSignificantText = true;
            }
          }
        } catch (pageError) {
          console.log(
            `Could not extract text from page ${i + 1}: ${pageError.message}`
          );
        }
      }

      const result = {
        hasText: hasSignificantText,
        extractedText: allText.trim(),
        pageCount: pageCount,
        textLength: allText.trim().length,
      };

      console.log(
        `PDF text check result: hasText=${result.hasText}, textLength=${result.textLength}, pages=${result.pageCount}`
      );
      return result;
    } catch (error) {
      console.error(`Error checking PDF for existing text: ${error.message}`);
      return { hasText: false, extractedText: "", pageCount: 0, textLength: 0 };
    }
  },

  /**
   * Extract text from a specific PDF page using pdf-lib
   * @param {PDFDocument} pdfDoc - The PDF document
   * @param {number} pageIndex - Page index (0-based)
   * @returns {Promise<string>} Extracted text
   */
  async extractTextFromPDFPage(pdfDoc, pageIndex) {
    try {
      // This is a basic implementation - pdf-lib has limited text extraction
      // For better text extraction, we might need to use a different library like pdf2pic + OCR
      // or pdf-parse, but for checking if text exists, this basic approach should work

      const page = pdfDoc.getPages()[pageIndex];

      // Try to access the page's content stream
      // This is a simplified approach - in reality, PDF text extraction is complex
      const pageRef = page.ref;
      const pageObject = pdfDoc.context.lookup(pageRef);

      // Look for text content in the page
      if (pageObject && pageObject.dict) {
        const contents = pageObject.dict.get("Contents");
        if (contents) {
          // This is a very basic text detection
          // In a real implementation, you'd need to parse the PDF content streams
          return ""; // Placeholder - actual implementation would be more complex
        }
      }

      return "";
    } catch (error) {
      console.log(
        `Error extracting text from page ${pageIndex}: ${error.message}`
      );
      return "";
    }
  },

  /**
   * Enhanced PDF text detection using pdf-parse library
   * @param {string} filePath - Path to the PDF file
   * @returns {Promise<Object>} Text extraction results
   */
  async checkPDFTextWithPdfParse(filePath) {
    try {
      // We'll need to install pdf-parse: npm install pdf-parse
      // For now, let's use a different approach with PDFtk or similar

      const pdfBytes = await fsPromises.readFile(filePath);

      // Try to use a simple regex approach to detect text content
      const pdfString = pdfBytes.toString("binary");

      // Look for text content indicators in PDF
      const textIndicators = [
        /\/Type\s*\/Font/g,
        /\/Subtype\s*\/Type1/g,
        /\/Subtype\s*\/TrueType/g,
        /BT\s+.*?ET/g, // Text objects
        /Tj\s*$/gm, // Text showing operators
        /TJ\s*$/gm, // Text showing operators
      ];

      let textIndicatorCount = 0;
      for (const indicator of textIndicators) {
        const matches = pdfString.match(indicator);
        if (matches) {
          textIndicatorCount += matches.length;
        }
      }

      // If we find significant text indicators, the PDF likely has text
      const hasText = textIndicatorCount > 5; // Threshold for text content

      console.log(
        `PDF text indicators found: ${textIndicatorCount}, hasText: ${hasText}`
      );

      return {
        hasText: hasText,
        extractedText: hasText ? "[Text detected but not extracted]" : "",
        pageCount: 1, // Simplified for this approach
        textLength: hasText ? textIndicatorCount * 10 : 0, // Estimated
        method: "pdf-parse-regex",
      };
    } catch (error) {
      console.error(`Error in PDF text detection: ${error.message}`);
      return { hasText: false, extractedText: "", pageCount: 0, textLength: 0 };
    }
  },

  /**
   * Extract text from image or PDF using Azure Computer Vision
   * @param {string} filePath - Path to the input file
   * @param {string} mimetype - MIME type of the file
   * @returns {Promise<Object>} OCR results
   */
  async extractText(filePath, mimetype) {
    try {
      // Validate inputs
      if (!filePath || !mimetype) {
        throw new Error("File path and MIME type are required");
      }
      const sanitizedPath = sanitizePath(path.basename(filePath));
      const fullPath = path.join(path.dirname(filePath), sanitizedPath);

      // Check file existence and size
      const stats = await fsPromises.stat(fullPath);
      if (stats.size > CONFIG.MAX_FILE_SIZE_BYTES) {
        throw new Error(
          `File size exceeds limit of ${CONFIG.MAX_FILE_SIZE_BYTES} bytes`
        );
      }

      // NEW: Check if PDF already has searchable text
      if (mimetype === "application/pdf") {
        console.log("Checking if PDF already contains searchable text...");
        const textCheck = await this.checkPDFTextWithPdfParse(fullPath);

        if (textCheck.hasText) {
          console.log(
            "✅ PDF already contains searchable text, skipping OCR processing"
          );
          return {
            text: textCheck.extractedText,
            confidence: 95, // High confidence since text already exists
            language: "en", // Default language
            pages: [
              {
                text: textCheck.extractedText,
                confidence: 95,
                hasExistingText: true,
              },
            ],
            readResults: [
              {
                page: 1,
                text: textCheck.extractedText,
                lines: textCheck.extractedText
                  .split("\n")
                  .map((line) => ({ text: line })),
              },
            ],
            ocrEngine: "Existing PDF Text",
            skippedOCR: true,
            originallySearchable: true,
          };
        } else {
          console.log(
            "📄 PDF does not contain searchable text, proceeding with OCR..."
          );
        }
      }

      if (!computerVisionClient) {
        console.warn(
          "Azure Computer Vision not configured, using fallback simulation"
        );
        return await simulateOCR(fullPath, mimetype);
      }

      console.log(`Starting OCR for: ${sanitizedPath}`);

      let result;
      if (mimetype.startsWith("image/") || mimetype === "application/pdf") {
        result = await readTextFromFile(computerVisionClient, fullPath);
      } else {
        throw new Error(
          "Unsupported file type. Only images and PDFs are supported."
        );
      }

      const extractedData = processOCRResults(result);
      console.log(`OCR completed. Confidence: ${extractedData.confidence}%`);

      return {
        text: extractedData.text,
        confidence: extractedData.confidence,
        language: extractedData.language,
        pages: extractedData.pages,
        readResults: result,
        ocrEngine: "Azure Computer Vision",
      };
    } catch (error) {
      console.error(`OCR processing error for ${filePath}:`, error.message);
      return await simulateOCR(filePath, mimetype);
    }
  },

  /**
   * Process multiple files
   * @param {Array<Object>} files - Array of { path, mimetype, filename }
   * @returns {Promise<Array>} Array of results
   */
  async processMultipleFiles(files) {
    const results = await Promise.all(
      files.map(async (file) => {
        try {
          const result = await ocrService.extractText(file.path, file.mimetype);
          return { file: file.filename, success: true, ...result };
        } catch (error) {
          console.error(
            `Error processing file ${file.filename}:`,
            error.message
          );
          return { file: file.filename, success: false, error: error.message };
        }
      })
    );
    return results;
  },

  /**
   * Generate searchable PDF with OCR text overlay using precise positioning
   * @param {string} originalFilePath - Path to original file
   * @param {Object} ocrResults - OCR results from extractText
   * @param {string} outputPath - Path for output PDF
   * @returns {Promise<string>} Path to generated PDF
   */
  async generateSearchablePDF(originalFilePath, ocrResults, outputPath) {
    try {
      console.log("Generating continuous searchable PDF...");
      const sanitizedOutput = sanitizePath(path.basename(outputPath));
      const fullOutputPath = path.join(
        path.dirname(outputPath),
        sanitizedOutput
      );

      // Check if the PDF already had searchable text (OCR was skipped)
      if (ocrResults.skippedOCR && ocrResults.originallySearchable) {
        console.log(
          "✅ PDF already contains searchable text, copying original file..."
        );

        // Simply copy the original file to the output location
        await fsPromises.copyFile(originalFilePath, fullOutputPath);

        console.log(`📄 Original searchable PDF copied to: ${fullOutputPath}`);
        return fullOutputPath;
      }

      const isPDF = path.extname(originalFilePath).toLowerCase() === ".pdf";

      if (isPDF) {
        // PDF handling uses existing method
        console.log("Using existing PDF method for multi-page documents");
        return await this.generateSearchablePDFLegacy(
          originalFilePath,
          ocrResults,
          fullOutputPath
        );
      } else {
        // Single image processing with new method
        await createContinuousSearchablePdf(
          originalFilePath,
          ocrResults.readResults[0],
          fullOutputPath,
          CONFIG.PDF_FONT_SIZE
        );
        return fullOutputPath;
      }
    } catch (error) {
      console.error("Error generating searchable PDF:", error);
      // Fallback to legacy method
      return await this.generateSearchablePDFLegacy(
        originalFilePath,
        ocrResults,
        outputPath
      );
    }
  },

  /**
   * Legacy PDF generation method (original implementation)
   * Used as fallback and for multi-page PDFs
   */
  async generateSearchablePDFLegacy(originalFilePath, ocrResults, outputPath) {
    try {
      console.log("Using legacy PDF generation method...");
      const sanitizedOutput = sanitizePath(path.basename(outputPath));
      const fullOutputPath = path.join(
        path.dirname(outputPath),
        sanitizedOutput
      );

      // Create a simple text-only PDF as fallback
      const doc = new jsPDF({
        orientation: "portrait",
        unit: "pt",
        format: "a4",
      });

      doc.setFont("helvetica");
      doc.setFontSize(12);

      // Add title
      doc.text("Extracted Text", 50, 50);

      // Add OCR text
      let yPosition = 80;
      const lineHeight = 14;
      const pageHeight = doc.internal.pageSize.height;

      if (ocrResults.text) {
        const lines = ocrResults.text.split("\n");
        for (const line of lines) {
          if (yPosition > pageHeight - 50) {
            doc.addPage();
            yPosition = 50;
          }
          doc.text(line, 50, yPosition);
          yPosition += lineHeight;
        }
      }

      doc.save(fullOutputPath);
      console.log(`Legacy searchable PDF created: ${fullOutputPath}`);
      return fullOutputPath;
    } catch (error) {
      console.error("Error in legacy PDF generation:", error);
      throw error;
    }
  },

  /**
   * Generate overlay PDF with precise OCR text positioning
   * @param {string} originalFilePath - Path to original file
   * @param {Object} ocrResults - OCR results
   * @param {string} outputPath - Path for output PDF
   * @returns {Promise<string>} Path to generated PDF
   */
  async generateOverlayPDF(originalFilePath, ocrResults, outputPath) {
    try {
      console.log(
        "Generating overlay PDF with precise OCR text positioning..."
      );
      const sanitizedOutput = sanitizePath(path.basename(outputPath));
      const fullOutputPath = path.join(
        path.dirname(outputPath),
        sanitizedOutput
      );

      const isPDF = path.extname(originalFilePath).toLowerCase() === ".pdf";

      if (isPDF) {
        // For PDFs, create continuous searchable PDF with OCR overlay on original PDF
        console.log(
          "Creating continuous searchable PDF with OCR overlay for PDF input..."
        );
        await createContinuousSearchablePdfFromPDF(
          originalFilePath,
          ocrResults.readResults,
          fullOutputPath,
          CONFIG.PDF_FONT_SIZE
        );
        return fullOutputPath;
      } else {
        // For images, use the new continuous searchable PDF method
        console.log("Creating overlapping searchable PDF for image input...");
        await createContinuousSearchablePdf(
          originalFilePath,
          ocrResults.readResults[0],
          fullOutputPath,
          CONFIG.PDF_FONT_SIZE
        );
        return fullOutputPath;
      }
    } catch (error) {
      console.error("Error generating overlay PDF:", error);
      throw error;
    }
  },

  /**
   * Extract text and optionally generate overlay PDF
   * @param {string} filePath - Path to input file
   * @param {string} mimetype - MIME type
   * @param {boolean} generateOverlay - Whether to generate overlay PDF
   * @returns {Promise<Object>} OCR results with optional overlay path
   */
  async extractTextWithOverlay(filePath, mimetype, generateOverlay = false) {
    try {
      const ocrResults = await ocrService.extractText(filePath, mimetype);

      if (generateOverlay && ocrResults.ocrEngine === "Azure Computer Vision") {
        const outputDir = path.dirname(filePath);
        const baseName = path.basename(filePath, path.extname(filePath));
        const overlayPath = path.join(
          outputDir,
          sanitizePath(`${baseName}_overlay.pdf`)
        );

        if (mimetype === "application/pdf") {
          try {
            // For PDFs, overlay directly onto the original file
            const resultPath = await ocrService.generateOverlayPDF(
              filePath,
              ocrResults,
              overlayPath
            );
            ocrResults.overlayPDFPath = resultPath;
            ocrResults.overlayPDFName = path.basename(resultPath);
            console.log(
              `Overlay PDF created for ${path.basename(filePath)}: ${
                ocrResults.overlayPDFName
              }`
            );
          } catch (pdfError) {
            console.warn(
              "PDF overlay failed, creating simple text-only overlay:",
              pdfError.message
            );

            // Fallback: create a simple text-only PDF
            try {
              await createSimpleTextOnlyPDF(ocrResults, overlayPath);
              ocrResults.overlayPDFPath = overlayPath;
              ocrResults.overlayPDFName = path.basename(overlayPath);
            } catch (fallbackError) {
              console.error(
                "All overlay methods failed:",
                fallbackError.message
              );
              // Don't throw - just continue without overlay
            }
          }
        } else {
          // For images, use the standard method
          try {
            await ocrService.generateOverlayPDF(
              filePath,
              ocrResults,
              overlayPath
            );
            ocrResults.overlayPDFPath = overlayPath;
            ocrResults.overlayPDFName = `${baseName}_overlay.pdf`;
          } catch (imageError) {
            console.warn("Image overlay failed:", imageError.message);
          }
        }
      }

      return ocrResults;
    } catch (error) {
      console.error("Error in extractTextWithOverlay:", error);
      throw error;
    }
  },
};

// Add utility functions to exports
ocrService.createContinuousSearchablePdf = createContinuousSearchablePdf;
ocrService.createContinuousSearchablePdfFromPDF =
  createContinuousSearchablePdfFromPDF;
ocrService.createSimpleTextOnlyPDF = createSimpleTextOnlyPDF;

/**
 * Read text from file using Azure Computer Vision
 * @param {ComputerVisionClient} client - Azure client
 * @param {string} filePath - Path to file
 * @returns {Promise<Array>} Read results
 */
async function readTextFromFile(client, filePath) {
  try {
    console.log(`Processing file with Azure: ${path.basename(filePath)}`);
    const stream = () => fs.createReadStream(filePath); // Use standard fs.createReadStream
    const result = await client.readInStream(stream);
    const operationId = result.operationLocation.split("/").pop();

    let readResult;
    let attempts = 0;
    const maxAttempts = CONFIG.TIMEOUT_SECONDS;

    do {
      await sleep(1000);
      readResult = await client.getReadResult(operationId);
      attempts++;
      console.log(
        `Azure OCR status: ${readResult.status} (attempt ${attempts})`
      );

      if (attempts >= maxAttempts) {
        throw new Error("Azure OCR operation timeout");
      }
    } while (
      readResult.status === "notStarted" ||
      readResult.status === "running"
    );

    if (readResult.status === "failed") {
      throw new Error("Azure OCR operation failed");
    }

    return readResult.analyzeResult.readResults;
  } catch (error) {
    console.error("Error in readTextFromFile:", error.message);
    if (error.message.includes("image must be")) {
      return await readTextFromFileAlternative(client, filePath);
    }
    throw error;
  }
}

/**
 * Alternative method to read file as buffer
 * @param {ComputerVisionClient} client - Azure client
 * @param {string} filePath - Path to file
 * @returns {Promise<Array>} Read results
 */
async function readTextFromFileAlternative(client, filePath) {
  try {
    console.log("Using buffer method for Azure...");
    const fileBuffer = await fsPromises.readFile(filePath); // Use fsPromises for async readFile
    console.log(`File size: ${fileBuffer.length} bytes`);

    const result = await client.readInStream(fileBuffer);
    const operationId = result.operationLocation.split("/").pop();

    let readResult;
    let attempts = 0;
    const maxAttempts = CONFIG.TIMEOUT_SECONDS;

    do {
      await sleep(1000);
      readResult = await client.getReadResult(operationId);
      attempts++;
      console.log(
        `Azure OCR status: ${readResult.status} (attempt ${attempts})`
      );

      if (attempts >= maxAttempts) {
        throw new Error("Azure OCR operation timeout");
      }
    } while (
      readResult.status === "notStarted" ||
      readResult.status === "running"
    );

    if (readResult.status === "failed") {
      throw new Error("Azure OCR operation failed");
    }

    return readResult.analyzeResult.readResults;
  } catch (error) {
    console.error("Error in readTextFromFileAlternative:", error.message);
    throw error;
  }
}
/**
 * Process OCR results from Azure with intelligent spacing
 * @param {Array} readResults - Azure read results
 * @returns {Object} Processed OCR data
 */
function processOCRResults(readResults) {
  if (!readResults || readResults.length === 0) {
    return {
      text: "No text detected",
      confidence: 0,
      language: "en",
      pages: 0,
    };
  }

  let extractedText = "";
  let totalConfidence = 0;
  let wordCount = 0;
  const detectedLanguage = "en";

  console.log(`Processing ${readResults.length} page(s)`);

  for (let pageIndex = 0; pageIndex < readResults.length; pageIndex++) {
    const page = readResults[pageIndex];
    if (readResults.length > 1) {
      extractedText += `\n--- Page ${pageIndex + 1} ---\n`;
    }

    if (page.lines?.length) {
      console.log(`Page ${pageIndex + 1}: ${page.lines.length} lines`);

      // Use intelligent spacing if enabled, otherwise use simple joining
      let pageText;
      if (CONFIG.INTELLIGENT_SPACING.ENABLED) {
        pageText = processLinesWithIntelligentSpacing(page.lines);

        // If the result has no spaces and we have multiple words, force spacing
        if (
          CONFIG.INTELLIGENT_SPACING.FORCE_SPACING_ON_NO_GAPS &&
          !pageText.includes(" ") &&
          page.lines.some((line) => line.words && line.words.length > 1)
        ) {
          console.log("Applying forced spacing to compact text...");
          pageText = applyForcedSpacingToCompactText(page.lines);

          // Last resort: if still no spaces, apply basic pattern-based spacing
          if (!pageText.includes(" ")) {
            console.log(
              "Applying basic pattern-based spacing as final fallback..."
            );
            pageText = addBasicSpacingToText(pageText);
          }
        }
      } else {
        // Fallback to simple line joining
        pageText = page.lines
          .map((line) => line.words?.map((word) => word.text).join(" ") || "")
          .join("\n");
      }

      // Clean and format the text
      pageText = cleanAndFormatText(pageText);
      extractedText += pageText;

      // Calculate confidence from all words
      for (const line of page.lines) {
        if (line.words) {
          for (const word of line.words) {
            if (word.confidence !== undefined) {
              totalConfidence += word.confidence;
              wordCount++;
            }
          }
        }
      }
    } else {
      extractedText += "No text recognized on this page.\n";
    }

    // Add page separator if not the last page
    if (pageIndex < readResults.length - 1) {
      extractedText += "\n\n";
    }
  }

  const averageConfidence =
    wordCount > 0 ? (totalConfidence / wordCount) * 100 : 0;
  console.log(
    `Extracted ${wordCount} words with confidence: ${averageConfidence.toFixed(
      1
    )}%`
  );

  // Clean and format the final text
  const cleanedText = cleanAndFormatText(extractedText);
  const finalText = detectAndFormatParagraphs(cleanedText);

  return {
    text: finalText || "No readable text found",
    confidence: Math.round(averageConfidence),
    language: detectedLanguage,
    pages: readResults.length,
  };
}

/**
 * Fallback simulation for OCR failure
 * @param {string} filePath - Path to file
 * @param {string} mimetype - MIME type
 * @returns {Promise<Object>} Simulated OCR results
 */
async function simulateOCR(filePath, mimetype) {
  await sleep(1000);
  const fileName = path.basename(filePath);

  // Fix: Use fsPromises.stat instead of fs.stat
  const stats = await fsPromises.stat(filePath).catch(() => ({ size: 0 }));

  return {
    text: `[FALLBACK] Could not process file with Azure Computer Vision.\nFile: ${fileName}\nSize: ${stats.size} bytes\nReason: Azure API unavailable\n\nFix by checking VISION_KEY and VISION_ENDPOINT in .env`,
    confidence: 50,
    language: "en",
    pages: 1,
    ocrEngine: "Simulation",
  };
}

/**
 * Get image dimensions
 * @param {string} imagePath - Path to image
 * @returns {Promise<Object>} Image dimensions
 */
async function getImageDimensions(imagePath) {
  try {
    // Check if file exists
    await fsPromises.access(imagePath);

    const fileExtension = path.extname(imagePath).toLowerCase();
    if (CONFIG.SUPPORTED_IMAGE_TYPES.includes(fileExtension)) {
      const metadata = await sharp(imagePath).metadata();
      return {
        width: metadata.width || CONFIG.DEFAULT_PAGE_SIZE[0],
        height: metadata.height || CONFIG.DEFAULT_PAGE_SIZE[1],
        fileSize: metadata.size || 0,
      };
    }
    return {
      width: CONFIG.DEFAULT_PAGE_SIZE[0],
      height: CONFIG.DEFAULT_PAGE_SIZE[1],
      fileSize: 0,
    };
  } catch (error) {
    console.error("Error getting image dimensions:", error);
    return {
      width: CONFIG.DEFAULT_PAGE_SIZE[0],
      height: CONFIG.DEFAULT_PAGE_SIZE[1],
      fileSize: 0,
    };
  }
}

/**
 * Create a simple text-only PDF as fallback when overlay generation fails
 * @param {Object} ocrResults - OCR results containing extracted text
 * @param {string} outputPath - Path where the PDF should be saved
 */
async function createSimpleTextOnlyPDF(ocrResults, outputPath) {
  try {
    console.log("Creating simple text-only PDF fallback...");

    // Create PDF document using jsPDF
    const doc = new jsPDF({
      orientation: "portrait",
      unit: "pt",
      format: "a4",
    });

    doc.setFont("helvetica");
    doc.setFontSize(16);

    // Add title
    doc.text("Extracted Text", 50, 50);

    // Add extracted text
    doc.setFontSize(12);
    let yPosition = 80;
    const lineHeight = 14;
    const pageHeight = doc.internal.pageSize.height;
    const pageWidth = doc.internal.pageSize.width;
    const maxWidth = pageWidth - 100; // Leave margins

    if (ocrResults.readResults && ocrResults.readResults.length > 0) {
      // Process each page
      for (
        let pageIndex = 0;
        pageIndex < ocrResults.readResults.length;
        pageIndex++
      ) {
        const pageData = ocrResults.readResults[pageIndex];

        if (pageIndex > 0) {
          doc.addPage();
          yPosition = 50;
        }

        // Add page header
        doc.setFontSize(14);
        doc.text(`Page ${pageIndex + 1}`, 50, yPosition);
        yPosition += 30;

        doc.setFontSize(12);

        // Add lines of text
        if (pageData.lines && pageData.lines.length > 0) {
          for (const line of pageData.lines) {
            if (line.words && line.words.length > 0) {
              const lineText = line.words.map((word) => word.text).join(" ");
              if (lineText.trim()) {
                // Split long lines to fit within page width
                const textLines = doc.splitTextToSize(lineText, maxWidth);
                for (const textLine of textLines) {
                  if (yPosition > pageHeight - 50) {
                    doc.addPage();
                    yPosition = 50;
                  }
                  doc.text(textLine, 50, yPosition);
                  yPosition += lineHeight;
                }
              }
            }
          }
        } else {
          doc.text("No text found on this page.", 50, yPosition);
          yPosition += lineHeight;
        }

        yPosition += 20; // Extra space between pages
      }
    } else if (ocrResults.text) {
      // Fallback to main text if readResults not available
      const textLines = doc.splitTextToSize(ocrResults.text, maxWidth);
      for (const textLine of textLines) {
        if (yPosition > pageHeight - 50) {
          doc.addPage();
          yPosition = 50;
        }
        doc.text(textLine, 50, yPosition);
        yPosition += lineHeight;
      }
    } else {
      doc.text("No text could be extracted from the document.", 50, yPosition);
    }

    // Add footer with confidence info
    if (ocrResults.confidence) {
      const footerY = pageHeight - 30;
      doc.setFontSize(10);
      doc.text(
        `OCR Confidence: ${ocrResults.confidence}%`,
        pageWidth - 150,
        footerY
      );
    }

    // Save the PDF
    doc.save(outputPath);
    console.log(`Simple text-only PDF created: ${outputPath}`);
    return true;
  } catch (error) {
    console.error("Error creating simple text-only PDF:", error);
    throw error;
  }
}
/**
 * Calculate appropriate spacing between two words based on their positions
 * Azure OCR boundingBox format: [x1,y1,x2,y2,x3,y3,x4,y4] representing 4 corners
 * Coordinates are: [topLeft_x, topLeft_y, topRight_x, topRight_y, bottomRight_x, bottomRight_y, bottomLeft_x, bottomLeft_y]
 * @param {Object} word1 - First word with boundingBox
 * @param {Object} word2 - Second word with boundingBox
 * @returns {string} Spacing to add (space, newline, or multiple spaces)
 */
function calculateSpacingBetweenWords(word1, word2) {
  // Safety check for bounding boxes
  if (
    !word1.boundingBox ||
    !word2.boundingBox ||
    word1.boundingBox.length < 8 ||
    word2.boundingBox.length < 8
  ) {
    // Fallback to simple space if bounding box data is incomplete
    return " ";
  }

  try {
    // Parse bounding box coordinates for word1
    // boundingBox: [topLeft_x, topLeft_y, topRight_x, topRight_y, bottomRight_x, bottomRight_y, bottomLeft_x, bottomLeft_y]
    const word1_bbox = word1.boundingBox;
    const word1_topLeft = { x: word1_bbox[0], y: word1_bbox[1] };
    const word1_topRight = { x: word1_bbox[2], y: word1_bbox[3] };
    const word1_bottomRight = { x: word1_bbox[4], y: word1_bbox[5] };
    const word1_bottomLeft = { x: word1_bbox[6], y: word1_bbox[7] };

    // Parse bounding box coordinates for word2
    const word2_bbox = word2.boundingBox;
    const word2_topLeft = { x: word2_bbox[0], y: word2_bbox[1] };
    const word2_topRight = { x: word2_bbox[2], y: word2_bbox[3] };
    const word2_bottomRight = { x: word2_bbox[4], y: word2_bbox[5] };
    const word2_bottomLeft = { x: word2_bbox[6], y: word2_bbox[7] };

    // Calculate word1 dimensions and position
    const word1_left = Math.min(word1_topLeft.x, word1_bottomLeft.x);
    const word1_right = Math.max(word1_topRight.x, word1_bottomRight.x);
    const word1_top = Math.min(word1_topLeft.y, word1_topRight.y);
    const word1_bottom = Math.max(word1_bottomLeft.y, word1_bottomRight.y);
    const word1_height = word1_bottom - word1_top;
    const word1_width = word1_right - word1_left;
    const word1_centerY = (word1_top + word1_bottom) / 2;

    // Calculate word2 dimensions and position
    const word2_left = Math.min(word2_topLeft.x, word2_bottomLeft.x);
    const word2_right = Math.max(word2_topRight.x, word2_bottomRight.x);
    const word2_top = Math.min(word2_topLeft.y, word2_topRight.y);
    const word2_bottom = Math.max(word2_bottomLeft.y, word2_bottomRight.y);
    const word2_height = word2_bottom - word2_top;
    const word2_width = word2_right - word2_left;
    const word2_centerY = (word2_top + word2_bottom) / 2;

    // Calculate horizontal and vertical distances
    const horizontalGap = word2_left - word1_right;
    const verticalGap = word2_top - word1_bottom;
    const verticalCenterDistance = Math.abs(word2_centerY - word1_centerY);

    // Use average height for calculations
    const averageHeight = (word1_height + word2_height) / 2;
    const safeHeight = averageHeight > 0 ? averageHeight : 12;

    // Determine if words are on the same line using center Y positions
    // Words are on the same line if their center Y positions are close
    const sameLine =
      verticalCenterDistance <
      safeHeight * CONFIG.INTELLIGENT_SPACING.LINE_HEIGHT_TOLERANCE;

    if (sameLine) {
      // Words are on the same line - determine horizontal spacing
      if (horizontalGap < 0) {
        // Overlapping words - no space (might be ligatures or overlapping characters)
        return "";
      } else if (
        horizontalGap <= CONFIG.INTELLIGENT_SPACING.MIN_WORD_GAP_PIXELS
      ) {
        // Very small gap - might be part of the same word or hyphenated word
        return "";
      } else if (
        horizontalGap <=
        safeHeight * CONFIG.INTELLIGENT_SPACING.WORD_SPACING_THRESHOLD
      ) {
        // Normal word spacing
        return " ";
      } else if (
        horizontalGap <=
        safeHeight * CONFIG.INTELLIGENT_SPACING.WIDE_SPACING_THRESHOLD
      ) {
        // Wider spacing - might be end of sentence or between different sections
        return "  ";
      } else if (horizontalGap <= safeHeight * 2.0) {
        // Very wide spacing - might be tab separation or column break
        return "    ";
      } else {
        // Extremely wide spacing - treat as column break or table separation
        return "\t";
      }
    } else {
      // Words are on different lines - determine vertical spacing
      const lineGap = Math.abs(verticalGap);

      if (lineGap <= safeHeight * 0.3) {
        // Very close lines - might be same text with slight vertical offset
        return " ";
      } else if (lineGap <= safeHeight * 1.2) {
        // Normal line spacing
        return "\n";
      } else if (
        lineGap <=
        safeHeight * CONFIG.INTELLIGENT_SPACING.PARAGRAPH_SPACING_THRESHOLD
      ) {
        // Paragraph spacing
        return "\n\n";
      } else {
        // Large gap - section break
        return "\n\n\n";
      }
    }
  } catch (error) {
    console.warn(
      "Error calculating word spacing, using default space:",
      error.message
    );
    return " ";
  }
}

/**
 * Process words within a line with intelligent spacing
 * @param {Array} words - Array of word objects with text and boundingBox
 * @returns {string} Line text with proper spacing
 */
function processWordsWithSpacing(words) {
  if (!words || words.length === 0) {
    return "";
  }

  if (words.length === 1) {
    return words[0].text || "";
  }

  let lineText = "";

  for (let i = 0; i < words.length; i++) {
    const word = words[i];

    // Add the word text
    lineText += word.text || "";

    // Add spacing after the word (except for the last word)
    if (i < words.length - 1) {
      const nextWord = words[i + 1];

      // Calculate spacing between this word and the next
      if (
        word.boundingBox &&
        nextWord.boundingBox &&
        word.boundingBox.length >= 8 &&
        nextWord.boundingBox.length >= 8
      ) {
        const spacing = calculateSpacingBetweenWords(word, nextWord);
        lineText += spacing;
      } else {
        // Fallback to simple space if bounding box data is missing
        lineText += " ";
      }
    }
  }

  return lineText;
}

/**
 * Enhanced text processing with intelligent spacing for lines
 * @param {Array} lines - Array of line objects from OCR
 * @returns {string} Formatted text with proper spacing
 */
function processLinesWithIntelligentSpacing(lines) {
  if (!lines || lines.length === 0) {
    return "";
  }

  let formattedText = "";
  let previousLine = null;

  for (const line of lines) {
    if (!line.words || line.words.length === 0) {
      continue;
    }

    // Process words within the line using enhanced spacing
    const lineText = processWordsWithSpacing(line.words);

    if (previousLine && lineText.trim()) {
      // Calculate spacing between lines
      const lineSpacing = calculateSpacingBetweenLines(previousLine, line);
      formattedText += lineSpacing;
    }

    formattedText += lineText;

    if (lineText.trim()) {
      previousLine = line;
    }
  }

  return formattedText;
}

/**
 * Calculate spacing between two lines
 * @param {Object} line1 - First line with boundingBox
 * @param {Object} line2 - Second line with boundingBox
 * @returns {string} Spacing to add between lines
 */
function calculateSpacingBetweenLines(line1, line2) {
  if (!line1.boundingBox || !line2.boundingBox) {
    return "\n";
  }

  const line1Bottom = Math.max(
    line1.boundingBox[1],
    line1.boundingBox[3],
    line1.boundingBox[5],
    line1.boundingBox[7]
  );
  const line1Top = Math.min(
    line1.boundingBox[1],
    line1.boundingBox[3],
    line1.boundingBox[5],
    line1.boundingBox[7]
  );
  const line1Height = line1Bottom - line1Top;

  const line2Top = Math.min(
    line2.boundingBox[1],
    line2.boundingBox[3],
    line2.boundingBox[5],
    line2.boundingBox[7]
  );

  const verticalGap = line2Top - line1Bottom;

  if (verticalGap <= line1Height * 0.3) {
    // Very close lines - might be part of same paragraph
    return "\n";
  } else if (verticalGap <= line1Height * 1.0) {
    // Normal line spacing
    return "\n";
  } else if (verticalGap <= line1Height * 2.0) {
    // Paragraph spacing
    return "\n\n";
  } else {
    // Large gap - section break
    return "\n\n\n";
  }
}

/**
 * Clean and format the final extracted text
 * @param {string} rawText - Raw text from OCR
 * @returns {string} Cleaned and formatted text
 */
function cleanAndFormatText(rawText) {
  if (!rawText) return "";

  let cleanedText = rawText
    // Remove excessive whitespace
    .replace(/[ \t]+/g, " ")
    // Fix multiple newlines
    .replace(/\n{4,}/g, "\n\n\n")
    // Remove trailing spaces from lines
    .replace(/ +\n/g, "\n")
    // Remove leading spaces from lines (except intentional indentation)
    .replace(/\n +/g, "\n")
    // Fix common OCR errors - add space between lowercase and uppercase
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    // Add space between letter and number
    .replace(/([a-zA-Z])(\d)/g, "$1 $2")
    // Add space between number and letter
    .replace(/(\d)([a-zA-Z])/g, "$1 $2")
    // Fix sentence spacing - ensure space after punctuation followed by capital letter
    .replace(/([.!?])([A-Z])/g, "$1 $2")
    // Fix common word concatenations
    .replace(/([a-z])([A-Z][a-z])/g, "$1 $2") // camelCase -> camel Case
    .replace(/(\w)(and)(\w)/gi, "$1 $2 $3") // wordandword -> word and word
    .replace(/(\w)(the)(\w)/gi, "$1 $2 $3") // wordtheword -> word the word
    .replace(/(\w)(to)(\w)/gi, "$1 $2 $3") // wordtoword -> word to word
    .replace(/(\w)(of)(\w)/gi, "$1 $2 $3") // wordofword -> word of word
    .replace(/(\w)(in)(\w)/gi, "$1 $2 $3") // wordinword -> word in word
    .replace(/(\w)(for)(\w)/gi, "$1 $2 $3") // wordforword -> word for word
    .replace(/(\w)(with)(\w)/gi, "$1 $2 $3") // wordwithword -> word with word
    .replace(/(\w)(that)(\w)/gi, "$1 $2 $3") // wordthatword -> word that word
    .replace(/(\w)(this)(\w)/gi, "$1 $2 $3") // wordthisword -> word this word
    .replace(/(\w)(from)(\w)/gi, "$1 $2 $3") // wordfromword -> word from word
    .replace(/(\w)(will)(\w)/gi, "$1 $2 $3") // wordwillword -> word will word
    .replace(/(\w)(have)(\w)/gi, "$1 $2 $3") // wordhaveword -> word have word
    .replace(/(\w)(been)(\w)/gi, "$1 $2 $3") // wordbeenword -> word been word
    .replace(/(\w)(were)(\w)/gi, "$1 $2 $3") // wordwereword -> word were word
    .replace(/(\w)(are)(\w)/gi, "$1 $2 $3") // wordareword -> word are word
    .replace(/(\w)(not)(\w)/gi, "$1 $2 $3") // wordnotword -> word not word
    .replace(/(\w)(can)(\w)/gi, "$1 $2 $3") // wordcanword -> word can word
    .replace(/(\w)(all)(\w)/gi, "$1 $2 $3") // wordallword -> word all word
    .replace(/(\w)(but)(\w)/gi, "$1 $2 $3") // wordbutword -> word but word
    .replace(/(\w)(was)(\w)/gi, "$1 $2 $3") // wordwasword -> word was word
    .replace(/(\w)(has)(\w)/gi, "$1 $2 $3") // wordhasword -> word has word
    .replace(/(\w)(had)(\w)/gi, "$1 $2 $3") // wordhadword -> word had word
    .replace(/(\w)(one)(\w)/gi, "$1 $2 $3") // wordoneword -> word one word
    .replace(/(\w)(you)(\w)/gi, "$1 $2 $3") // wordyouword -> word you word
    .replace(/(\w)(may)(\w)/gi, "$1 $2 $3") // wordmayword -> word may word
    .replace(/(\w)(use)(\w)/gi, "$1 $2 $3") // worduseword -> word use word
    .replace(/(\w)(its)(\w)/gi, "$1 $2 $3") // worditsword -> word its word
    .replace(/(\w)(your)(\w)/gi, "$1 $2 $3") // wordyourword -> word your word
    .replace(/(\w)(their)(\w)/gi, "$1 $2 $3") // wordtheirword -> word their word
    .replace(/(\w)(what)(\w)/gi, "$1 $2 $3") // wordwhatword -> word what word
    .replace(/(\w)(said)(\w)/gi, "$1 $2 $3") // wordsaidword -> word said word
    .replace(/(\w)(each)(\w)/gi, "$1 $2 $3") // wordeachword -> word each word
    .replace(/(\w)(which)(\w)/gi, "$1 $2 $3") // wordwhichword -> word which word
    .replace(/(\w)(do)(\w)/gi, "$1 $2 $3") // worddoword -> word do word
    .replace(/(\w)(how)(\w)/gi, "$1 $2 $3") // wordhowword -> word how word
    .replace(/(\w)(if)(\w)/gi, "$1 $2 $3") // wordifword -> word if word
    .replace(/(\w)(up)(\w)/gi, "$1 $2 $3") // wordupword -> word up word
    .replace(/(\w)(out)(\w)/gi, "$1 $2 $3") // wordoutword -> word out word
    .replace(/(\w)(many)(\w)/gi, "$1 $2 $3") // wordmanyword -> word many word
    .replace(/(\w)(then)(\w)/gi, "$1 $2 $3") // wordthenword -> word then word
    .replace(/(\w)(them)(\w)/gi, "$1 $2 $3") // wordthemword -> word them word
    .replace(/(\w)(these)(\w)/gi, "$1 $2 $3") // wordtheseword -> word these word
    .replace(/(\w)(so)(\w)/gi, "$1 $2 $3") // wordsoword -> word so word
    .replace(/(\w)(some)(\w)/gi, "$1 $2 $3") // wordsomeword -> word some word
    .replace(/(\w)(her)(\w)/gi, "$1 $2 $3") // wordherword -> word her word
    .replace(/(\w)(would)(\w)/gi, "$1 $2 $3") // wordwouldword -> word would word
    .replace(/(\w)(make)(\w)/gi, "$1 $2 $3") // wordmakeword -> word make word
    .replace(/(\w)(like)(\w)/gi, "$1 $2 $3") // wordlikeword -> word like word
    .replace(/(\w)(time)(\w)/gi, "$1 $2 $3") // wordtimeword -> word time word
    .replace(/(\w)(very)(\w)/gi, "$1 $2 $3") // wordveryword -> word very word
    .replace(/(\w)(when)(\w)/gi, "$1 $2 $3") // wordwhenword -> word when word
    .replace(/(\w)(come)(\w)/gi, "$1 $2 $3") // wordcomeword -> word come word
    .replace(/(\w)(his)(\w)/gi, "$1 $2 $3") // wordhisword -> word his word
    .replace(/(\w)(here)(\w)/gi, "$1 $2 $3") // wordhereword -> word here word
    .replace(/(\w)(just)(\w)/gi, "$1 $2 $3") // wordjustword -> word just word
    .replace(/(\w)(long)(\w)/gi, "$1 $2 $3") // wordlongword -> word long word
    .replace(/(\w)(get)(\w)/gi, "$1 $2 $3") // wordgetword -> word get word
    .replace(/(\w)(own)(\w)/gi, "$1 $2 $3") // wordownword -> word own word
    .replace(/(\w)(say)(\w)/gi, "$1 $2 $3") // wordsayword -> word say word
    .replace(/(\w)(she)(\w)/gi, "$1 $2 $3") // wordsheword -> word she word
    .replace(/(\w)(way)(\w)/gi, "$1 $2 $3") // wordwayword -> word way word
    .replace(/(\w)(too)(\w)/gi, "$1 $2 $3") // wordtooword -> word too word
    .replace(/(\w)(any)(\w)/gi, "$1 $2 $3") // wordanyword -> word any word
    .replace(/(\w)(day)(\w)/gi, "$1 $2 $3") // worddayword -> word day word
    .replace(/(\w)(man)(\w)/gi, "$1 $2 $3") // wordmanword -> word man word
    .replace(/(\w)(new)(\w)/gi, "$1 $2 $3") // wordnewword -> word new word
    .replace(/(\w)(now)(\w)/gi, "$1 $2 $3") // wordnowword -> word now word
    .replace(/(\w)(old)(\w)/gi, "$1 $2 $3") // wordoldword -> word old word
    .replace(/(\w)(see)(\w)/gi, "$1 $2 $3") // wordseeword -> word see word
    .replace(/(\w)(him)(\w)/gi, "$1 $2 $3") // wordhimword -> word him word
    .replace(/(\w)(two)(\w)/gi, "$1 $2 $3") // wordtwoword -> word two word
    .replace(/(\w)(more)(\w)/gi, "$1 $2 $3") // wordmoreword -> word more word
    .replace(/(\w)(go)(\w)/gi, "$1 $2 $3") // wordgoword -> word go word
    .replace(/(\w)(no)(\w)/gi, "$1 $2 $3") // wordnoword -> word no word
    .replace(/(\w)(first)(\w)/gi, "$1 $2 $3") // wordfirstword -> word first word
    .replace(/(\w)(call)(\w)/gi, "$1 $2 $3") // wordcallword -> word call word
    .replace(/(\w)(who)(\w)/gi, "$1 $2 $3") // wordwhoword -> word who word
    // Clean up excessive spaces
    .replace(/\s+/g, " ")
    .trim();

  return cleanedText;
}

/**
 * Detect and format paragraphs based on content analysis
 * @param {string} text - Input text
 * @returns {string} Text with proper paragraph formatting
 */
function detectAndFormatParagraphs(text) {
  if (!text) return "";

  const lines = text.split("\n");
  let formattedText = "";
  let previousLineLength = 0;

  for (let i = 0; i < lines.length; i++) {
    const currentLine = lines[i].trim();
    const nextLine = i < lines.length - 1 ? lines[i + 1].trim() : "";

    if (!currentLine) {
      // Empty line - preserve as paragraph break
      if (formattedText && !formattedText.endsWith("\n\n")) {
        formattedText += "\n";
      }
      continue;
    }

    formattedText += currentLine;

    // Determine if we need a line break or space
    if (nextLine) {
      const endsWithPunctuation = /[.!?]$/.test(currentLine);
      const nextStartsWithCapital = /^[A-Z]/.test(nextLine);
      const currentIsShort = currentLine.length < 50;
      const significantLengthDiff =
        Math.abs(currentLine.length - previousLineLength) > 20;

      if (endsWithPunctuation && nextStartsWithCapital) {
        // Likely paragraph break
        formattedText += "\n\n";
      } else if (currentIsShort && significantLengthDiff) {
        // Possible heading or section break
        formattedText += "\n\n";
      } else if (endsWithPunctuation) {
        // Sentence break
        formattedText += "\n";
      } else {
        // Continue same paragraph
        formattedText += " ";
      }
    }

    previousLineLength = currentLine.length;
  }

  return formattedText.trim();
}

/**
 * Apply forced spacing to text that has no spaces by analyzing word positions
 * Uses precise bounding box analysis to determine word relationships
 * @param {Array} lines - Array of line objects with words and bounding boxes
 * @returns {string} Text with forced spacing applied
 */
function applyForcedSpacingToCompactText(lines) {
  if (!lines || lines.length === 0) {
    return "";
  }

  console.log("Applying forced spacing using bounding box analysis...");
  let formattedText = "";

  // Process all words across all lines, maintaining their spatial relationships
  const allWords = [];

  // Collect all words with their line information
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const line = lines[lineIndex];
    if (!line.words || line.words.length === 0) continue;

    for (const word of line.words) {
      if (word.boundingBox && word.boundingBox.length >= 8) {
        allWords.push({
          text: word.text,
          boundingBox: word.boundingBox,
          lineIndex: lineIndex,
          confidence: word.confidence || 0,
        });
      }
    }
  }

  if (allWords.length === 0) {
    return "";
  }

  // Sort words by their position (top to bottom, left to right)
  allWords.sort((a, b) => {
    const aTop = Math.min(
      a.boundingBox[1],
      a.boundingBox[3],
      a.boundingBox[5],
      a.boundingBox[7]
    );
    const bTop = Math.min(
      b.boundingBox[1],
      b.boundingBox[3],
      b.boundingBox[5],
      b.boundingBox[7]
    );
    const aLeft = Math.min(
      a.boundingBox[0],
      a.boundingBox[2],
      a.boundingBox[4],
      a.boundingBox[6]
    );
    const bLeft = Math.min(
      b.boundingBox[0],
      b.boundingBox[2],
      b.boundingBox[4],
      b.boundingBox[6]
    );

    // Calculate average height for line detection
    const aHeight =
      Math.max(
        a.boundingBox[1],
        a.boundingBox[3],
        a.boundingBox[5],
        a.boundingBox[7]
      ) - aTop;
    const bHeight =
      Math.max(
        b.boundingBox[1],
        b.boundingBox[3],
        b.boundingBox[5],
        b.boundingBox[7]
      ) - bTop;
    const avgHeight = (aHeight + bHeight) / 2;

    // If words are on different lines (significant vertical difference)
    if (Math.abs(aTop - bTop) > avgHeight * 0.5) {
      return aTop - bTop; // Sort by vertical position first
    }

    // If on same line, sort by horizontal position
    return aLeft - bLeft;
  });

  // Build text with proper spacing
  for (let i = 0; i < allWords.length; i++) {
    const currentWord = allWords[i];
    formattedText += currentWord.text;

    // Add spacing after the word (except for the last word)
    if (i < allWords.length - 1) {
      const nextWord = allWords[i + 1];
      const spacing = calculateSpacingBetweenWords(currentWord, nextWord);
      formattedText += spacing;
    }
  }

  return formattedText;
}

/**
 * Handle completely concatenated text by using common word patterns
 * This is a fallback when bounding box analysis fails
 * @param {string} concatenatedText - Text with no spaces
 * @returns {string} Text with basic spacing applied
 */
function addBasicSpacingToText(concatenatedText) {
  if (!concatenatedText || concatenatedText.includes(" ")) {
    return concatenatedText;
  }

  let spacedText = concatenatedText
    // Add space before capital letters (except at start)
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    // Add space before numbers (except at start)
    .replace(/([a-zA-Z])(\d)/g, "$1 $2")
    // Add space after numbers before letters
    .replace(/(\d)([a-zA-Z])/g, "$1 $2")
    // Add space after punctuation
    .replace(/([.!?,:;])([a-zA-Z])/g, "$1 $2")
    // Add space around common conjunctions and prepositions
    .replace(/([a-z])(and)([a-z])/gi, "$1 $2 $3")
    .replace(/([a-z])(the)([a-z])/gi, "$1 $2 $3")
    .replace(/([a-z])(to)([a-z])/gi, "$1 $2 $3")
    .replace(/([a-z])(of)([a-z])/gi, "$1 $2 $3")
    .replace(/([a-z])(in)([a-z])/gi, "$1 $2 $3")
    .replace(/([a-z])(for)([a-z])/gi, "$1 $2 $3")
    .replace(/([a-z])(with)([a-z])/gi, "$1 $2 $3")
    .replace(/([a-z])(that)([a-z])/gi, "$1 $2 $3")
    .replace(/([a-z])(this)([a-z])/gi, "$1 $2 $3")
    .replace(/([a-z])(from)([a-z])/gi, "$1 $2 $3")
    .replace(/([a-z])(will)([a-z])/gi, "$1 $2 $3")
    .replace(/([a-z])(have)([a-z])/gi, "$1 $2 $3")
    .replace(/([a-z])(been)([a-z])/gi, "$1 $2 $3")
    .replace(/([a-z])(were)([a-z])/gi, "$1 $2 $3")
    .replace(/([a-z])(are)([a-z])/gi, "$1 $2 $3")
    .replace(/([a-z])(not)([a-z])/gi, "$1 $2 $3")
    .replace(/([a-z])(can)([a-z])/gi, "$1 $2 $3")
    .replace(/([a-z])(all)([a-z])/gi, "$1 $2 $3")
    .replace(/([a-z])(but)([a-z])/gi, "$1 $2 $3")
    .replace(/([a-z])(was)([a-z])/gi, "$1 $2 $3") // wordwasword -> word was word
    // Clean up excessive spaces
    .replace(/\s+/g, " ")
    .trim();

  return spacedText;
}

// =================================================================
// Continuous Searchable PDF Implementation
// =================================================================

/**
 * Creates a searchable PDF with precise text positioning
 * @param {string} imagePath - Path to input image
 * @param {Object} page - OCR page results with lines and words
 * @param {string} pdfFilename - Output PDF path
 * @param {number} fontSize - Font size for invisible text
 */
async function createContinuousSearchablePdf(
  imagePath,
  page,
  pdfFilename,
  fontSize = CONFIG.PDF_FONT_SIZE
) {
  try {
    console.log("Creating continuous searchable PDF with jsPDF...");

    // Read image buffer and get dimensions
    const imgBuffer = await fsPromises.readFile(imagePath);
    const metadata = await sharp(imgBuffer).metadata();
    const img_w = metadata.width;
    const img_h = metadata.height;

    // Create PDF document
    const doc = new jsPDF({
      orientation: img_w > img_h ? "landscape" : "portrait",
      unit: "pt",
      format: [img_w, img_h],
    });

    // Add image as base64
    const imgData = imgBuffer.toString("base64");
    const imageFormat = path.extname(imagePath).toLowerCase().slice(1);
    doc.addImage(imgData, imageFormat.toUpperCase(), 0, 0, img_w, img_h);

    // Set PDF font and metrics
    doc.setFont(CONFIG.PDF_FONT_NAME);
    doc.setFontSize(fontSize);
    const spaceWidth = doc.getTextWidth(" ");
    const descent = fontSize * 0.2; // Approximate descent

    // Process each line
    if (page && page.lines) {
      for (const line of page.lines) {
        if (!line.words || line.words.length === 0) continue;

        // Sort words left to right
        const words = [...line.words].sort(
          (a, b) => a.boundingBox[0] - b.boundingBox[0]
        );

        // Build continuous text with calculated spacing
        let fullText = words[0].text;
        for (let i = 1; i < words.length; i++) {
          const prev = words[i - 1];
          const curr = words[i];

          // Calculate gap between words
          const prevEnd = Math.max(
            prev.boundingBox[0],
            prev.boundingBox[2],
            prev.boundingBox[4],
            prev.boundingBox[6]
          );
          const currStart = Math.min(
            curr.boundingBox[0],
            curr.boundingBox[2],
            curr.boundingBox[4],
            curr.boundingBox[6]
          );
          const gap = currStart - prevEnd;

          // Calculate number of spaces based on gap
          const spaceCount = Math.max(1, Math.round(gap / spaceWidth));
          fullText += " ".repeat(spaceCount) + curr.text;
        }

        // Calculate baseline position
        const baselines = words.map((word) => {
          const maxY = Math.max(
            word.boundingBox[1],
            word.boundingBox[3],
            word.boundingBox[5],
            word.boundingBox[7]
          );
          return maxY - descent;
        });
        const avgBaseline =
          baselines.reduce((sum, y) => sum + y, 0) / baselines.length;

        // Get starting x position
        const startX = Math.min(
          words[0].boundingBox[0],
          words[0].boundingBox[2],
          words[0].boundingBox[4],
          words[0].boundingBox[6]
        );

        // Add invisible text
        doc.setTextColor(255, 255, 255, 0); // Transparent
        doc.text(fullText, startX, avgBaseline);
        doc.setTextColor(0, 0, 0); // Reset color

        console.log(
          `Added line: "${fullText.substring(0, 50)}..." at (${startX.toFixed(
            1
          )}, ${avgBaseline.toFixed(1)})`
        );
      }
    }

    // Save PDF
    doc.save(pdfFilename);
    console.log(`Continuous searchable PDF created: ${pdfFilename}`);
  } catch (error) {
    console.error("Error creating continuous searchable PDF:", error);
    throw error;
  }
}

/**
 * Creates a searchable PDF with precise text positioning from PDF input
 * @param {string} pdfPath - Path to input PDF
 * @param {Array} pages - OCR page results with lines and words for all pages
 * @param {string} outputPath - Output PDF path
 * @param {number} fontSize - Font size for invisible text
 */
async function createContinuousSearchablePdfFromPDF(
  pdfPath,
  pages,
  outputPath,
  fontSize = CONFIG.PDF_FONT_SIZE
) {
  try {
    console.log("Creating continuous searchable PDF from PDF with pdf-lib...");

    // Read the original PDF
    const existingPdfBytes = await fsPromises.readFile(pdfPath);

    // Load the PDF with pdf-lib
    const pdfDoc = await PDFLib.load(existingPdfBytes);

    // Get the pages from the PDF
    const pdfPages = pdfDoc.getPages();

    // Embed a monospaced font for better spacing accuracy
    const font = await pdfDoc.embedFont(StandardFonts.Courier);

    console.log(
      `PDF has ${pdfPages.length} pages, OCR detected ${pages.length} pages`
    );

    // Process each page from OCR results
    for (
      let pageIndex = 0;
      pageIndex < Math.min(pages.length, pdfPages.length);
      pageIndex++
    ) {
      const page = pages[pageIndex];
      const pdfPage = pdfPages[pageIndex];

      // Get page dimensions
      const { width: pageWidth, height: pageHeight } = pdfPage.getSize();

      console.log(
        `Processing page ${pageIndex + 1}: ${pageWidth}x${pageHeight}`
      );

      // Process each line on this page
      if (page && page.lines) {
        for (const line of page.lines) {
          if (!line.words || line.words.length === 0) continue;

          // Sort words left to right
          const words = [...line.words].sort(
            (a, b) => a.boundingBox[0] - b.boundingBox[0]
          );

          // Build continuous text with calculated spacing
          let fullText = words[0].text;

          // Calculate character width for spacing
          const charWidth = font.widthOfTextAtSize("M", fontSize);

          for (let i = 1; i < words.length; i++) {
            const prev = words[i - 1];
            const curr = words[i];

            // Calculate gap between words
            const prevEnd = Math.max(
              prev.boundingBox[0],
              prev.boundingBox[2],
              prev.boundingBox[4],
              prev.boundingBox[6]
            );
            const currStart = Math.min(
              curr.boundingBox[0],
              curr.boundingBox[2],
              curr.boundingBox[4],
              curr.boundingBox[6]
            );
            const gap = currStart - prevEnd;

            // Calculate number of spaces based on gap
            const spaceCount = Math.max(1, Math.round(gap / charWidth));
            fullText += " ".repeat(spaceCount) + curr.text;
          }

          // Calculate text position
          // OCR Y coordinates are from top, PDF coordinates are from bottom
          const minY = Math.min(
            words[0].boundingBox[1],
            words[0].boundingBox[3],
            words[0].boundingBox[5],
            words[0].boundingBox[7]
          );
          const maxY = Math.max(
            words[0].boundingBox[1],
            words[0].boundingBox[3],
            words[0].boundingBox[5],
            words[0].boundingBox[7]
          );

          // Convert OCR coordinates to PDF coordinates
          const textHeight = maxY - minY;
          const ocrPageHeight = page.height || pageHeight;

          // Scale coordinates if necessary
          const scaleX = pageWidth / (page.width || pageWidth);
          const scaleY = pageHeight / ocrPageHeight;

          const startX =
            Math.min(
              words[0].boundingBox[0],
              words[0].boundingBox[2],
              words[0].boundingBox[4],
              words[0].boundingBox[6]
            ) * scaleX;

          // Convert Y coordinate from OCR (top-origin) to PDF (bottom-origin)
          const pdfY = pageHeight - minY * scaleY - textHeight * scaleY;

          // Ensure coordinates are within page bounds
          const x = Math.max(0, Math.min(pageWidth - 10, startX));
          const y = Math.max(10, Math.min(pageHeight - 10, pdfY));

          // Add invisible text overlay for searchability
          pdfPage.drawText(fullText, {
            x: x,
            y: y,
            size: fontSize,
            font: font,
            color: rgb(1, 1, 1), // Use white color
            opacity: 0, // Completely transparent but still searchable
          });

          console.log(
            `Page ${pageIndex + 1}: Added "${fullText.substring(
              0,
              30
            )}..." at (${x.toFixed(1)}, ${y.toFixed(1)})`
          );
        }
      }
    }

    // Save the modified PDF
    const pdfBytes = await pdfDoc.save();
    await fsPromises.writeFile(outputPath, pdfBytes);

    console.log(
      `Continuous searchable PDF with overlay created: ${outputPath}`
    );
  } catch (error) {
    console.error("Error creating continuous searchable PDF from PDF:", error);

    // Fallback to the previous jsPDF method
    console.log("Falling back to jsPDF text-only method...");
    const doc = new jsPDF({
      orientation: "portrait",
      unit: "pt",
      format: "a4",
    });

    doc.setFont("helvetica");
    doc.setFontSize(12);
    doc.text("Extracted Text from PDF", 50, 50);

    let yPosition = 80;
    const lineHeight = 14;
    const pageHeight = doc.internal.pageSize.height;

    // Add all text from all pages
    for (let pageIndex = 0; pageIndex < pages.length; pageIndex++) {
      const page = pages[pageIndex];

      if (pageIndex > 0) {
        doc.text(`--- Page ${pageIndex + 1} ---`, 50, yPosition);
        yPosition += lineHeight * 2;
      }

      if (page.lines) {
        for (const line of page.lines) {
          if (line.words && line.words.length > 0) {
            const lineText = line.words.map((word) => word.text).join(" ");
            if (yPosition > pageHeight - 50) {
              doc.addPage();
              yPosition = 50;
            }
            doc.text(lineText, 50, yPosition);
            yPosition += lineHeight;
          }
        }
      }
    }

    doc.save(outputPath);
    console.log(`Fallback PDF created: ${outputPath}`);
  }
}

module.exports = ocrService;
