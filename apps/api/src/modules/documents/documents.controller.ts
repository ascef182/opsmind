import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Res,
  StreamableFile,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import type { Document } from '@opsmind/database';
import { DocumentsService } from './documents.service';
import { UploadDocumentDto } from './dto/upload-document.dto';
import { TenantGuard } from '../../shared/guards/tenant.guard';
import { RolesGuard } from '../../shared/guards/roles.guard';
import { Roles } from '../../shared/decorators/roles.decorator';
import { CurrentUser } from '../../shared/decorators/current-user.decorator';
import { WRITE_ROLES } from '../../shared/constants/roles.constant';

const MAX_UPLOAD_SIZE_BYTES = 10 * 1024 * 1024; // 10MB — generoso pra um contrato em PDF, sem abrir a porta pra abuso.

// Mesma política de RBAC de customers/tasks: leitura aberta a qualquer
// membro, upload exige papel acima de VIEWER.
@UseGuards(TenantGuard)
@Controller('organizations/:organizationId/documents')
export class DocumentsController {
  constructor(private readonly documentsService: DocumentsService) {}

  @Roles(...WRITE_ROLES)
  @UseGuards(RolesGuard)
  @Post()
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_UPLOAD_SIZE_BYTES } }))
  upload(
    @Param('organizationId') organizationId: string,
    @CurrentUser() user: { id: string },
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() dto: UploadDocumentDto,
  ): Promise<Document> {
    if (!file) {
      throw new BadRequestException('Nenhum arquivo enviado (campo "file").');
    }
    return this.documentsService.upload(organizationId, user.id, file, dto.customerId);
  }

  @Get()
  list(
    @Param('organizationId') organizationId: string,
    @Query('customerId') customerId?: string,
  ): Promise<Document[]> {
    return this.documentsService.list(organizationId, customerId);
  }

  @Get(':documentId')
  findOne(
    @Param('organizationId') organizationId: string,
    @Param('documentId') documentId: string,
  ): Promise<Document> {
    return this.documentsService.findByIdOrThrow(organizationId, documentId);
  }

  @Get(':documentId/download')
  async download(
    @Param('organizationId') organizationId: string,
    @Param('documentId') documentId: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const file = await this.documentsService.getFileForDownload(organizationId, documentId);
    res.set({
      'Content-Type': file.mimeType,
      'Content-Disposition': `attachment; filename="${encodeURIComponent(file.filename)}"`,
    });
    return new StreamableFile(file.buffer);
  }
}
