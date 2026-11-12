import { IsInt, IsOptional, Max, Min } from "class-validator";

export class ListDocumentsDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  page = 1;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize = 20;
}
