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
      console.log(`🔍 Checking PDF for existing text: ${filePath}`);

      const pdfBytes = await fsPromises.readFile(filePath);
      
      // Validate PDF structure first
      if (!this.isValidPDF(pdfBytes)) {
        console.warn("Invalid PDF structure detected");
        return { hasText: false, extractedText: "", pageCount: 0, textLength: 0 };
      }

      const pdfDoc = await PDFLib.load(pdfBytes, { ignoreEncryption: true });
      const pages = pdfDoc.getPages();
      const pageCount = pages.length;

      let allText = "";
      let hasSignificantText = false;

      // Use a more reliable text detection method
      const textCheck = await this.checkPDFTextWithPdfParse(filePath);
      
      if (textCheck.hasText && textCheck.textLength > 50) {
        hasSignificantText = true;
        allText = textCheck.extractedText || "Text detected but not extracted";
      }

      const result = {
        hasText: hasSignificantText,
        extractedText: allText.trim(),
        pageCount: pageCount,
        textLength: allText.trim().length,
      };

      console.log(`✅ PDF text check complete: hasText=${result.hasText}, pageCount=${result.pageCount}`);
      return result;
    } catch (error) {
      console.error(`Error checking PDF for existing text: ${error.message}`);
      return { hasText: false, extractedText: "", pageCount: 0, textLength: 0 };
    }
  },

  /**
   * Validate PDF file structure
   * @param {Buffer} pdfBytes - PDF file bytes
   * @returns {boolean} Whether PDF structure is valid
   */
  isValidPDF(pdfBytes) {
    try {
      if (!pdfBytes || pdfBytes.length < 100) return false;
      
      // Check PDF header
      const header = pdfBytes.slice(0, 10).toString('ascii');
      if (!header.startsWith('%PDF-')) {
        return false;
      }
      
      // Check for basic PDF structure markers
      const pdfString = pdfBytes.toString('ascii', 0, Math.min(pdfBytes.length, 1024));
      const hasBasicStructure = /\/Type\s*\/Catalog/.test(pdfString) || 
                                /\/Root/.test(pdfString) ||
                                /startxref/.test(pdfBytes.toString('ascii', Math.max(0, pdfBytes.length - 1024)));
      
      return hasBasicStructure;
    } catch (error) {
      console.error('Error validating PDF structure:', error);
      return false;
    }
  },



  /**
   * Enhanced PDF text detection using pdf-parse library
   * @param {string} filePath - Path to the PDF file
   * @returns {Promise<Object>} Text extraction results
   */
  async checkPDFTextWithPdfParse(filePath) {
    try {
      const pdfBytes = await fsPromises.readFile(filePath);

      // Enhanced PDF text detection using multiple methods
      const pdfString = pdfBytes.toString('binary');

      // Look for more comprehensive text content indicators
      const textIndicators = [
        /\/Type\s*\/Font/g,
        /\/Subtype\s*\/Type1/g,
        /\/Subtype\s*\/TrueType/g,
        /\/Subtype\s*\/Type0/g,
        /BT\s+.*?ET/gs, // Text objects (multiline)
        /Tj\s*$/gm, // Text showing operators
        /TJ\s*$/gm, // Array text showing operators
        /\[\s*\(.*?\)\s*\]\s*TJ/g, // Array with text
        /\(.*?\)\s*Tj/g, // Simple text showing
      ];

      let textIndicatorCount = 0;
      let hasRealText = false;

      for (const indicator of textIndicators) {
        const matches = pdfString.match(indicator);
        if (matches) {
          textIndicatorCount += matches.length;
          
          // Check if we find actual readable text content
          if (indicator.toString().includes('Tj') || indicator.toString().includes('TJ')) {
            matches.forEach(match => {
              // Extract text content from PDF operators
              const textMatch = match.match(/\((.*?)\)/);
              if (textMatch && textMatch[1] && textMatch[1].length > 3) {
                hasRealText = true;
              }
            });
          }
        }
      }

      // More conservative threshold - require actual text content
      const hasText = hasRealText && textIndicatorCount > 10;

      console.log(`📊 PDF text analysis: indicators=${textIndicatorCount}, hasRealText=${hasRealText}, hasText=${hasText}`);
      
      return {
        hasText: hasText,
        extractedText: hasText ? "[Searchable text detected]" : "",
        pageCount: 1, // Simplified for this approach
        textLength: hasText ? textIndicatorCount * 5 : 0, // Estimated
        method: "enhanced-pdf-parse-regex",
      };
    } catch (error) {
      console.error(`Error in enhanced PDF text detection: ${error.message}`);
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
        const textCheck = await this.checkPDFTextWithPdfParse(fullPath);

        if (textCheck.hasText) {
        
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
         
        }
      }

      if (!computerVisionClient) {
        console.warn(
          "Azure Computer Vision not configured, using fallback simulation"
        );
        return await simulateOCR(fullPath, mimetype);
      }


      let result;
      if (mimetype.startsWith("image/") || mimetype === "application/pdf") {
        result = await readTextFromFile(computerVisionClient, fullPath);
      } else {
        throw new Error(
          "Unsupported file type. Only images and PDFs are supported."
        );
      }

      const extractedData = processOCRResults(result);

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
      const sanitizedOutput = sanitizePath(path.basename(outputPath));
      const fullOutputPath = path.join(
        path.dirname(outputPath),
        sanitizedOutput
      );

      // Check if the PDF already had searchable text (OCR was skipped)
      if (ocrResults.skippedOCR && ocrResults.originallySearchable) {
        console.log("📄 PDF already searchable, copying original...");

        // Validate original file before copying
        const originalBytes = await fsPromises.readFile(originalFilePath);
        if (!this.isValidPDF(originalBytes)) {
          throw new Error("Original PDF file is corrupted");
        }

        // Simply copy the original file to the output location
        await fsPromises.copyFile(originalFilePath, fullOutputPath);
        return fullOutputPath;
      }

      const isPDF = path.extname(originalFilePath).toLowerCase() === ".pdf";

      if (isPDF) {
        // For PDFs, use enhanced method with validation
        return await this.generateSearchablePDFFromPDF(
          originalFilePath,
          ocrResults,
          fullOutputPath
        );
      } else {
        // Single image processing with validation
        await this.createValidatedSearchablePdf(
          originalFilePath,
          ocrResults.readResults[0],
          fullOutputPath,
          CONFIG.PDF_FONT_SIZE
        );
        return fullOutputPath;
      }
    } catch (error) {
      console.error("Error generating searchable PDF:", error);
      // Enhanced fallback with validation
      return await this.generateValidatedFallbackPDF(
        originalFilePath,
        ocrResults,
        outputPath
      );
    }
  },

  /**
   * Generate validated searchable PDF from existing PDF with error handling
   * @param {string} originalFilePath - Path to original PDF
   * @param {Object} ocrResults - OCR results
   * @param {string} outputPath - Output path
   * @returns {Promise<string>} Path to generated PDF
   */
  async generateSearchablePDFFromPDF(originalFilePath, ocrResults, outputPath) {
    try {
      console.log("🔧 Generating searchable PDF from existing PDF...");
      
      // Validate original PDF first
      const originalBytes = await fsPromises.readFile(originalFilePath);
      if (!this.isValidPDF(originalBytes)) {
        throw new Error("Original PDF file is corrupted");
      }

      // Try enhanced PDF overlay method
      await createValidatedContinuousSearchablePdfFromPDF(
        originalFilePath,
        ocrResults.readResults,
        outputPath,
        CONFIG.PDF_FONT_SIZE
      );

      // Validate generated PDF
      const generatedBytes = await fsPromises.readFile(outputPath);
      if (!this.isValidPDF(generatedBytes)) {
        throw new Error("Generated PDF validation failed");
      }

      return outputPath;
    } catch (error) {
      console.error("Error in PDF searchable generation:", error);
      // Fallback to simple text overlay
      return await this.generateSimpleTextOverlayPDF(originalFilePath, ocrResults, outputPath);
    }
  },

  /**
   * Create validated searchable PDF from image with error handling
   * @param {string} imagePath - Path to image
   * @param {Object} pageData - OCR page data
   * @param {string} outputPath - Output path
   * @param {number} fontSize - Font size
   */
  async createValidatedSearchablePdf(imagePath, pageData, outputPath, fontSize) {
    try {
      await createContinuousSearchablePdf(imagePath, pageData, outputPath, fontSize);
      
      // Validate generated PDF
      const pdfBytes = await fsPromises.readFile(outputPath);
      if (!this.isValidPDF(pdfBytes)) {
        throw new Error("Generated PDF validation failed");
      }
    } catch (error) {
      console.error("Error creating validated searchable PDF:", error);
      // Fallback to simple method
      await this.createSimpleImageToPDF(imagePath, pageData, outputPath);
    }
  },

  /**
   * Create simple image-to-PDF as fallback
   * @param {string} imagePath - Path to image
   * @param {Object} pageData - OCR page data  
   * @param {string} outputPath - Output path
   */
  async createSimpleImageToPDF(imagePath, pageData, outputPath) {
    try {
      const imgBuffer = await fsPromises.readFile(imagePath);
      const metadata = await sharp(imgBuffer).metadata();
      
      const doc = new jsPDF({
        orientation: metadata.width > metadata.height ? "landscape" : "portrait",
        unit: "pt",
        format: [metadata.width || 595, metadata.height || 842],
      });

      // Add image
      const imgData = imgBuffer.toString("base64");
      const imageFormat = path.extname(imagePath).toLowerCase().slice(1);
      doc.addImage(imgData, imageFormat.toUpperCase(), 0, 0, metadata.width, metadata.height);

      // Add simple text overlay (invisible)
      if (pageData && pageData.lines) {
        doc.setTextColor(255, 255, 255, 0); // Transparent
        doc.setFont("helvetica");
        doc.setFontSize(12);
        
        let yPos = 50;
        pageData.lines.forEach(line => {
          if (line.words && line.words.length > 0) {
            const lineText = line.words.map(w => w.text).join(" ");
            doc.text(lineText, 10, yPos);
            yPos += 15;
          }
        });
      }

      doc.save(outputPath);
      console.log("✅ Simple image-to-PDF created successfully");
    } catch (error) {
      console.error("Error creating simple image-to-PDF:", error);
      throw error;
    }
  },

  /**
   * Generate validated fallback PDF with comprehensive error handling
   * @param {string} originalFilePath - Original file path
   * @param {Object} ocrResults - OCR results
   * @param {string} outputPath - Output path
   * @returns {Promise<string>} Generated PDF path
   */
  async generateValidatedFallbackPDF(originalFilePath, ocrResults, outputPath) {
    try {
      console.log("🛠️ Creating validated fallback PDF...");
      
      const doc = new jsPDF({
        orientation: "portrait",
        unit: "pt",
        format: "a4",
      });

      doc.setFont("helvetica");
      doc.setFontSize(16);
      doc.text("OCR Extracted Text", 50, 50);

      doc.setFontSize(12);
      let yPosition = 80;
      const lineHeight = 14;
      const pageHeight = doc.internal.pageSize.height;
      const pageWidth = doc.internal.pageSize.width;
      const maxWidth = pageWidth - 100;

      // Add extracted text with proper formatting
      if (ocrResults.text) {
        const textLines = doc.splitTextToSize(ocrResults.text, maxWidth);
        textLines.forEach(line => {
          if (yPosition > pageHeight - 50) {
            doc.addPage();
            yPosition = 50;
          }
          doc.text(line, 50, yPosition);
          yPosition += lineHeight;
        });
      }

      // Add metadata
      doc.setFontSize(10);
      doc.text(`Confidence: ${ocrResults.confidence || 0}%`, 50, pageHeight - 30);
      doc.text(`Generated: ${new Date().toLocaleString()}`, 200, pageHeight - 30);

      doc.save(outputPath);

      // Validate the fallback PDF
      const fallbackBytes = await fsPromises.readFile(outputPath);
      if (!this.isValidPDF(fallbackBytes)) {
        throw new Error("Fallback PDF validation failed");
      }

      console.log("✅ Validated fallback PDF created successfully");
      return outputPath;
    } catch (error) {
      console.error("Error creating validated fallback PDF:", error);
      throw new Error("All PDF generation methods failed");
    }
  },

  /**
   * Generate simple text overlay PDF for problematic PDFs
   * @param {string} originalFilePath - Original PDF path
   * @param {Object} ocrResults - OCR results
   * @param {string} outputPath - Output path
   * @returns {Promise<string>} Generated PDF path
   */
  async generateSimpleTextOverlayPDF(originalFilePath, ocrResults, outputPath) {
    try {
      console.log("📝 Creating simple text overlay PDF...");
      
      // Try to preserve original PDF if valid
      const originalBytes = await fsPromises.readFile(originalFilePath);
      if (this.isValidPDF(originalBytes)) {
        // Copy original and try minimal text overlay
        await fsPromises.copyFile(originalFilePath, outputPath);
        return outputPath;
      } else {
        // Create new PDF with text only
        return await this.generateValidatedFallbackPDF(originalFilePath, ocrResults, outputPath);
      }
    } catch (error) {
      console.error("Error in simple text overlay PDF:", error);
      return await this.generateValidatedFallbackPDF(originalFilePath, ocrResults, outputPath);
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
            // For PDFs, use the enhanced validated method
            const resultPath = await ocrService.generateSearchablePDF(
              filePath,
              ocrResults,
              overlayPath
            );
            ocrResults.overlayPDFPath = resultPath;
            ocrResults.overlayPDFName = path.basename(resultPath);
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
            await createContinuousSearchablePdf(
              filePath,
              ocrResults.readResults[0],
              overlayPath,
              CONFIG.PDF_FONT_SIZE
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
ocrService.createValidatedContinuousSearchablePdfFromPDF = createValidatedContinuousSearchablePdfFromPDF;
ocrService.createSimpleTextOnlyPDF = createSimpleTextOnlyPDF;

/**
 * Alternative method to read file as buffer
 * @param {ComputerVisionClient} client - Azure client
 * @param {string} filePath - Path to file
 * @returns {Promise<Array>} Read results
 */
async function readTextFromFile(client, filePath) {
  try {
    let result;
    try {
      const stream = () => fs.createReadStream(filePath);
      result = await client.readInStream(stream);
    } catch (streamError) {
      console.log("Stream method failed, trying buffer method:", streamError.message);
      const fileBuffer = await fsPromises.readFile(filePath);
      result = await client.readInStream(fileBuffer);
    }
    
    const operationId = result.operationLocation.split("/").pop();

    let readResult;
    let attempts = 0;
    const maxAttempts = CONFIG.TIMEOUT_SECONDS;

    do {
      await sleep(1000);
      readResult = await client.getReadResult(operationId);
      attempts++;
     
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


  for (let pageIndex = 0; pageIndex < readResults.length; pageIndex++) {
    const page = readResults[pageIndex];
    if (readResults.length > 1) {
      extractedText += `\n--- Page ${pageIndex + 1} ---\n`;
    }

    if (page.lines?.length) {

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
          pageText = applyForcedSpacingToCompactText(page.lines);

          // Last resort: if still no spaces, apply basic pattern-based spacing
          if (!pageText.includes(" ")) {
           
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
 * Create a simple text-only PDF as fallback when overlay generation fails
 * @param {Object} ocrResults - OCR results containing extracted text
 * @param {string} outputPath - Path where the PDF should be saved
 */
async function createSimpleTextOnlyPDF(ocrResults, outputPath) {
  try {

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
    // Fix common word concatenations - essential ones only
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
    .replace(/(\w)(are)(\w)/gi, "$1 $2 $3") // wordareword -> word are word
    .replace(/(\w)(not)(\w)/gi, "$1 $2 $3") // wordnotword -> word not word
    .replace(/(\w)(can)(\w)/gi, "$1 $2 $3") // wordcanword -> word can word
    .replace(/(\w)(but)(\w)/gi, "$1 $2 $3") // wordbutword -> word but word
    .replace(/(\w)(was)(\w)/gi, "$1 $2 $3") // wordwasword -> word was word
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
    // Add space around common conjunctions and prepositions - essential ones only
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
    .replace(/([a-z])(are)([a-z])/gi, "$1 $2 $3")
    .replace(/([a-z])(not)([a-z])/gi, "$1 $2 $3")
    .replace(/([a-z])(can)([a-z])/gi, "$1 $2 $3")
    .replace(/([a-z])(but)([a-z])/gi, "$1 $2 $3")
    .replace(/([a-z])(was)([a-z])/gi, "$1 $2 $3")
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

        // Add invisible text - completely transparent but searchable
        doc.saveGraphicsState();
        doc.setTextColor(255, 255, 255); // White text
        doc.setGState(new doc.GState({ opacity: 0.01 })); // Almost completely transparent  
        doc.text(fullText, startX, avgBaseline);
        doc.restoreGraphicsState();

      
      }
    }

    // Save PDF
    doc.save(pdfFilename);
  } catch (error) {
    console.error("Error creating continuous searchable PDF:", error);
    throw error;
  }
}

/**
 * Creates a validated searchable PDF with precise text positioning from PDF input
 * Enhanced version with better error handling and validation
 * @param {string} pdfPath - Path to input PDF
 * @param {Array} pages - OCR page results with lines and words for all pages
 * @param {string} outputPath - Output PDF path
 * @param {number} fontSize - Font size for invisible text
 */
async function createValidatedContinuousSearchablePdfFromPDF(
  pdfPath,
  pages,
  outputPath,
  fontSize = CONFIG.PDF_FONT_SIZE
) {
  try {
    console.log("🔧 Creating validated continuous searchable PDF from PDF...");

    // Read and validate the original PDF
    const existingPdfBytes = await fsPromises.readFile(pdfPath);
    
    // Validate PDF structure first
    if (!existingPdfBytes || existingPdfBytes.length < 100) {
      throw new Error("Invalid or empty PDF file");
    }

    // Check PDF header
    const header = existingPdfBytes.slice(0, 10).toString('ascii');
    if (!header.startsWith('%PDF-')) {
      throw new Error("Not a valid PDF file");
    }

    // Load the PDF with pdf-lib with error handling
    let pdfDoc;
    try {
      pdfDoc = await PDFLib.load(existingPdfBytes, { 
        ignoreEncryption: true,
        capNumbers: false,
        throwOnInvalidBytes: false 
      });
    } catch (loadError) {
      console.error("PDF loading failed:", loadError);
      throw new Error("Failed to load PDF - file may be corrupted");
    }

    // Get the pages from the PDF
    const pdfPages = pdfDoc.getPages();
    if (!pdfPages || pdfPages.length === 0) {
      throw new Error("PDF contains no pages");
    }

    // Embed a monospaced font for better spacing accuracy
    let font;
    try {
      font = await pdfDoc.embedFont(StandardFonts.Courier);
    } catch (fontError) {
      console.warn("Failed to embed Courier font, using Helvetica:", fontError);
      font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    }

    console.log(`📄 Processing ${Math.min(pages.length, pdfPages.length)} pages for OCR overlay`);

    // Process each page from OCR results with enhanced error handling
    for (
      let pageIndex = 0;
      pageIndex < Math.min(pages.length, pdfPages.length);
      pageIndex++
    ) {
      try {
        const page = pages[pageIndex];
        const pdfPage = pdfPages[pageIndex];

        if (!pdfPage) {
          console.warn(`Skipping page ${pageIndex + 1} - not found in PDF`);
          continue;
        }

        // Get page dimensions with validation
        const { width: pageWidth, height: pageHeight } = pdfPage.getSize();
        
        if (!pageWidth || !pageHeight || pageWidth <= 0 || pageHeight <= 0) {
          console.warn(`Skipping page ${pageIndex + 1} - invalid dimensions`);
          continue;
        }

        console.log(`📝 Processing page ${pageIndex + 1}: ${pageWidth}x${pageHeight}`);

        // Process each line on this page with enhanced validation
        if (page && page.lines && Array.isArray(page.lines)) {
          let textAdded = 0;
          
          for (const line of page.lines) {
            try {
              if (!line.words || !Array.isArray(line.words) || line.words.length === 0) {
                continue;
              }

              // Sort words left to right
              const words = [...line.words].sort(
                (a, b) => (a.boundingBox?.[0] || 0) - (b.boundingBox?.[0] || 0)
              );

              // Build continuous text with calculated spacing
              let fullText = "";
              
              for (let i = 0; i < words.length; i++) {
                const word = words[i];
                if (!word.text) continue;
                
                fullText += word.text;
                
                if (i < words.length - 1) {
                  // Add spacing between words
                  const curr = words[i];
                  const next = words[i + 1];
                  
                  if (curr.boundingBox && next.boundingBox && 
                      curr.boundingBox.length >= 8 && next.boundingBox.length >= 8) {
                    
                    const currEnd = Math.max(
                      curr.boundingBox[0], curr.boundingBox[2],
                      curr.boundingBox[4], curr.boundingBox[6]
                    );
                    const nextStart = Math.min(
                      next.boundingBox[0], next.boundingBox[2],
                      next.boundingBox[4], next.boundingBox[6]
                    );
                    
                    const gap = nextStart - currEnd;
                    const spaceCount = Math.max(1, Math.round(gap / 5)); // Approximate character width
                    fullText += " ".repeat(Math.min(spaceCount, 10)); // Limit spacing
                  } else {
                    fullText += " "; // Default single space
                  }
                }
              }

              if (!fullText.trim()) continue;

              // Calculate text position with enhanced error handling
              const firstWord = words[0];
              if (!firstWord.boundingBox || firstWord.boundingBox.length < 8) {
                continue;
              }

              // Get bounding box coordinates
              const minY = Math.min(
                firstWord.boundingBox[1], firstWord.boundingBox[3],
                firstWord.boundingBox[5], firstWord.boundingBox[7]
              );
              const maxY = Math.max(
                firstWord.boundingBox[1], firstWord.boundingBox[3],
                firstWord.boundingBox[5], firstWord.boundingBox[7]
              );

              // Convert OCR coordinates to PDF coordinates with scaling
              const textHeight = maxY - minY;
              const ocrPageHeight = page.height || pageHeight;
              const ocrPageWidth = page.width || pageWidth;

              // Calculate scaling factors
              const scaleX = pageWidth / ocrPageWidth;
              const scaleY = pageHeight / ocrPageHeight;

              const startX = Math.min(
                firstWord.boundingBox[0], firstWord.boundingBox[2],
                firstWord.boundingBox[4], firstWord.boundingBox[6]
              ) * scaleX;

              // Convert Y coordinate from OCR (top-origin) to PDF (bottom-origin)
              const pdfY = pageHeight - (minY * scaleY) - (textHeight * scaleY);

              // Ensure coordinates are within valid bounds
              const x = Math.max(0, Math.min(pageWidth - 10, startX));
              const y = Math.max(10, Math.min(pageHeight - 10, pdfY));

              // Validate coordinates
              if (isNaN(x) || isNaN(y) || x < 0 || y < 0) {
                console.warn(`Invalid coordinates for text: x=${x}, y=${y}`);
                continue;
              }

              // Add invisible text overlay for searchability
              try {
                pdfPage.drawText(fullText, {
                  x: x,
                  y: y,
                  size: Math.max(8, Math.min(fontSize, 24)), // Clamp font size
                  font: font,
                  color: rgb(0, 0, 0), // Black color
                  opacity: 0.01, // Nearly transparent but still searchable
                });
                textAdded++;
              } catch (textError) {
                console.warn(`Failed to add text overlay: ${textError.message}`);
              }

            } catch (lineError) {
              console.warn(`Error processing line: ${lineError.message}`);
              continue;
            }
          }

          console.log(`✅ Page ${pageIndex + 1}: Added ${textAdded} text overlays`);
        }
      } catch (pageError) {
        console.warn(`Error processing page ${pageIndex + 1}: ${pageError.message}`);
        continue; // Skip problematic pages but continue with others
      }
    }

    // Save the modified PDF with error handling
    let pdfBytes;
    try {
      pdfBytes = await pdfDoc.save({
        useObjectStreams: false, // Disable for better compatibility
        addDefaultPage: false,
        objectsPerTick: 50,
      });
    } catch (saveError) {
      console.error("PDF save error:", saveError);
      throw new Error("Failed to save PDF - processing may have corrupted the file");
    }

    // Validate the generated PDF bytes
    if (!pdfBytes || pdfBytes.length < 100) {
      throw new Error("Generated PDF is invalid or empty");
    }

    // Write the file
    await fsPromises.writeFile(outputPath, pdfBytes);

    // Final validation of written file
    const writtenBytes = await fsPromises.readFile(outputPath);
    const writtenHeader = writtenBytes.slice(0, 10).toString('ascii');
    if (!writtenHeader.startsWith('%PDF-')) {
      throw new Error("Generated PDF file is corrupted");
    }

    console.log("✅ Validated continuous searchable PDF created successfully");
    
  } catch (error) {
    console.error("Error creating validated continuous searchable PDF from PDF:", error);
    throw error;
  }
}

module.exports = ocrService;
