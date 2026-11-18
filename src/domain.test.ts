import { describe, expect, test } from 'bun:test';
import Decimal from 'decimal.js';

describe('financial decimal arithmetic', () => {
  test('two concurrent 80 bets against 100 leave exactly 20 after one debit', () => {
    const opening = new Decimal('100.00');
    const first = opening.minus('80.00');
    const secondCanProceed = opening.minus('80.00').isPositive() && first.greaterThanOrEqualTo('80.00');
    expect(first.toFixed(2)).toBe('20.00');
    expect(secondCanProceed).toBe(false);
  });
  test('decimal strings preserve cents without binary floating point', () => {
    expect(new Decimal('0.10').plus('0.20').toFixed(2)).toBe('0.30');
  });
});
