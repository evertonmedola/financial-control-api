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
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CategoriesService } from './categories.service';
import { CategoryResponseDto } from './dto/category-response.dto';
import { CreateCategoryDto } from './dto/create-category.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';

// Guard applied at controller level (not per-route as in AuthController)
// since every Categories route requires authentication — same deviation as
// AccountsController, per 02-PATTERNS.md.
@UseGuards(JwtAuthGuard)
@Controller('categories')
export class CategoriesController {
  constructor(private readonly categoriesService: CategoriesService) {}

  @Post()
  async create(
    @CurrentUser() userId: string,
    @Body() dto: CreateCategoryDto,
  ): Promise<CategoryResponseDto> {
    const category = await this.categoriesService.create(userId, dto);
    return CategoryResponseDto.fromEntity(category);
  }

  @Get()
  async findAll(@CurrentUser() userId: string): Promise<CategoryResponseDto[]> {
    const categories = await this.categoriesService.findAll(userId);
    return categories.map((category) =>
      CategoryResponseDto.fromEntity(category),
    );
  }

  @Get(':id')
  async findOne(
    @CurrentUser() userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<CategoryResponseDto> {
    const category = await this.categoriesService.findOne(userId, id);
    return CategoryResponseDto.fromEntity(category);
  }

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
  @Delete(':id')
  async remove(
    @CurrentUser() userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<Record<string, never>> {
    await this.categoriesService.remove(userId, id);
    return {};
  }
}
