import { ConflictException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CategoriesService } from './categories.service';
import { CreateCategoryDto } from './dto/create-category.dto';
import { Category, CategoryType } from './entities/category.entity';

describe('CategoriesService', () => {
  let service: CategoriesService;
  let categoriesRepository: jest.Mocked<Repository<Category>>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CategoriesService,
        {
          provide: getRepositoryToken(Category),
          useValue: {
            create: jest.fn(),
            save: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<CategoriesService>(CategoriesService);
    categoriesRepository = module.get(getRepositoryToken(Category));
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('create', () => {
    it('merges userId into the DTO and persists the category via the repository (happy path)', async () => {
      const userId = 'user-id';
      const dto: CreateCategoryDto = {
        name: 'Alimentação',
        type: CategoryType.DESPESA,
      };
      const createdEntity = { ...dto, userId } as Category;
      const savedEntity = { id: 'category-id', ...createdEntity };

      categoriesRepository.create.mockReturnValue(createdEntity);
      categoriesRepository.save.mockResolvedValue(savedEntity);

      const result = await service.create(userId, dto);

      expect(categoriesRepository.create.mock.calls[0]).toEqual([
        { ...dto, userId },
      ]);
      expect(categoriesRepository.save.mock.calls[0]).toEqual([createdEntity]);
      expect(result).toBe(savedEntity);
    });

    it('throws ConflictException when the repository reports a unique violation (error case, D-03)', async () => {
      const userId = 'user-id';
      const dto: CreateCategoryDto = {
        name: 'Transporte',
        type: CategoryType.DESPESA,
      };
      categoriesRepository.create.mockImplementation(
        (entityLike) => entityLike as Category,
      );
      categoriesRepository.save.mockRejectedValue({ code: '23505' });

      await expect(service.create(userId, dto)).rejects.toBeInstanceOf(
        ConflictException,
      );
    });
  });
});
