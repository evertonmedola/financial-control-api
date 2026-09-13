import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { CreateCategoryDto } from './dto/create-category.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';
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
    return this.saveOrThrowConflict(category);
  }

  // Explicit stable ordering (oldest-first) — repeated calls with no
  // intervening writes must return the same order (edge-probe: ordering).
  async findAll(userId: string): Promise<Category[]> {
    return this.categoriesRepository.find({
      where: { userId, deletedAt: IsNull() },
      order: { createdAt: 'ASC' },
    });
  }

  // 404, never 403, when the category doesn't exist or belongs to another
  // user — mirrors AccountsService's generic-error philosophy applied to
  // ownership checks (Pitfall 3, IDOR).
  async findOne(userId: string, id: string): Promise<Category> {
    const category = await this.categoriesRepository.findOne({
      where: { id, userId, deletedAt: IsNull() },
    });
    if (!category) {
      throw new NotFoundException();
    }
    return category;
  }

  // Ownership check (findOne) happens before mutation. `dto` can never
  // carry `type` — the DTO layer already excludes it (D-02, prohibition
  // P2). Renaming into a collision with another (name, type) pair for the
  // same user hits the same UQ_categories_user_id_name_type index `create()`
  // guards against, so this goes through the same conflict-translating
  // helper (CR-01 fix — previously this raw `save()` let a Postgres
  // QueryFailedError surface as an uncaught 500 instead of 409).
  async update(
    userId: string,
    id: string,
    dto: UpdateCategoryDto,
  ): Promise<Category> {
    const category = await this.findOne(userId, id);
    Object.assign(category, dto);
    return this.saveOrThrowConflict(category);
  }

  // D-01: soft delete only. Never .delete()/.remove() on the repository —
  // Phase 4's transactions and Phase 5's budgets will carry a foreign key
  // to categories.id.
  async remove(userId: string, id: string): Promise<void> {
    const category = await this.findOne(userId, id);
    category.deletedAt = new Date();
    await this.categoriesRepository.save(category);
  }

  // Shared by create() and update() (CR-01): both write paths hit the same
  // UQ_categories_user_id_name_type partial unique index, so both need the
  // identical Postgres-error-to-409 translation.
  private async saveOrThrowConflict(category: Category): Promise<Category> {
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
