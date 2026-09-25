import type { Doola, DoolaOptions } from './types';

export type * from './types';

/**
 * The versioned loader entry point. The major in the path is immutable;
 * everything behind it rolls forward, which is how fixes reach every
 * partner with no npm bump and no partner deploy.
 */
const LOADER_URL = 'https://js.doola.com/v1/doola.js';

/**
 * The shim <-> loader handshake: the loader assigns this to
 * `window.Doola`. Declared once, here — the loader implements it via
 * this package's global augmentation rather than re-declaring it.
 */
export interface DoolaGlobal {
  init(options: DoolaOptions): Doola;
}

declare global {
  interface Window {
    Doola?: DoolaGlobal;
  }
}

const POLICY_NAME = 'doola-js';

// In the global symbol registry rather than module state because a page can
// bundle two copies of this shim, and createPolicy throws for a name that
// already exists. Every copy ever published reads this key, so a loader URL
// other than LOADER_URL needs a new key and a new policy name.
const POLICY: unique symbol = Symbol.for('@doola/js trusted types policy');

// lib.dom does not declare Trusted Types. `createScriptURL` returns a
// TrustedScriptURL, which `src` accepts but lib.dom types as a string only.
interface ScriptURLPolicy {
  createScriptURL(url: string): string;
}

interface TrustedTypesWindow {
  trustedTypes?: { createPolicy(name: string, rules: ScriptURLPolicy): ScriptURLPolicy };
  [POLICY]?: ScriptURLPolicy;
}

function loaderSrc(): string {
  const w = window as TrustedTypesWindow;

  if (!w.trustedTypes) return LOADER_URL;

  try {
    w[POLICY] ??= w.trustedTypes.createPolicy(POLICY_NAME, {
      createScriptURL: (url) => {
        if (url !== LOADER_URL) throw new TypeError(`${POLICY_NAME} only allows ${LOADER_URL}.`);
        return url;
      },
    });
    return w[POLICY].createScriptURL(LOADER_URL);
  } catch {
    // A page can restrict policy names without enforcing Trusted Types, and
    // the plain string still loads there. Where they are enforced, assigning
    // it throws, and the caller reports that.
    return LOADER_URL;
  }
}

let loaderPromise: Promise<DoolaGlobal> | null = null;

function injectLoader(): Promise<DoolaGlobal> {
  if (typeof window === 'undefined') {
    return Promise.reject(
      new Error(
        '@doola/js must run in a browser. In SSR frameworks, call loadDoola() in a client-only path.',
      ),
    );
  }

  if (window.Doola) return Promise.resolve(window.Doola);
  if (loaderPromise) return loaderPromise;

  // Never adopt a tag we did not inject: a finished or failed foreign tag
  // fires no listeners. Re-evaluating the loader is safe (CONTRIBUTING.md,
  // "the loader outlives every published contract version").
  const script = document.createElement('script');

  // Outside the promise: rejecting from its executor would call fail() before
  // the assignment below, leaving the rejection cached for every retry.
  try {
    script.src = loaderSrc();
  } catch {
    return Promise.reject(
      new Error(
        `Trusted Types blocked ${LOADER_URL}. Check your CSP allows trusted-types ${POLICY_NAME}.`,
      ),
    );
  }

  loaderPromise = new Promise((resolve, reject) => {
    // Failed tags do not stay in <head>.
    const fail = (error: Error) => {
      script.remove();
      loaderPromise = null;
      reject(error);
    };

    script.addEventListener('load', () => {
      if (window.Doola) resolve(window.Doola);
      else fail(new Error('The doola loader loaded but did not initialize.'));
    });
    script.addEventListener('error', () => {
      fail(
        new Error(`Failed to load ${LOADER_URL}. Check your CSP allows script-src js.doola.com.`),
      );
    });

    script.async = true;
    // Without this an uncaught error inside the loader reaches the partner's
    // own window.onerror as the opaque "Script error." with no file, line or
    // stack, on their site, where we cannot reproduce it. js.doola.com serves
    // `Access-Control-Allow-Origin: *` (cloudfront-partner-sdk-headers.tf), so
    // the fetch is unaffected — but it now depends on that header, and
    // narrowing it to an allowlist would stop the loader loading at all.
    script.crossOrigin = 'anonymous';
    document.head.appendChild(script);
  });

  return loaderPromise;
}

/**
 * Injects the loader from js.doola.com (if not already present) and
 * initializes it. Resolves once the loader is ready to create
 * components. One live instance per page: a repeat call with the same
 * publishableKey resolves to the live instance and its other options
 * are ignored, so a React StrictMode double-invoke gets the instance
 * back, not an error. A different key rejects until destroy(). Once
 * the loader is present the script is never re-injected.
 */
export async function loadDoola(options: DoolaOptions): Promise<Doola> {
  const loader = await injectLoader();

  return loader.init(options);
}
