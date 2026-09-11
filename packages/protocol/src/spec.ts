import {
  type AppMessage,
  type AuthErrorType,
  type CustomerSession,
  type LoadErrorType,
  type LoaderMessage,
} from './messages';

export type Payload = Record<string, unknown>;

/**
 * One field of one message: how to recognise it, and how to copy it out.
 *
 * Both halves live together because keeping them apart is how a wire format
 * rots. A field added to a validator but not a projection is silently dropped
 * on send; a field added to a projection but not a validator is silently
 * accepted on receive. Neither mistake is visible in review, and neither is a
 * compile error when the two are separate tables.
 */
export interface Field {
  accepts: (value: unknown) => boolean;
  /**
   * For an object-valued field: the spec its own fields follow. Present so a
   * nested object is projected by the same rule as a payload, rather than
   * forwarded whole.
   */
  fields?: Record<string, Field>;
}

/**
 * Every key of a message's payload must appear, so adding a field to the union
 * without describing it here is a compile error rather than a silent drop.
 */
type FieldsOf<P> = { [K in keyof P]-?: Field };

type SpecOf<M extends { type: string; payload: object }> = {
  [K in M['type']]: FieldsOf<Extract<M, { type: K }>['payload']>;
};

const isString = (x: unknown): boolean => typeof x === 'string';
const isBoolean = (x: unknown): boolean => typeof x === 'boolean';
const isFiniteNumber = (x: unknown): boolean => Number.isFinite(x);
const isPositiveInt = (x: unknown): boolean => Number.isInteger(x) && (x as number) > 0;
const isNonEmptyString = (x: unknown): boolean => isString(x) && (x as string).length > 0;
const isNonNegative = (x: unknown): boolean => isFiniteNumber(x) && (x as number) >= 0;

/** Absent, or the value passes. Optional means optional, not nullable. */
const optional =
  (accepts: (value: unknown) => boolean) =>
  (x: unknown): boolean =>
    x === undefined || accepts(x);

const oneOf = (values: readonly string[]) => {
  const allowed: ReadonlySet<string> = new Set(values);

  return (x: unknown): boolean => typeof x === 'string' && allowed.has(x);
};

/**
 * Exhaustive lists of the tagged-error vocabularies. `Record<union, true>` is
 * the only construct where omitting a member is a compile error; the values are
 * filler, the keys are the list.
 */
const AUTH_ERROR: Record<AuthErrorType, true> = {
  partner_session_expired: true,
  email_in_use: true,
  mint_failed: true,
  renewal_failed: true,
};

const LOAD_ERROR: Record<LoadErrorType, true> = {
  api_connection_error: true,
  authentication_error: true,
  invalid_request_error: true,
  render_error: true,
  api_error: true,
};

export const AUTH_ERROR_TYPES = Object.keys(AUTH_ERROR) as readonly AuthErrorType[];
export const LOAD_ERROR_TYPES = Object.keys(LOAD_ERROR) as readonly LoadErrorType[];

const isAuthErrorType = oneOf(AUTH_ERROR_TYPES);
const isLoadErrorType = oneOf(LOAD_ERROR_TYPES);

const isAppearance = (x: unknown): boolean =>
  typeof x === 'object' && x !== null && !Array.isArray(x) && Object.values(x).every(isString);

/**
 * Structure only — a token and a lifetime that is a number. Whether a session
 * is worth acting on is the loader's call: it owns renewal scheduling and can
 * tell the user, where dropping the message here would leave the frame waiting
 * for a token that already arrived.
 *
 * The session also reaches the frame as whatever the partner's route returned,
 * so it is projected like any payload: these three fields and nothing else.
 */
const SESSION_FIELDS: FieldsOf<CustomerSession> = {
  accessToken: { accepts: isNonEmptyString },
  expiresIn: { accepts: isFiniteNumber },
  expiresAt: { accepts: optional(isString) },
};

/** Every named field accepts what is there — the same rule `parse` applies to a payload. */
export const acceptsAll =
  (fields: Record<string, Field>) =>
  (value: unknown): boolean => {
    if (typeof value !== 'object' || value === null) return false;

    const values = value as Payload;
    return Object.keys(fields).every((name) => fields[name]?.accepts(values[name]));
  };

const session: Field = { accepts: acceptsAll(SESSION_FIELDS), fields: SESSION_FIELDS };

export const APP_SPEC: SpecOf<AppMessage> = {
  ready: { protocolMax: { accepts: isPositiveInt } },
  resize: { height: { accepts: isNonNegative } },
  'scroll-request': { top: { accepts: isFiniteNumber } },
  'token-request': {},
  formed: { companyId: { accepts: isNonEmptyString } },
  'auth-error': {
    type: { accepts: isAuthErrorType },
    message: { accepts: isString },
  },
  'load-error': {
    type: { accepts: isLoadErrorType },
    message: { accepts: isString },
  },
  'loader-start': {},
};

export const LOADER_SPEC: SpecOf<LoaderMessage> = {
  init: {
    session,
    protocol: { accepts: isPositiveInt },
    locale: { accepts: optional(isString) },
    appearance: { accepts: optional(isAppearance) },
  },
  token: { session },
  update: {
    locale: { accepts: optional(isString) },
    appearance: { accepts: optional(isAppearance) },
  },
  'token-error': {
    reason: { accepts: isAuthErrorType },
    message: { accepts: isString },
    retryable: { accepts: isBoolean },
  },
  presentation: { mode: { accepts: oneOf(['inline', 'fullScreen']) } },
};

export type Spec = Record<string, Record<string, Field>>;
