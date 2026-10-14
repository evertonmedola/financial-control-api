import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateAccountDto } from '../../accounts/dto/create-account.dto';
import { CreateBudgetDto } from '../../budgets/dto/create-budget.dto';
import { UpdateBudgetDto } from '../../budgets/dto/update-budget.dto';
import { CreateTransactionDto } from '../../transactions/dto/create-transaction.dto';
import { CreateTransferDto } from '../../transfers/dto/create-transfer.dto';
import { isWithinDecimalRange, NUMERIC_12_2_MAX_ABS } from '../decimal.util';
import {
  MONEY_MAX_INTEGER_DIGITS,
  POSITIVE_MONEY_REGEX,
  SIGNED_MONEY_REGEX,
} from './is-money-string.decorator';

// Metadata key @nestjs/swagger's @ApiProperty stores per-property options
// under (DECORATORS.API_MODEL_PROPERTIES); the package does not export its
// constants module, so the literal is repeated here.
const SWAGGER_API_MODEL_PROPERTIES = 'swagger/apiModelProperties';

type DtoClass = new () => object;

// Runs class-validator against the REAL DTO and reports whether the given
// money property produced a validation error. Other required fields are
// filled with valid values so only the money field decides the outcome.
async function hasErrorOn(
  cls: DtoClass,
  payload: Record<string, unknown>,
  property: string,
): Promise<boolean> {
  const dto = plainToInstance(cls, payload);
  const errors = await validate(dto);
  return errors.some((error) => error.property === property);
}

const validAccount = { name: 'Conta', type: 'corrente' };
const validTransaction = {
  type: 'expense',
  accountId: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
  categoryId: 'c9bf9e57-1685-4c89-bafb-ff5af830be8a',
  description: 'Feira',
  date: '2026-09-13',
};
const validTransfer = {
  fromAccountId: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
  toAccountId: '0e8f5c2a-6b1d-4f3e-9a7c-5d2b8e1f4a36',
  description: 'Move',
  date: '2026-09-13',
};
const validBudget = { categoryId: 'c9bf9e57-1685-4c89-bafb-ff5af830be8a' };

const positiveAccepted = ['9999999999.99', '0.01', '1234.56', '1', '12.5'];
const positiveRejected: unknown[] = [
  '0',
  '0.00',
  '-1.00',
  '+1.00',
  '10000000000.00',
  '12345678901',
  '1.234',
  '',
  'abc',
  null,
  5,
];

const signedAccepted = [
  '9999999999.99',
  '-9999999999.99',
  '0',
  '0.00',
  '-0.50',
  '1500.00',
];
const signedRejected: unknown[] = [
  '10000000000.00',
  '-10000000000.00',
  '12345678901',
  '99999999999.99',
  '1.234',
  '',
  'abc',
  '+5',
  '.5',
  null,
  5,
];

describe('IsMoneyString', () => {
  it('caps the integer part at 10 digits (numeric(12,2))', () => {
    expect(MONEY_MAX_INTEGER_DIGITS).toBe(10);
  });

  describe('signed kind — CreateAccountDto.balance', () => {
    it.each(signedAccepted)('accepts %j', async (balance) => {
      expect(
        await hasErrorOn(
          CreateAccountDto,
          { ...validAccount, balance },
          'balance',
        ),
      ).toBe(false);
    });

    it.each(signedRejected)('rejects %j', async (balance) => {
      expect(
        await hasErrorOn(
          CreateAccountDto,
          { ...validAccount, balance },
          'balance',
        ),
      ).toBe(true);
    });

    it('rejects a missing balance', async () => {
      expect(await hasErrorOn(CreateAccountDto, validAccount, 'balance')).toBe(
        true,
      );
    });
  });

  describe.each([
    [
      'CreateTransactionDto.amount',
      CreateTransactionDto,
      validTransaction,
      'amount',
    ],
    ['CreateTransferDto.amount', CreateTransferDto, validTransfer, 'amount'],
    ['CreateBudgetDto.limit', CreateBudgetDto, validBudget, 'limit'],
  ] as Array<[string, DtoClass, Record<string, unknown>, string]>)(
    'positive kind — %s',
    (_label, cls, base, property) => {
      it.each(positiveAccepted)('accepts %j', async (value) => {
        expect(
          await hasErrorOn(cls, { ...base, [property]: value }, property),
        ).toBe(false);
      });

      it.each(positiveRejected)('rejects %j', async (value) => {
        expect(
          await hasErrorOn(cls, { ...base, [property]: value }, property),
        ).toBe(true);
      });
    },
  );

  describe('positive kind — UpdateBudgetDto.limit', () => {
    it.each(positiveAccepted)('accepts %j', async (limit) => {
      expect(await hasErrorOn(UpdateBudgetDto, { limit }, 'limit')).toBe(false);
    });

    it.each(positiveRejected)('rejects %j', async (limit) => {
      expect(await hasErrorOn(UpdateBudgetDto, { limit }, 'limit')).toBe(true);
    });

    it('passes when limit is omitted (PATCH with an empty body)', async () => {
      expect(await hasErrorOn(UpdateBudgetDto, {}, 'limit')).toBe(false);
    });

    it('fails when limit is explicitly null (CR-02 behavior preserved)', async () => {
      expect(await hasErrorOn(UpdateBudgetDto, { limit: null }, 'limit')).toBe(
        true,
      );
    });
  });

  describe('exported regexes and the OpenAPI pattern', () => {
    const oldPositivePattern = '^(?!0+(\\.0{1,2})?$)\\d{1,10}(\\.\\d{1,2})?$';

    it('POSITIVE_MONEY_REGEX.source equals the pattern the four positive DTO fields advertised before', () => {
      expect(POSITIVE_MONEY_REGEX.source).toBe(oldPositivePattern);
    });

    it('SIGNED_MONEY_REGEX.source is the positive shape without the all-zero lookahead and with an optional leading minus', () => {
      expect(SIGNED_MONEY_REGEX.source).toBe('^-?\\d{1,10}(\\.\\d{1,2})?$');
    });

    it.each([
      ['amount', CreateTransactionDto, POSITIVE_MONEY_REGEX],
      ['amount', CreateTransferDto, POSITIVE_MONEY_REGEX],
      ['limit', CreateBudgetDto, POSITIVE_MONEY_REGEX],
      ['limit', UpdateBudgetDto, POSITIVE_MONEY_REGEX],
      ['balance', CreateAccountDto, SIGNED_MONEY_REGEX],
    ] as Array<[string, DtoClass, RegExp]>)(
      'the Swagger pattern of %s on %p comes from the exported regex source',
      (property, cls, regex) => {
        const metadata = Reflect.getMetadata(
          SWAGGER_API_MODEL_PROPERTIES,
          cls.prototype,
          property,
        ) as { pattern?: string } | undefined;
        expect(metadata?.pattern).toBe(regex.source);
      },
    );
  });

  describe('agreement with the numeric(12,2) range check used by adjustBalance', () => {
    it.each(['9999999999.99', '-9999999999.99'])(
      'validator accepts and isWithinDecimalRange allows %s',
      (value) => {
        expect(SIGNED_MONEY_REGEX.test(value)).toBe(true);
        expect(isWithinDecimalRange(value, NUMERIC_12_2_MAX_ABS)).toBe(true);
      },
    );

    it.each(['10000000000.00', '-10000000000.00'])(
      'validator rejects and isWithinDecimalRange refuses %s',
      (value) => {
        expect(SIGNED_MONEY_REGEX.test(value)).toBe(false);
        expect(isWithinDecimalRange(value, NUMERIC_12_2_MAX_ABS)).toBe(false);
      },
    );
  });
});
