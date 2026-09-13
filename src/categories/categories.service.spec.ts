import { ConflictException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
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
            find: jest.fn(),
            findOne: jest.fn(),
            delete: jest.fn(),
            remove: jest.fn(),
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
      categoriesRepository.save.mockRejectedValue({
        code: '23505',
        constraint: 'UQ_categories_user_id_name_type',
      });

      await expect(service.create(userId, dto)).rejects.toBeInstanceOf(
        ConflictException,
      );
    });
  });

  describe('findOne', () => {
    it('throws NotFoundException (not a generic error) when the repository returns null (error case)', async () => {
      categoriesRepository.findOne.mockResolvedValue(null);

      await expect(
        service.findOne('user-id', 'missing-category-id'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('returns the category when the repository finds a userId-scoped match (happy path)', async () => {
      const category = { id: 'category-id', userId: 'user-id' } as Category;
      categoriesRepository.findOne.mockResolvedValue(category);

      const result = await service.findOne('user-id', 'category-id');

      expect(result).toBe(category);
      expect(categoriesRepository.findOne.mock.calls[0]).toEqual([
        {
          where: { id: 'category-id', userId: 'user-id', deletedAt: IsNull() },
        },
      ]);
    });
  });

  describe('remove', () => {
    it('sets deletedAt and calls .save() — never a hard-delete repository method (D-01)', async () => {
      const category = {
        id: 'category-id',
        userId: 'user-id',
        deletedAt: null,
      } as Category;
      categoriesRepository.findOne.mockResolvedValue(category);
      categoriesRepository.save.mockImplementation((entity) =>
        Promise.resolve(entity as Category),
      );

      await service.remove('user-id', 'category-id');

      expect(category.deletedAt).toBeInstanceOf(Date);
      expect(categoriesRepository.save.mock.calls[0]).toEqual([category]);
      expect(categoriesRepository.delete.mock.calls.length).toBe(0);
      expect(categoriesRepository.remove.mock.calls.length).toBe(0);
    });
  });
});
