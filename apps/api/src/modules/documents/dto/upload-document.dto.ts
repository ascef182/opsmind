import { IsOptional, IsUUID } from 'class-validator';

/** O arquivo em si vem via multipart (`@UploadedFile()`), não faz parte deste DTO. */
export class UploadDocumentDto {
  @IsOptional()
  @IsUUID()
  customerId?: string;
}
