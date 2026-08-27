import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import type { ActivityLog, Customer } from '@opsmind/database';
import { CustomersService } from './customers.service';
import { ActivityService } from '../activity/activity.service';
import { CreateCustomerDto } from './dto/create-customer.dto';
import { UpdateCustomerDto } from './dto/update-customer.dto';
import { ListCustomersQueryDto } from './dto/list-customers-query.dto';
import { AddNoteDto } from './dto/add-note.dto';
import { TenantGuard } from '../../shared/guards/tenant.guard';
import { RolesGuard } from '../../shared/guards/roles.guard';
import { Roles } from '../../shared/decorators/roles.decorator';
import { CurrentUser } from '../../shared/decorators/current-user.decorator';

// Toda rota exige vínculo com a organização (TenantGuard). Leitura é aberta a
// qualquer papel, inclusive VIEWER; escrita exige papel acima de VIEWER
// (RolesGuard) — CRM é trabalho operacional, não administração de conta.
const WRITE_ROLES = ['OWNER', 'ADMIN', 'MANAGER', 'MEMBER'] as const;

@UseGuards(TenantGuard)
@Controller('organizations/:organizationId/customers')
export class CustomersController {
  constructor(
    private readonly customersService: CustomersService,
    private readonly activityService: ActivityService,
  ) {}

  @Roles(...WRITE_ROLES)
  @UseGuards(RolesGuard)
  @Post()
  create(
    @Param('organizationId') organizationId: string,
    @CurrentUser() user: { id: string },
    @Body() dto: CreateCustomerDto,
  ): Promise<Customer> {
    return this.customersService.create(organizationId, dto, user.id);
  }

  @Get()
  list(
    @Param('organizationId') organizationId: string,
    @Query() query: ListCustomersQueryDto,
  ): Promise<Customer[]> {
    return this.customersService.list(organizationId, query);
  }

  @Get(':customerId')
  findOne(
    @Param('organizationId') organizationId: string,
    @Param('customerId') customerId: string,
  ): Promise<Customer> {
    return this.customersService.findByIdOrThrow(organizationId, customerId);
  }

  @Roles(...WRITE_ROLES)
  @UseGuards(RolesGuard)
  @Patch(':customerId')
  update(
    @Param('organizationId') organizationId: string,
    @Param('customerId') customerId: string,
    @CurrentUser() user: { id: string },
    @Body() dto: UpdateCustomerDto,
  ): Promise<Customer> {
    return this.customersService.update(organizationId, customerId, dto, user.id);
  }

  @Roles(...WRITE_ROLES)
  @UseGuards(RolesGuard)
  @HttpCode(204)
  @Delete(':customerId')
  async remove(
    @Param('organizationId') organizationId: string,
    @Param('customerId') customerId: string,
    @CurrentUser() user: { id: string },
  ): Promise<void> {
    await this.customersService.softDelete(organizationId, customerId, user.id);
  }

  @Get(':customerId/timeline')
  timeline(
    @Param('organizationId') organizationId: string,
    @Param('customerId') customerId: string,
  ): Promise<ActivityLog[]> {
    return this.activityService.listForCustomer(organizationId, customerId);
  }

  @Roles(...WRITE_ROLES)
  @UseGuards(RolesGuard)
  @Post(':customerId/notes')
  addNote(
    @Param('organizationId') organizationId: string,
    @Param('customerId') customerId: string,
    @CurrentUser() user: { id: string },
    @Body() dto: AddNoteDto,
  ): Promise<ActivityLog> {
    return this.customersService.addNote(organizationId, customerId, dto.note, user.id);
  }
}
