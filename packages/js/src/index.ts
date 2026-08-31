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

  loaderPromise ??= new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${LOADER_URL}"]`);
    const script = existing ?? document.createElement('script');

    // On failure, a tag this shim injected must go too: the next attempt's
    // querySelector would otherwise find the dead tag, skip injection, and
    // never settle. A partner-added tag is theirs — never removed here.
    const fail = (error: Error) => {
      if (!existing) script.remove();
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

    if (!existing) {
      script.src = LOADER_URL;
      script.async = true;
      document.head.appendChild(script);
    }
  });

  return loaderPromise;
}

/**
 * Injects the loader from js.doola.com (if not already present) and
 * initializes it. Resolves once the loader is ready to create
 * components. One live instance per page: reuse it across mounts, and
 * call again only after destroy() — while an instance is live this
 * rejects rather than minting a second session. The script itself is
 * never re-injected.
 */
export async function loadDoola(options: DoolaOptions): Promise<Doola> {
  const loader = await injectLoader();

  return loader.init(options);
}
