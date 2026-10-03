import { Module } from "@nestjs/common";
import { ChatController } from "./chat.controller";
import { ChatService } from "./chat.service";
import { GeminiModule } from "../gemini/gemini.module";
import { DocumentsModule } from "../documents/documents.module";

@Module({
  imports: [GeminiModule, DocumentsModule],
  controllers: [ChatController],
  providers: [ChatService],
})
export class ChatModule {}
