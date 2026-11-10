import { describe, expect, it } from 'vitest';

import { presentationModeFrom, productFrom, serializedOrigin } from '../src/options';

describe('serializedOrigin', () => {
  it('normalises a trailing slash, which the inbound origin check can never match', () => {
    // event.origin is always the serialized form, so the slashed spelling
    // silently dropped every message the app sent.
    expect(serializedOrigin('https://formation.partner.test/')).toBe(
      'https://formation.partner.test',
    );
    expect(serializedOrigin('https://formation.partner.test')).toBe(
      'https://formation.partner.test',
    );
  });

  it('drops a path, query and hash', () => {
    expect(serializedOrigin('https://partner.test/embed?a=1#x')).toBe('https://partner.test');
  });

  it('keeps a non-default port, which is part of the origin', () => {
    expect(serializedOrigin('http://localhost:5173/')).toBe('http://localhost:5173');
  });

  it('throws on a value that is not an absolute URL', () => {
    expect(() => serializedOrigin('partner.test')).toThrow(/absolute URL/);
    expect(() => serializedOrigin('')).toThrow(/absolute URL/);
  });

  it('throws on an opaque origin rather than returning the string "null"', () => {
    expect(() => serializedOrigin('file:///tmp/app.html')).toThrow(/http\(s\) origin/);
  });
});

describe('presentationModeFrom', () => {
  it('defaults to auto', () => {
    expect(presentationModeFrom(undefined)).toBe('auto');
    expect(presentationModeFrom({})).toBe('auto');
  });

  it('accepts the two documented modes', () => {
    expect(presentationModeFrom({ mode: 'auto' })).toBe('auto');
    expect(presentationModeFrom({ mode: 'fullScreen' })).toBe('fullScreen');
  });

  it('throws on a near-miss instead of pinning a permanent overlay', () => {
    // Anything but the exact string 'auto' skips the media query, and the
    // frame then reads "full screen" on every viewport.
    expect(() => presentationModeFrom({ mode: 'fullscreen' } as never)).toThrow(
      /presentation.mode/,
    );
    expect(() => presentationModeFrom({ mode: 'inline' } as never)).toThrow(/presentation.mode/);
  });
});

describe('productFrom', () => {
  it('defaults to formation', () => {
    expect(productFrom(undefined)).toBe('formation');
    expect(productFrom({})).toBe('formation');
    expect(productFrom({ product: undefined })).toBe('formation');
  });

  it('accepts the two products', () => {
    expect(productFrom({ product: 'formation' })).toBe('formation');
    expect(productFrom({ product: 'tax' })).toBe('tax');
  });

  it.each(['Tax', '', 'onboarding', 'FORMATION'])(
    'throws on %j, naming the accepted values',
    (product) => {
      expect(() => productFrom({ product } as never)).toThrow(
        /product must be 'formation' or 'tax', received/,
      );
    },
  );
});
