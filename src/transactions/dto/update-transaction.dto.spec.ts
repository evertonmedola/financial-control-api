import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpdateTransactionDto } from './update-transaction.dto';

// CR-01 (05-REVIEW.md, iteration 3): mirrors the UpdateBudgetDto CR-02 unit
// test approach — exercises class-validator directly against the DTO
// (plainToInstance + validate) rather than TransactionsService, since the
// bug this guards against lives entirely in the validation layer: an
// explicit `null` must fail validation with a 400, never reach the
// service/repository at all.
describe('UpdateTransactionDto', () => {
  it('fails validation when date is explicitly null (regression, CR-01)', async () => {
    const dto = plainToInstance(UpdateTransactionDto, { date: null });

    const errors = await validate(dto);

    expect(errors).not.toHaveLength(0);
    expect(errors.some((error) => error.property === 'date')).toBe(true);
  });

  it('fails validation when description is explicitly null (regression, CR-01)', async () => {
    const dto = plainToInstance(UpdateTransactionDto, { description: null });

    const errors = await validate(dto);

    expect(errors).not.toHaveLength(0);
    expect(errors.some((error) => error.property === 'description')).toBe(true);
  });

  it('passes validation when both fields are omitted (undefined)', async () => {
    const dto = plainToInstance(UpdateTransactionDto, {});

    const errors = await validate(dto);

    expect(errors).toHaveLength(0);
  });

  it('passes validation with valid description and date values', async () => {
    const dto = plainToInstance(UpdateTransactionDto, {
      description: 'Feira',
      date: '2026-09-13',
    });

    const errors = await validate(dto);

    expect(errors).toHaveLength(0);
  });
});
