import {
  Controller,
  Post,
  Body,
  HttpCode,
  HttpStatus,
  Logger,
} from "@nestjs/common";
import { ChatService } from "./chat.service";
import { ChatDto } from "./dto/chat.dto";

@Controller("chat")
export class ChatController {
  private readonly logger = new Logger(ChatController.name);

  constructor(private readonly chatService: ChatService) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  async chat(@Body() dto: ChatDto) {
    this.logger.log(`POST /chat – question="${dto.question}"`);
    return this.chatService.chat(dto);
  }
}
