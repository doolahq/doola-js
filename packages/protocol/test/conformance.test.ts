import type { CustomerSession as ContractSession, DoolaAuthError, DoolaLoadError } from '@doola/js';
import { describe, expect, it } from 'vitest';

import type {
  AuthErrorPayload,
  AuthErrorType,
  CustomerSession,
  LoadErrorPayload,
  LoadErrorType,
} from '../src/messages';

/**
 * This package declares the wire vocabulary itself so it can be published with
 * no runtime dependency. That freedom is only safe while the two declarations
 * agree, and these assertions are what make disagreement a build failure rather
 * than a bug that surfaces in a partner's browser.
 *
 * They are compile-time: if a type stops matching, `tsc` fails and this file
 * never runs.
 */
type Exact<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

const authErrorMatches: Exact<AuthErrorType, DoolaAuthError['type']> = true;
const loadErrorMatches: Exact<LoadErrorType, DoolaLoadError['type']> = true;
const sessionMatches: Exact<CustomerSession, ContractSession> = true;

// The tag alone is not the contract. These payloads reach partner code
// unchanged, so renaming `message` on either error has to fail here too.
const authPayloadMatches: Exact<AuthErrorPayload, DoolaAuthError> = true;
const loadPayloadMatches: Exact<LoadErrorPayload, DoolaLoadError> = true;

/**
 * `PresentationMode` deliberately has no counterpart. The contract's
 * `Presentation.mode` is the partner's request — `fullScreen` or `auto` — while
 * the wire carries the mode the loader resolved that request to, which is
 * `inline` or `fullScreen`. Two vocabularies that share a word, not one type in
 * two places.
 */

describe('wire vocabulary', () => {
  it('agrees with the public contract', () => {
    expect(
      authErrorMatches &&
        loadErrorMatches &&
        sessionMatches &&
        authPayloadMatches &&
        loadPayloadMatches,
    ).toBe(true);
  });
});
