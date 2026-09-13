import { ConflictException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CreateCategoryDto } from './dto/create-category.dto';
import { Category } from './entities/category.entity';

// Postgres unique-violation error code.
const POSTGRES_UNIQUE_VIOLATION = '23505';

@Injectable()
export class CategoriesService {
  constructor(
    @InjectRepository(Category)
    private readonly categoriesRepository: Repository<Category>,
  ) {}

  // D-03: the database-level partial unique index (UQ_categories_user_id_
  // name_type) is the actual enforcement mechanism; this catch only
  // translates the resulting Postgres error into a friendly 409, closing
  // any app-layer TOCTOU race a pre-check-then-insert approach would have.
  async create(userId: string, dto: CreateCategoryDto): Promise<Category> {
    const category = this.categoriesRepository.create({ ...dto, userId });

    try {
      return await this.categoriesRepository.save(category);
    } catch (error) {
      if (this.isUniqueViolation(error)) {
        throw new ConflictException(
          'já existe uma categoria com esse nome para este tipo',
        );
      }
      throw error;
    }
  }

  private isUniqueViolation(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code?: string }).code === POSTGRES_UNIQUE_VIOLATION
    );
  }
}
