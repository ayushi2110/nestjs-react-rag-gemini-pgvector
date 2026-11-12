import { Module } from "@nestjs/common";
import { DocumentsController } from "./documents.controller";
import { DocumentsService } from "./documents.service";
import { ChunkingService } from "./chunking.service";
import { GeminiModule } from "../gemini/gemini.module";
import { AuthModule } from "../auth/auth.module";

@Module({
  imports: [GeminiModule, AuthModule],
  controllers: [DocumentsController],
  providers: [DocumentsService, ChunkingService],
  exports: [DocumentsService],
})
export class DocumentsModule {}
