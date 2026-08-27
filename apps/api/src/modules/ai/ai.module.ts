import { Module } from '@nestjs/common';
import { CustomersModule } from '../customers/customers.module';
import { TasksModule } from '../tasks/tasks.module';
import { ActivityModule } from '../activity/activity.module';
import { OrganizationsModule } from '../organizations/organizations.module';
import { AiService } from './ai.service';
import { AiController } from './ai.controller';
import { BudgetService } from './services/budget.service';
import { AI_GATEWAY } from './gateway/ai-gateway.interface';
import { ClaudeGatewayService } from './gateway/claude-gateway.service';
import { AI_TOOLS, type AiTool } from './tools/ai-tool.interface';
import { GetCustomerTool } from './tools/get-customer.tool';
import { SearchCustomersTool } from './tools/search-customers.tool';
import { GetCustomerActivityTool } from './tools/get-customer-activity.tool';
import { ListTasksTool } from './tools/list-tasks.tool';
import { CreateTaskTool } from './tools/create-task.tool';
import { TenantGuard } from '../../shared/guards/tenant.guard';

@Module({
  imports: [CustomersModule, TasksModule, ActivityModule, OrganizationsModule],
  controllers: [AiController],
  providers: [
    AiService,
    BudgetService,
    TenantGuard,
    { provide: AI_GATEWAY, useClass: ClaudeGatewayService },
    GetCustomerTool,
    SearchCustomersTool,
    GetCustomerActivityTool,
    ListTasksTool,
    CreateTaskTool,
    {
      provide: AI_TOOLS,
      useFactory: (
        getCustomer: GetCustomerTool,
        searchCustomers: SearchCustomersTool,
        getCustomerActivity: GetCustomerActivityTool,
        listTasks: ListTasksTool,
        createTask: CreateTaskTool,
      ): AiTool[] => [getCustomer, searchCustomers, getCustomerActivity, listTasks, createTask],
      inject: [GetCustomerTool, SearchCustomersTool, GetCustomerActivityTool, ListTasksTool, CreateTaskTool],
    },
  ],
})
export class AiModule {}
