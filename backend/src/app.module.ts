import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { GeminiModule } from "./gemini/gemini.module";
import { DocumentsModule } from "./documents/documents.module";
import { ChatModule } from "./chat/chat.module";
import { DatabaseModule } from "./common/database.module";
import { AuthModule } from "./auth/auth.module";

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: ".env" }),
    DatabaseModule,
    AuthModule,
    GeminiModule,
    DocumentsModule,
    ChatModule,
  ],
})
export class AppModule {}
