import type { Doola, DoolaOptions } from './types';

export type * from './types';

/**
 * The versioned loader entry point. The major in the path is immutable;
 * everything behind it rolls forward, which is how fixes reach every
 * partner with no npm bump and no partner deploy.
 */
const LOADER_URL = 'https://js.doola.com/v1/doola.js';

interface DoolaGlobal {
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

    script.addEventListener('load', () => {
      if (window.Doola) resolve(window.Doola);
      else reject(new Error('The doola loader loaded but did not initialize.'));
    });
    script.addEventListener('error', () => {
      loaderPromise = null;
      reject(
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
 * components. Call once per page; reuse the instance.
 */
export async function loadDoola(options: DoolaOptions): Promise<Doola> {
  const loader = await injectLoader();

  return loader.init(options);
}
