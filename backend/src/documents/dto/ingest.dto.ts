import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsObject,
  MinLength,
} from "class-validator";

export class IngestDto {
  @IsString()
  @IsNotEmpty()
  title: string;

  @IsString()
  @MinLength(10, { message: "Content must be at least 10 characters." })
  content: string;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, any>;
}
