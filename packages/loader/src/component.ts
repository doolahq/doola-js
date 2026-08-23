import type { Appearance, FormationOptions } from '@doola/js';

import type { Env } from './env';
import { envelope, parseAppMessage, PROTOCOL_VERSION, type LoaderMessage } from './protocol';
import type { SessionManager } from './session';

const ELEMENT_TAG = 'doola-formation';

const DEFAULT_FULLSCREEN_BREAKPOINT = 640;

export interface FrameConfig {
  env: Env;
  publishableKey: string;
  sessions: SessionManager;
  appearance: () => Appearance | undefined;
  locale: () => string | undefined;
  presentationMode: 'inline' | 'fullScreen' | 'auto';
  fullScreenBreakpoint: number | undefined;
}

/**
 * One mounted component: the custom element, its iframe, and the message
 * wiring. Mounts on connect, tears down on disconnect — standard custom
 * element lifecycle, which is what lets React/Vue portals and plain DOM
 * all treat it as an ordinary block element.
 */
export class FrameController {
  private iframe: HTMLIFrameElement | null = null;
  private fullScreenQuery: MediaQueryList | null = null;
  private restoreStyles: (() => void) | null = null;
  private readonly onMessage = (event: MessageEvent) => this.handleMessage(event);
  private readonly onMediaChange = () => this.applyPresentation();

  constructor(
    private readonly host: HTMLElement,
    private readonly config: FrameConfig,
    private readonly options: FormationOptions,
  ) {}

  connect(): void {
    const iframe = document.createElement('iframe');

    iframe.src = `${this.config.env.sdkOrigin}/formation?pk=${encodeURIComponent(this.config.publishableKey)}`;
    iframe.title = 'doola';
    iframe.allow = 'clipboard-write';
    iframe.style.cssText = 'width:100%;border:0;display:block;height:0;';

    this.iframe = iframe;
    this.host.appendChild(iframe);
    window.addEventListener('message', this.onMessage);

    if (this.config.presentationMode === 'auto') {
      const breakpoint = this.config.fullScreenBreakpoint ?? DEFAULT_FULLSCREEN_BREAKPOINT;
      this.fullScreenQuery = window.matchMedia(`(max-width: ${breakpoint}px)`);
      this.fullScreenQuery.addEventListener('change', this.onMediaChange);
    }
    this.applyPresentation();
  }

  disconnect(): void {
    window.removeEventListener('message', this.onMessage);
    this.fullScreenQuery?.removeEventListener('change', this.onMediaChange);
    this.restoreStyles?.();

    this.iframe?.remove();
    this.iframe = null;
  }

  post(message: LoaderMessage): void {
    // Target origin is always the sdk origin, never '*' — see docs/protocol.md.
    this.iframe?.contentWindow?.postMessage(envelope(message), this.config.env.sdkOrigin);
  }

  private handleMessage(event: MessageEvent): void {
    // Both checks, always: right origin AND right window. Another doola
    // frame on the same page passes the origin check alone.
    if (event.origin !== this.config.env.sdkOrigin) return;
    if (!this.iframe || event.source !== this.iframe.contentWindow) return;

    const message = parseAppMessage(event.data);
    if (!message) return;

    switch (message.type) {
      case 'ready':
        void this.config.sessions.current().then((session) =>
          this.post({
            type: 'init',
            payload: {
              session,
              protocol: Math.min(PROTOCOL_VERSION, message.payload.protocolMax),
              appearance: this.config.appearance(),
              locale: this.config.locale(),
            },
          }),
        );
        break;
      case 'resize':
        if (this.iframe) this.iframe.style.height = `${message.payload.height}px`;
        break;
      case 'scroll-request': {
        const top = this.iframe
          ? this.iframe.getBoundingClientRect().top + window.scrollY + message.payload.top
          : 0;
        window.scrollTo({ top, behavior: 'smooth' });
        break;
      }
      case 'token-request':
        this.config.sessions.renewNow();
        break;
      case 'formed':
        this.options.onFormed({ companyId: message.payload.companyId });
        break;
      case 'loader-start':
        this.options.onLoaderStart?.(message.payload);
        break;
      case 'load-error':
        this.options.onLoadError?.(message.payload);
        break;
      case 'auth-error':
        // Surfaced through the instance-level handler by the app only for
        // states the loader can't observe itself; forwarded in doola.ts.
        break;
    }
  }

  private applyPresentation(): void {
    const wantFullScreen =
      this.config.presentationMode === 'fullScreen' ||
      (this.config.presentationMode === 'auto' && this.fullScreenQuery?.matches === true);

    if (wantFullScreen && !this.restoreStyles) {
      const iframe = this.iframe;
      if (!iframe) return;

      const previousOverflow = document.documentElement.style.overflow;
      iframe.style.cssText =
        'position:fixed;inset:0;width:100%;height:100%;border:0;z-index:2147483647;';
      document.documentElement.style.overflow = 'hidden';

      this.restoreStyles = () => {
        iframe.style.cssText = 'width:100%;border:0;display:block;height:0;';
        document.documentElement.style.overflow = previousOverflow;
        this.restoreStyles = null;
      };
      this.post({ type: 'presentation', payload: { mode: 'fullScreen' } });
    } else if (!wantFullScreen && this.restoreStyles) {
      this.restoreStyles();
      this.post({ type: 'presentation', payload: { mode: 'inline' } });
    }
  }
}

/** Registered once; instances receive their controller just before mount. */
export class DoolaFormationElement extends HTMLElement {
  controller: FrameController | null = null;

  connectedCallback(): void {
    this.style.display = 'block';
    this.controller?.connect();
  }

  disconnectedCallback(): void {
    this.controller?.disconnect();
  }
}

export function defineElementOnce(): void {
  if (!customElements.get(ELEMENT_TAG)) customElements.define(ELEMENT_TAG, DoolaFormationElement);
}
