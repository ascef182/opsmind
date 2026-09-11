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
import type { RedditWatchTopic } from '@opsmind/database';
import { RedditWatchTopicsService } from './reddit-watch-topics.service';
import { CreateRedditWatchTopicDto } from './dto/create-reddit-watch-topic.dto';
import { UpdateRedditWatchTopicDto } from './dto/update-reddit-watch-topic.dto';
import { TenantGuard } from '../../shared/guards/tenant.guard';
import { RolesGuard } from '../../shared/guards/roles.guard';
import { Roles } from '../../shared/decorators/roles.decorator';
import { CurrentUser } from '../../shared/decorators/current-user.decorator';
import { WRITE_ROLES } from '../../shared/constants/roles.constant';

@UseGuards(TenantGuard)
@Controller('organizations/:organizationId/reddit-watch-topics')
export class RedditWatchTopicsController {
  constructor(private readonly redditWatchTopicsService: RedditWatchTopicsService) {}

  @Roles(...WRITE_ROLES)
  @UseGuards(RolesGuard)
  @Post()
  create(
    @Param('organizationId') organizationId: string,
    @CurrentUser() user: { id: string },
    @Body() dto: CreateRedditWatchTopicDto,
  ): Promise<RedditWatchTopic> {
    return this.redditWatchTopicsService.create(organizationId, dto, user.id);
  }

  @Get()
  list(
    @Param('organizationId') organizationId: string,
    @Query('isActive') isActive?: string,
  ): Promise<RedditWatchTopic[]> {
    return this.redditWatchTopicsService.list(organizationId, {
      isActive: isActive === undefined ? undefined : isActive === 'true',
    });
  }

  @Get(':topicId')
  findOne(
    @Param('organizationId') organizationId: string,
    @Param('topicId') topicId: string,
  ): Promise<RedditWatchTopic> {
    return this.redditWatchTopicsService.findByIdOrThrow(organizationId, topicId);
  }

  @Roles(...WRITE_ROLES)
  @UseGuards(RolesGuard)
  @Patch(':topicId')
  update(
    @Param('organizationId') organizationId: string,
    @Param('topicId') topicId: string,
    @CurrentUser() user: { id: string },
    @Body() dto: UpdateRedditWatchTopicDto,
  ): Promise<RedditWatchTopic> {
    return this.redditWatchTopicsService.update(organizationId, topicId, dto, user.id);
  }

  @Roles(...WRITE_ROLES)
  @UseGuards(RolesGuard)
  @HttpCode(204)
  @Delete(':topicId')
  async remove(
    @Param('organizationId') organizationId: string,
    @Param('topicId') topicId: string,
    @CurrentUser() user: { id: string },
  ): Promise<void> {
    await this.redditWatchTopicsService.remove(organizationId, topicId, user.id);
  }
}
