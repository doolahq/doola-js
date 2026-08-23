import type { Appearance, ComponentOptions, DoolaComponentType } from '@doola/js';

import type { Env } from './env';
import {
  envelope,
  parseAppMessage,
  PROTOCOL_VERSION,
  type AppMessage,
  type LoaderMessage,
} from './protocol';
import type { SessionManager } from './session';

const INLINE_FRAME_CSS = 'width:100%;border:0;display:block;height:0;';
const FULLSCREEN_FRAME_CSS =
  'position:fixed;inset:0;width:100%;height:100%;border:0;z-index:2147483647;';

/** Per-mount state shared by init() and every controller it creates. */
export interface InstanceState {
  appearance?: Appearance | undefined;
  locale?: string | undefined;
}

export interface FrameConfig {
  env: Env;
  publishableKey: string;
  componentType: DoolaComponentType;
  sessions: SessionManager;
  state: InstanceState;
  presentationMode: 'inline' | 'fullScreen' | 'auto';
  fullScreenBreakpoint: number;
  /** Instance-level auth handler; app-reported auth errors forward here (docs/protocol.md). */
  onAuthError: (error: {
    type: 'partner_session_expired' | 'mint_failed' | 'renewal_failed';
    message: string;
  }) => void;
  /** Per-component-type outcome messages (e.g. formation's `formed`). */
  onComponentMessage: (message: AppMessage) => void;
  onConnect: (controller: FrameController) => void;
  onDisconnect: (controller: FrameController) => void;
}

/**
 * One shared window listener for all mounted frames, dispatched by
 * event.source. Keeps message handling O(1) in the number of mounted
 * components and independent of other iframes' postMessage traffic.
 */
const controllersBySource = new Map<MessageEventSource, FrameController>();

function dispatch(event: MessageEvent): void {
  const source = event.source;
  if (!source) return;

  const controller = controllersBySource.get(source);
  if (!controller) return;

  controller.handleMessage(event);
}

function register(source: MessageEventSource, controller: FrameController): void {
  if (controllersBySource.size === 0) window.addEventListener('message', dispatch);
  controllersBySource.set(source, controller);
}

function deregister(source: MessageEventSource | null): void {
  if (source) controllersBySource.delete(source);
  if (controllersBySource.size === 0) window.removeEventListener('message', dispatch);
}

/**
 * One mounted component: the custom element, its iframe, and the message
 * wiring. Component-type-generic — the type appears only in the iframe
 * path and the outcome messages, both injected via FrameConfig, so a
 * second component type is additive here.
 */
export class FrameController {
  private iframe: HTMLIFrameElement | null = null;
  private fullScreenQuery: MediaQueryList | null = null;
  private restoreStyles: (() => void) | null = null;
  private readonly onMediaChange = () => this.applyPresentation();

  constructor(
    private readonly host: HTMLElement,
    private readonly config: FrameConfig,
    private readonly options: ComponentOptions,
  ) {}

  connect(): void {
    const iframe = document.createElement('iframe');

    iframe.src = `${this.config.env.sdkOrigin}/${this.config.componentType}?pk=${encodeURIComponent(this.config.publishableKey)}`;
    iframe.title = 'doola';
    iframe.allow = 'clipboard-write';
    iframe.style.cssText = INLINE_FRAME_CSS;

    this.iframe = iframe;
    this.host.appendChild(iframe);
    if (iframe.contentWindow) register(iframe.contentWindow, this);

    if (this.config.presentationMode === 'auto') {
      this.fullScreenQuery = window.matchMedia(
        `(max-width: ${this.config.fullScreenBreakpoint}px)`,
      );
      this.fullScreenQuery.addEventListener('change', this.onMediaChange);
    }
    this.applyPresentation();
    this.config.onConnect(this);
  }

  disconnect(): void {
    deregister(this.iframe?.contentWindow ?? null);
    this.fullScreenQuery?.removeEventListener('change', this.onMediaChange);
    this.restoreStyles?.();

    this.iframe?.remove();
    this.iframe = null;
    this.config.onDisconnect(this);
  }

  post(message: LoaderMessage): void {
    // Target origin is always the sdk origin, never '*' — see docs/protocol.md.
    this.iframe?.contentWindow?.postMessage(envelope(message), this.config.env.sdkOrigin);
  }

  handleMessage(event: MessageEvent): void {
    // Both checks, always: right origin AND right window. The source map
    // already matched the window; the origin check stops a hijacked or
    // navigated frame from speaking as a doola one.
    if (event.origin !== this.config.env.sdkOrigin) return;

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
              appearance: this.config.state.appearance,
              locale: this.config.state.locale,
            },
          }),
        );
        break;
      case 'resize':
        if (this.iframe && !this.restoreStyles)
          this.iframe.style.height = `${message.payload.height}px`;
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
      case 'auth-error':
        this.config.onAuthError(message.payload);
        break;
      case 'loader-start':
        this.options.onLoaderStart?.(message.payload);
        break;
      case 'load-error':
        this.options.onLoadError?.(message.payload);
        break;
      default:
        this.config.onComponentMessage(message);
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
      iframe.style.cssText = FULLSCREEN_FRAME_CSS;
      document.documentElement.style.overflow = 'hidden';

      this.restoreStyles = () => {
        iframe.style.cssText = INLINE_FRAME_CSS;
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

/** Generic host element; the per-type tag comes from the component registry. */
export class DoolaElement extends HTMLElement {
  controller: FrameController | null = null;

  connectedCallback(): void {
    this.style.display = 'block';
    this.controller?.connect();
  }

  disconnectedCallback(): void {
    this.controller?.disconnect();
  }
}

export const ELEMENT_TAGS: Record<DoolaComponentType, string> = {
  formation: 'doola-formation',
};

export function defineElementsOnce(): void {
  for (const tag of Object.values(ELEMENT_TAGS)) {
    if (!customElements.get(tag)) customElements.define(tag, DoolaElement);
  }
}
