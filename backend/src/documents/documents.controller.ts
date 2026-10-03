import {
  Controller,
  Post,
  Get,
  Body,
  UploadedFile,
  UseInterceptors,
  BadRequestException,
  Logger,
  HttpCode,
  HttpStatus,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { memoryStorage } from "multer";
import { DocumentsService } from "./documents.service";
import { IngestDto } from "./dto/ingest.dto";
import pdfParse = require("pdf-parse");

@Controller("documents")
export class DocumentsController {
  private readonly logger = new Logger(DocumentsController.name);

  constructor(private readonly documentsService: DocumentsService) {}

  @Post("ingest")
  @HttpCode(HttpStatus.CREATED)
  async ingest(@Body() dto: IngestDto) {
    this.logger.log(`Ingest request for: "${dto.title}"`);
    const result = await this.documentsService.ingestText(dto);
    return { success: true, ...result };
  }

  @Post("upload")
  @HttpCode(HttpStatus.CREATED)
  @UseInterceptors(
    FileInterceptor("file", {
      storage: memoryStorage(),
      limits: { fileSize: 20 * 1024 * 1024 },
      fileFilter: (_req, file, cb) => {
        const allowed = [
          "text/plain",
          "text/markdown",
          "application/pdf",
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        ];
        if (allowed.includes(file.mimetype)) {
          cb(null, true);
        } else {
          cb(
            new BadRequestException(`Unsupported file type: ${file.mimetype}`),
            false,
          );
        }
      },
    }),
  )
  async upload(@UploadedFile() file: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException("No file provided.");
    }

    this.logger.log(
      `Upload: ${file.originalname} (${file.mimetype}, ${file.size} bytes)`,
    );

    this.logger.log("STEP 1: Before extractText");

    const text = await this.extractText(file);

    this.logger.log(
      `STEP 2: extractText completed - ${text.length} characters`,
    );

    const title = file.originalname.replace(/\.[^.]+$/, "");

    this.logger.log("STEP 3: Before ingestBuffer");

    const result = await this.documentsService.ingestBuffer(title, text, {
      originalName: file.originalname,
      mimeType: file.mimetype,
      sizeBytes: file.size,
    });

    this.logger.log("STEP 4: ingestBuffer completed");

    return { success: true, ...result };
  }

  @Get("stats")
  async stats() {
    return this.documentsService.getStats();
  }

  private async extractText(file: Express.Multer.File): Promise<string> {
    const { mimetype, buffer } = file;

    if (mimetype === "text/plain" || mimetype === "text/markdown") {
      return buffer.toString("utf-8");
    }

    if (mimetype === "application/pdf") {
      try {
        this.logger.log("PDF: Starting pdfParse");

        const data = await pdfParse(buffer);

        this.logger.log(
          `PDF: Parsing completed, text length = ${data.text.length}`,
        );

        return data.text;
      } catch (error) {
        console.error("PDF parsing error:", error);

        throw new BadRequestException("Failed to parse PDF file.");
      }
    }

    if (
      mimetype ===
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    ) {
      return this.extractDocxText(buffer);
    }

    throw new BadRequestException(`Unsupported MIME type: ${mimetype}`);
  }

  private async extractDocxText(buffer: Buffer): Promise<string> {
    try {
      const { execSync } = await import("child_process");
      const { writeFileSync, readFileSync } = await import("fs");
      const { join } = await import("path");

      const tmpZip = join("/tmp", `docx_${Date.now()}.docx`);
      const tmpDir = join("/tmp", `docx_${Date.now()}`);

      writeFileSync(tmpZip, buffer);
      execSync(`unzip -q -o "${tmpZip}" word/document.xml -d "${tmpDir}"`, {
        timeout: 10_000,
      });

      const xml = readFileSync(join(tmpDir, "word", "document.xml"), "utf-8");

      try {
        execSync(`rm -rf "${tmpDir}" "${tmpZip}"`);
      } catch {}

      const textParts = [...xml.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map(
        (m) => m[1],
      );

      return textParts.join(" ");
    } catch {
      throw new BadRequestException("Failed to extract text from DOCX file.");
    }
  }
}
