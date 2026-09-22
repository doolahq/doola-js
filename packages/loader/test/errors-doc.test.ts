import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { LOAD_FAILURE_MESSAGES } from '../src/policy';

/**
 * `docs/errors.md` is contract surface (CONTRIBUTING), and these three
 * sentences are the only part of a loader-raised failure a partner ever reads —
 * the string that reaches a support ticket and the string they grep the docs
 * for. A copy edit here that left the document behind would be invisible: the
 * browser suite would go red on its own assertions and say nothing about the
 * docs.
 *
 * So the document must quote them verbatim. Same rule, and the same reason, as
 * `@doola/sdk-protocol`'s spec-matches-docs test.
 */
const doc = readFileSync(resolve(__dirname, '../../../docs/errors.md'), 'utf8');

describe('docs/errors.md', () => {
  it.each(Object.entries(LOAD_FAILURE_MESSAGES))(
    'quotes the %s message verbatim',
    (_cause, message) => {
      expect(doc).toContain(message);
    },
  );
});
