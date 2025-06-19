import { createLogger } from "../common/logger";
import { BadRequestError } from "../common/errors";
import { MAX_FILE_SIZE } from "../constants";

const logger = createLogger("file-validation-service");

export class FileValidationService {
  private static instance: FileValidationService;

  // Comprehensive security rules
  private static readonly BLOCKED_EXTENSIONS = [
    // Executables
    ".exe",
    ".msi",
    ".scr",
    ".com",
    ".bat",
    ".cmd",
    ".pif",
    // Scripts
    ".vbs",
    ".vbe",
    ".js",
    ".jse",
    ".ws",
    ".wsf",
    ".wsc",
    ".wsh",
    // System files
    ".dll",
    ".sys",
    ".drv",
    ".cpl",
    ".ocx",
    // Archives that could contain executables
    ".rar",
    ".7z",
    ".ace",
    ".arj",
    // Office macros
    ".xlsm",
    ".pptm",
    ".docm",
    ".dotm",
    // Other potentially dangerous
    ".jar",
    ".app",
    ".deb",
    ".rpm",
    ".dmg",
    ".pkg",
    ".iso",
    ".img",
    ".bin",
    ".toast",
    ".vcd",
  ];

  private static readonly ALLOWED_EXTENSIONS = [
    // Images
    ".jpg",
    ".jpeg",
    ".png",
    ".gif",
    ".webp",
    ".bmp",
    ".svg",
    ".ico",
    // Documents
    ".pdf",
    ".doc",
    ".docx",
    ".xls",
    ".xlsx",
    ".ppt",
    ".pptx",
    ".txt",
    ".rtf",
    // Audio
    ".mp3",
    ".wav",
    ".flac",
    ".aac",
    ".ogg",
    ".m4a",
    // Video
    ".mp4",
    ".avi",
    ".mov",
    ".wmv",
    ".flv",
    ".mkv",
    ".webm",
    // Archives (safe ones)
    ".zip",
    ".tar",
    ".gz",
  ];

  private static readonly MAX_FILE_SIZE = MAX_FILE_SIZE; // 25MB
  private static readonly SUSPICIOUS_NAMES = [
    "autorun",
    "setup",
    "install",
    "update",
    "patch",
    "crack",
    "keygen",
  ];

  private constructor() {}

  static getInstance(): FileValidationService {
    if (!FileValidationService.instance) {
      FileValidationService.instance = new FileValidationService();
    }
    return FileValidationService.instance;
  }
  /**
   * Comprehensive file validation before upload
   */
  async validateFile(data: {
    fileName: string;
    fileType: string;
    fileSize: number;
    fileBuffer?: Buffer; // Optional for deeper inspection
  }): Promise<{
    isValid: boolean;
    reason?: string;
    severity: "block" | "warn";
  }> {
    const { fileName, fileType, fileSize, fileBuffer } = data;

    logger.debug("Validating file", { fileName, fileType, fileSize });
    // 1. File size validation
    if (fileSize > FileValidationService.MAX_FILE_SIZE) {
      return {
        isValid: false,
        reason: `File size exceeds ${
          FileValidationService.MAX_FILE_SIZE / (1024 * 1024)
        }MB limit`,
        severity: "block",
      };
    }

    if (fileSize === 0) {
      return {
        isValid: false,
        reason: "File is empty",
        severity: "block",
      };
    }

    // 2. File extension validation
    const extension = this.getFileExtension(fileName);

    if (FileValidationService.BLOCKED_EXTENSIONS.includes(extension)) {
      return {
        isValid: false,
        reason: `File type '${extension}' is not allowed for security reasons`,
        severity: "block",
      };
    }

    if (!FileValidationService.ALLOWED_EXTENSIONS.includes(extension)) {
      return {
        isValid: false,
        reason: `File type '${extension}' is not supported`,
        severity: "block",
      };
    }

    // 3. MIME type validation
    const mimeValidation = this.validateMimeType(fileType, extension);
    if (!mimeValidation.isValid) {
      return mimeValidation;
    }

    // 4. File name validation
    const nameValidation = this.validateFileName(fileName);
    if (!nameValidation.isValid) {
      return nameValidation;
    }

    // 5. Magic number validation (if buffer provided)
    if (fileBuffer) {
      const magicValidation = this.validateMagicNumbers(fileBuffer, extension);
      if (!magicValidation.isValid) {
        return magicValidation;
      }
    }

    logger.info("File validation passed", { fileName, fileType, fileSize });

    return { isValid: true, severity: "warn" };
  }
  /**
   * Get file extension safely
   */
  private getFileExtension(fileName: string): string {
    const lastDot = fileName.lastIndexOf(".");
    if (lastDot === -1) return "";
    return fileName.substring(lastDot).toLowerCase();
  }

  /**
   * Validate MIME type matches extension
   */
  private validateMimeType(
    mimeType: string,
    extension: string,
  ): { isValid: boolean; reason?: string; severity: "block" | "warn" } {
    const mimeExtensionMap: Record<string, string[]> = {
      "image/jpeg": [".jpg", ".jpeg"],
      "image/png": [".png"],
      "image/gif": [".gif"],
      "image/webp": [".webp"],
      "image/svg+xml": [".svg"],
      "application/pdf": [".pdf"],
      "text/plain": [".txt"],
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
        [".docx"],
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [
        ".xlsx",
      ],
      "video/mp4": [".mp4"],
      "audio/mpeg": [".mp3"],
      "application/zip": [".zip"],
    };

    const expectedExtensions = mimeExtensionMap[mimeType];
    if (expectedExtensions && !expectedExtensions.includes(extension)) {
      return {
        isValid: false,
        reason: `MIME type '${mimeType}' doesn't match file extension '${extension}'`,
        severity: "block",
      };
    }

    return { isValid: true, severity: "warn" };
  }

  /**
   * Validate file name for suspicious patterns
   */
  private validateFileName(fileName: string): {
    isValid: boolean;
    reason?: string;
    severity: "block" | "warn";
  } {
    const lowerName = fileName.toLowerCase();

    // Check for suspicious names
    for (const suspicious of FileValidationService.SUSPICIOUS_NAMES) {
      if (lowerName.includes(suspicious)) {
        return {
          isValid: false,
          reason: `File name contains suspicious keyword: '${suspicious}'`,
          severity: "block",
        };
      }
    }

    // Check for multiple extensions (e.g., file.txt.exe)
    const parts = fileName.split(".");
    if (parts.length > 3) {
      return {
        isValid: false,
        reason: "File name has too many extensions, which is suspicious",
        severity: "block",
      };
    }

    // Check for extremely long names
    if (fileName.length > 255) {
      return {
        isValid: false,
        reason: "File name is too long",
        severity: "block",
      };
    }

    return { isValid: true, severity: "warn" };
  }

  /**
   * Validate file magic numbers (file signatures)
   */
  private validateMagicNumbers(
    buffer: Buffer,
    extension: string,
  ): { isValid: boolean; reason?: string; severity: "block" | "warn" } {
    if (buffer.length < 4) {
      return { isValid: true, severity: "warn" }; // Too small to check
    }

    const magicNumbers: Record<string, Buffer[]> = {
      ".jpg": [Buffer.from([0xff, 0xd8, 0xff])],
      ".jpeg": [Buffer.from([0xff, 0xd8, 0xff])],
      ".png": [Buffer.from([0x89, 0x50, 0x4e, 0x47])],
      ".gif": [Buffer.from([0x47, 0x49, 0x46, 0x38])],
      ".pdf": [Buffer.from([0x25, 0x50, 0x44, 0x46])],
      ".zip": [
        Buffer.from([0x50, 0x4b, 0x03, 0x04]),
        Buffer.from([0x50, 0x4b, 0x05, 0x06]),
      ],
      ".mp4": [
        Buffer.from([0x00, 0x00, 0x00, 0x18]),
        Buffer.from([0x00, 0x00, 0x00, 0x20]),
      ],
    };

    const expectedMagics = magicNumbers[extension];
    if (expectedMagics) {
      const isValid = expectedMagics.some((magic) =>
        buffer.subarray(0, magic.length).equals(magic),
      );

      if (!isValid) {
        return {
          isValid: false,
          reason: `File content doesn't match expected format for '${extension}'`,
          severity: "block",
        };
      }
    }

    return { isValid: true, severity: "warn" };
  }
  /**
   * Quick validation for upload URL generation (no buffer needed)
   */
  async quickValidate(data: {
    fileName: string;
    fileType: string;
    fileSize: number;
  }): Promise<void> {
    const result = await this.validateFile(data);

    if (!result.isValid) {
      throw new BadRequestError(result.reason || "File validation failed");
    }
  }

  /**
   * Full validation with file content (for complete upload)
   */
  async fullValidate(data: {
    fileName: string;
    fileType: string;
    fileSize: number;
    fileBuffer: Buffer;
  }): Promise<void> {
    const result = await this.validateFile(data);

    if (!result.isValid) {
      throw new BadRequestError(result.reason || "File validation failed");
    }
  }
}
export const fileValidationService = FileValidationService.getInstance();
