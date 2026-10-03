import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsInt,
  Min,
  Max,
} from "class-validator";

export class ChatDto {
  @IsString()
  @IsNotEmpty()
  question: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(20)
  topK?: number;
}
