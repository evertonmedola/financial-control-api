import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ApiEnvelopedResponse } from '../common/swagger/api-envelope-response.decorator';
import { ApiErrorResponses } from '../common/swagger/api-error-responses.decorator';
import { CategoriesService } from './categories.service';
import { CategoryResponseDto } from './dto/category-response.dto';
import { CreateCategoryDto } from './dto/create-category.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';

// Guard applied at controller level (not per-route as in AuthController)
// since every Categories route requires authentication — same deviation as
// AccountsController, per 02-PATTERNS.md.
@ApiTags('Categories')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('categories')
export class CategoriesController {
  constructor(private readonly categoriesService: CategoriesService) {}

  @ApiOperation({ summary: 'Create a category' })
  @ApiEnvelopedResponse({
    status: 201,
    description: 'Category created.',
    model: CategoryResponseDto,
  })
  @ApiErrorResponses(400, 401, 409)
  @Post()
  async create(
    @CurrentUser() userId: string,
    @Body() dto: CreateCategoryDto,
  ): Promise<CategoryResponseDto> {
    const category = await this.categoriesService.create(userId, dto);
    return CategoryResponseDto.fromEntity(category);
  }

  @ApiOperation({ summary: "List the authenticated user's categories" })
  @ApiEnvelopedResponse({
    status: 200,
    description: 'List of categories.',
    model: CategoryResponseDto,
    isArray: true,
  })
  @ApiErrorResponses(401)
  @Get()
  async findAll(@CurrentUser() userId: string): Promise<CategoryResponseDto[]> {
    const categories = await this.categoriesService.findAll(userId);
    return categories.map((category) =>
      CategoryResponseDto.fromEntity(category),
    );
  }

  @ApiOperation({ summary: 'Get a category by id' })
  @ApiParam({ name: 'id', format: 'uuid', description: 'Category id.' })
  @ApiEnvelopedResponse({
    status: 200,
    description: 'The category.',
    model: CategoryResponseDto,
  })
  @ApiErrorResponses(400, 401, 404)
  @Get(':id')
  async findOne(
    @CurrentUser() userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<CategoryResponseDto> {
    const category = await this.categoriesService.findOne(userId, id);
    return CategoryResponseDto.fromEntity(category);
  }

  @ApiOperation({ summary: 'Rename a category (only the name is editable)' })
  @ApiParam({ name: 'id', format: 'uuid', description: 'Category id.' })
  @ApiEnvelopedResponse({
    status: 200,
    description: 'The updated category.',
    model: CategoryResponseDto,
  })
  @ApiErrorResponses(400, 401, 404, 409)
  @Patch(':id')
  async update(
    @CurrentUser() userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCategoryDto,
  ): Promise<CategoryResponseDto> {
    const category = await this.categoriesService.update(userId, id, dto);
    return CategoryResponseDto.fromEntity(category);
  }

  // Nest's @Delete() default status is already 200 — no @HttpCode override
  // needed. Returns {} mirroring AccountsController.remove()'s already-
  // established empty-envelope convention, for response-shape consistency.
  @ApiOperation({ summary: 'Delete a category (soft delete)' })
  @ApiParam({ name: 'id', format: 'uuid', description: 'Category id.' })
  @ApiEnvelopedResponse({
    status: 200,
    description: 'Category deleted; the payload is an empty object.',
  })
  @ApiErrorResponses(400, 401, 404)
  @Delete(':id')
  async remove(
    @CurrentUser() userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<Record<string, never>> {
    await this.categoriesService.remove(userId, id);
    return {};
  }
}
