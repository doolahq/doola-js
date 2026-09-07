import type { DoolaOptions } from '@doola/js';

import { envelope, parseAppMessage, PROTOCOL_VERSION, type LoaderMessage } from './protocol';
import type { SessionManager } from './session';

const INLINE_FRAME_CSS = 'width:100%;border:0;display:block;height:0;';
const FULLSCREEN_FRAME_CSS =
  'position:fixed;inset:0;width:100%;height:100%;border:0;z-index:2147483647;';

/** The one custom-element tag; what create() returns and partners mount. */
export const ELEMENT_TAG = 'doola-embed';

/** Per-instance state shared by init() and every controller it creates. */
export type InstanceState = Pick<DoolaOptions, 'locale'>;

/** The partner's handlers, typed by the contract so a contract change is a type error here. */
export type InstanceHandlers = Pick<
  DoolaOptions,
  'onAuthError' | 'onFormed' | 'onLoaderStart' | 'onLoadError'
>;

export interface FrameConfig {
  /**
   * True once the instance is destroyed. destroy() can dispose only the
   * controllers that are mounted at that moment; this guard covers the
   * rest — created-but-never-mounted elements, and elements unmounted
   * before destroy() — so a kept element cannot resurrect the instance.
   */
  isDestroyed: () => boolean;
  /** Resolved for this instance: the key's environment, or the partner's CNAME origin. */
  sdkOrigin: string;
  publishableKey: string;
  sessions: SessionManager;
  state: InstanceState;
  handlers: InstanceHandlers;
  /**
   * The instance's one shared media query; controllers subscribe, never
   * create. Non-null only for mode `auto`, where full screen tracks the
   * query; null means mode `fullScreen` — always on.
   */
  fullScreenQuery: MediaQueryList | null;
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
 * wiring. The iframe loads the SDK origin's root — a single entry; the
 * app decides inside which screen to show (see the contract's create()).
 */
export class FrameController {
  private iframe: HTMLIFrameElement | null = null;
  private restoreStyles: (() => void) | null = null;
  private readonly onMediaChange = () => this.applyPresentation();

  constructor(
    private readonly host: DoolaElement,
    private readonly config: FrameConfig,
  ) {}

  connect(): void {
    if (this.config.isDestroyed()) {
      this.host.controller = null;
      return;
    }

    const iframe = document.createElement('iframe');

    iframe.src = `${this.config.sdkOrigin}/?pk=${encodeURIComponent(this.config.publishableKey)}`;
    iframe.title = 'doola';
    iframe.allow = 'clipboard-write';
    iframe.style.cssText = INLINE_FRAME_CSS;

    this.iframe = iframe;
    this.host.appendChild(iframe);
    if (iframe.contentWindow) register(iframe.contentWindow, this);

    this.config.fullScreenQuery?.addEventListener('change', this.onMediaChange);
    this.applyPresentation();
    this.config.onConnect(this);
  }

  disconnect(): void {
    deregister(this.iframe?.contentWindow ?? null);
    this.config.fullScreenQuery?.removeEventListener('change', this.onMediaChange);
    this.restoreStyles?.();

    this.iframe?.remove();
    this.iframe = null;
    this.config.onDisconnect(this);
  }

  /**
   * destroy()-only teardown: also severs the element's back-reference so
   * a partner still holding the element cannot keep the dead instance's
   * SessionManager and handlers reachable. Ordinary unmount/remount must
   * keep the controller, so this never runs from disconnectedCallback.
   */
  dispose(): void {
    this.disconnect();
    this.host.controller = null;
  }

  post(message: LoaderMessage): void {
    // Target origin is always the SDK origin, never '*' — see docs/protocol.md.
    this.iframe?.contentWindow?.postMessage(envelope(message), this.config.sdkOrigin);
  }

  handleMessage(event: MessageEvent): void {
    // Both checks, always: right origin AND right window. The source map
    // already matched the window; the origin check stops a hijacked or
    // navigated frame from speaking as a doola one.
    if (event.origin !== this.config.sdkOrigin) return;

    const message = parseAppMessage(event.data);
    if (!message) return;

    switch (message.type) {
      case 'ready':
        // Rejection swallowed: the partner hears via onAuthError and this
        // frame via token-error (both from the manager's failure callback).
        void this.config.sessions
          .current()
          .then((session) =>
            this.post({
              type: 'init',
              payload: {
                session,
                protocol: Math.min(PROTOCOL_VERSION, message.payload.protocolMax),
                locale: this.config.state.locale,
              },
            }),
          )
          .catch(() => {});
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
      case 'formed':
        // The projection IS the "carries ONLY the company id" rule from
        // DoolaOptions.onFormed in the contract — formed-specific, because
        // anything handed to partner JS can be tampered with before their
        // checkout reads it. A future app field must not leak by accident.
        this.config.handlers.onFormed({ companyId: message.payload.companyId });
        break;
      case 'auth-error':
        this.config.handlers.onAuthError(message.payload);
        break;
      case 'loader-start':
        this.config.handlers.onLoaderStart?.();
        break;
      case 'load-error':
        this.config.handlers.onLoadError?.(message.payload);
        break;
      // Unknown types from a newer app are ignored, never an error (docs/protocol.md).
    }
  }

  private applyPresentation(): void {
    const wantFullScreen = this.config.fullScreenQuery?.matches ?? true;

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

/** The host element behind ELEMENT_TAG; mounting is appending it to the DOM. */
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

export function defineElementOnce(): void {
  if (!customElements.get(ELEMENT_TAG)) customElements.define(ELEMENT_TAG, DoolaElement);
}
