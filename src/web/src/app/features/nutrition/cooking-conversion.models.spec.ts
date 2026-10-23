import { HttpErrorResponse } from '@angular/common/http';
import { describe, expect, it } from 'vitest';
import { CHICKEN_GRILLED, conversionView, RICE_BOILED } from '../../../testing/cooking-fixtures';
import {
  conversionErrors,
  conversionFromView,
  conversionPreview,
  conversionRefusal,
  conversionRequest,
  conversionWords,
  emptyConversionForm,
  formTyped,
} from './cooking-conversion.models';

const filled = { name: ' White rice, boiled ', cooked: 290, kept: 100, source: ' Weighed ' };

describe('Raw to cooked, in coach words (INV-6)', () => {
  it('reads a conversion the API answers, its factors as numbers', () => {
    expect(
      conversionFromView(conversionView({ yieldFactor: '2.9', retentionFactor: '1' })),
    ).toEqual(RICE_BOILED);
  });

  it('says what 100 g raw makes, and what it keeps when it keeps less than all', () => {
    expect(conversionWords(RICE_BOILED, 'en-US')).toBe('100 g raw makes 290 g cooked');
    expect(conversionWords({ ...RICE_BOILED, yield: 2.905 }, 'en-US')).toBe(
      '100 g raw makes 290.5 g cooked',
    );
    expect(conversionWords(CHICKEN_GRILLED, 'en-US')).toBe(
      '100 g raw makes 75 g cooked, keeping 95% of its protein, carbs and fat',
    );
  });

  it('checks a new conversion as the server would, in words', () => {
    const empty = emptyConversionForm();
    expect(empty).toEqual({ name: '', cooked: null, kept: 100, source: '' });
    expect(formTyped(empty)).toBe(false);
    expect(conversionErrors(empty)).toEqual({
      name: ['Say what it is, like White rice, boiled.'],
      cooked: ['Enter what 100 g raw weighs cooked, above 0 and up to 500 g.'],
      kept: [],
      source: [
        'Say where these numbers come from, like USDA cooking yields or Weighed in my kitchen.',
      ],
    });
    expect(conversionErrors(filled)).toEqual({ name: [], cooked: [], kept: [], source: [] });
    // The server's bounds: up to 5 times the raw weight, and at most all of it kept.
    expect(conversionErrors({ ...filled, cooked: 500 }).cooked).toEqual([]);
    for (const cooked of [0, -1, 500.1]) {
      expect(conversionErrors({ ...filled, cooked }).cooked).toEqual([
        'Enter what 100 g raw weighs cooked, above 0 and up to 500 g.',
      ]);
    }
    expect(conversionErrors({ ...filled, cooked: 290.55 }).cooked).toEqual([
      'Use at most one decimal.',
    ]);
    for (const kept of [0, 100.5, null]) {
      expect(conversionErrors({ ...filled, kept }).kept).toEqual([
        'Enter how much is kept, above 0% and up to 100%.',
      ]);
    }
    expect(conversionErrors({ ...filled, kept: 99.95 }).kept).toEqual(['Use at most one decimal.']);
    expect(conversionErrors({ ...filled, name: 'x'.repeat(201) }).name).toEqual([
      'Keep it to 200 characters.',
    ]);
    expect(conversionErrors({ ...filled, source: 'x'.repeat(101) }).source).toEqual([
      'Keep it to 100 characters.',
    ]);
    expect(formTyped({ ...empty, kept: 95 })).toBe(true);
    expect(formTyped({ ...empty, name: 'Rice' })).toBe(true);
  });

  it('sends the factors the server keeps, to six decimals, never a float’s tail', () => {
    expect(conversionRequest(filled)).toEqual({
      sourceKey: 'White rice, boiled',
      sourceVersion: 'Weighed',
      yieldFactor: 2.9,
      retentionFactor: 1,
    });
    // 33.3 / 100 is 0.33299999999999996 in floating point; the server would refuse its seventeen decimals.
    expect(conversionRequest({ ...filled, cooked: 75, kept: 33.3 })).toMatchObject({
      yieldFactor: 0.75,
      retentionFactor: 0.333,
    });
    expect(JSON.stringify(conversionRequest({ ...filled, cooked: 290.5 }).yieldFactor)).toBe(
      '2.905',
    );
  });

  it('says what the numbers typed mean while they are typed', () => {
    expect(conversionPreview(filled, 'en-US')).toBe('So 100 g cooked counts as 34.5 g raw.');
    expect(conversionPreview({ ...filled, cooked: 75, kept: 95 }, 'en-US')).toBe(
      'So 100 g cooked counts as 133.3 g raw, keeping 95% of its protein, carbs and fat.',
    );
    expect(conversionPreview({ ...filled, cooked: null }, 'en-US')).toBe('');
    expect(conversionPreview({ ...filled, kept: 0 }, 'en-US')).toBe('');
  });

  it('puts the server’s refusal on the box it names, or in the summary in its own words', () => {
    const invalid = conversionRefusal(
      new HttpErrorResponse({
        status: 400,
        error: {
          errors: {
            sourceKey: ['Say what the conversion is for, in up to 200 characters.'],
            yieldFactor: ['The cooked weight must be above 0 and at most 5 times the raw weight.'],
          },
        },
      }),
    );
    expect(invalid).toEqual({
      fields: {
        name: ['Say what the conversion is for, in up to 200 characters.'],
        cooked: ['The cooked weight must be above 0 and at most 5 times the raw weight.'],
      },
      message: 'Check the fields marked above.',
    });
    const taken = conversionRefusal(
      new HttpErrorResponse({
        status: 409,
        error: {
          code: 'cooking_conversion_taken',
          message:
            'A conversion for “White rice, boiled” from “Weighed” already has other numbers. Give the new one another name or source.',
        },
      }),
    );
    expect(taken.fields).toEqual({});
    expect(taken.message).toBe(
      'A conversion for “White rice, boiled” from “Weighed” already has other numbers. Give the new one another name or source.',
    );
    expect(conversionRefusal(new HttpErrorResponse({ status: 500 })).message).toBe(
      'The conversion couldn’t be saved. Try again.',
    );
  });
});
