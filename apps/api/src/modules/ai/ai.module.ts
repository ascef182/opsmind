import { Module } from '@nestjs/common';
import { CustomersModule } from '../customers/customers.module';
import { TasksModule } from '../tasks/tasks.module';
import { ActivityModule } from '../activity/activity.module';
import { OrganizationsModule } from '../organizations/organizations.module';
import { DocumentsModule } from '../documents/documents.module';
import { LeadsModule } from '../leads/leads.module';
import { DealsModule } from '../deals/deals.module';
import { AiService } from './ai.service';
import { AiController } from './ai.controller';
import { BudgetService } from './services/budget.service';
import { AiUsageService } from './services/ai-usage.service';
import { AI_GATEWAY } from './gateway/ai-gateway.interface';
import { ClaudeGatewayService } from './gateway/claude-gateway.service';
import { AI_TOOLS, type AiTool } from './tools/ai-tool.interface';
import { GetCustomerTool } from './tools/get-customer.tool';
import { SearchCustomersTool } from './tools/search-customers.tool';
import { GetCustomerActivityTool } from './tools/get-customer-activity.tool';
import { ListInactiveCustomersTool } from './tools/list-inactive-customers.tool';
import { ListTasksTool } from './tools/list-tasks.tool';
import { CreateTaskTool } from './tools/create-task.tool';
import { SearchDocumentsTool } from './tools/search-documents.tool';
import { FindLeadsTool } from './tools/find-leads.tool';
import { ScoreLeadTool } from './tools/score-lead.tool';
import { AnalyzeLeadPotentialTool } from './tools/analyze-lead-potential.tool';
import { GenerateOutreachMessageTool } from './tools/generate-outreach-message.tool';
import { CreateDealTool } from './tools/create-deal.tool';
import { MoveDealStageTool } from './tools/move-deal-stage.tool';
import { ListDealsTool } from './tools/list-deals.tool';
import { GenerateDealProposalTool } from './tools/generate-deal-proposal.tool';
import { TenantGuard } from '../../shared/guards/tenant.guard';

@Module({
  imports: [
    CustomersModule,
    TasksModule,
    ActivityModule,
    OrganizationsModule,
    DocumentsModule,
    LeadsModule,
    DealsModule,
  ],
  controllers: [AiController],
  providers: [
    AiService,
    BudgetService,
    AiUsageService,
    TenantGuard,
    { provide: AI_GATEWAY, useClass: ClaudeGatewayService },
    GetCustomerTool,
    SearchCustomersTool,
    GetCustomerActivityTool,
    ListInactiveCustomersTool,
    ListTasksTool,
    CreateTaskTool,
    SearchDocumentsTool,
    FindLeadsTool,
    ScoreLeadTool,
    AnalyzeLeadPotentialTool,
    GenerateOutreachMessageTool,
    CreateDealTool,
    MoveDealStageTool,
    ListDealsTool,
    GenerateDealProposalTool,
    {
      provide: AI_TOOLS,
      useFactory: (
        getCustomer: GetCustomerTool,
        searchCustomers: SearchCustomersTool,
        getCustomerActivity: GetCustomerActivityTool,
        listInactiveCustomers: ListInactiveCustomersTool,
        listTasks: ListTasksTool,
        createTask: CreateTaskTool,
        searchDocuments: SearchDocumentsTool,
        findLeads: FindLeadsTool,
        scoreLead: ScoreLeadTool,
        analyzeLeadPotential: AnalyzeLeadPotentialTool,
        generateOutreachMessage: GenerateOutreachMessageTool,
        createDeal: CreateDealTool,
        moveDealStage: MoveDealStageTool,
        listDeals: ListDealsTool,
        generateDealProposal: GenerateDealProposalTool,
      ): AiTool[] => [
        getCustomer,
        searchCustomers,
        getCustomerActivity,
        listInactiveCustomers,
        listTasks,
        createTask,
        searchDocuments,
        findLeads,
        scoreLead,
        analyzeLeadPotential,
        generateOutreachMessage,
        createDeal,
        moveDealStage,
        listDeals,
        generateDealProposal,
      ],
      inject: [
        GetCustomerTool,
        SearchCustomersTool,
        GetCustomerActivityTool,
        ListInactiveCustomersTool,
        ListTasksTool,
        CreateTaskTool,
        SearchDocumentsTool,
        FindLeadsTool,
        ScoreLeadTool,
        AnalyzeLeadPotentialTool,
        GenerateOutreachMessageTool,
        CreateDealTool,
        MoveDealStageTool,
        ListDealsTool,
        GenerateDealProposalTool,
      ],
    },
  ],
})
export class AiModule {}
