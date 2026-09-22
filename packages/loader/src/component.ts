import type { DoolaOptions } from '@doola/js';

import { LOAD_BACKSTOP_MS, PLACEHOLDER_FRAME_HEIGHT_PX, READY_AFTER_LOAD_MS } from './policy';
import { envelope, negotiate, parseAppMessage, type LoaderMessage } from './protocol';
import type { SessionManager } from './session';

const INLINE_FRAME_CSS = `width:100%;border:0;display:block;height:${PLACEHOLDER_FRAME_HEIGHT_PX}px;`;
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
 * The page's scroll lock is one global shared by every full-screen frame:
 * saved when the first enters, restored when the last leaves. A per-frame
 * snapshot would let one frame's exit unlock the page behind another's
 * still-live overlay. Module scope rather than FrameConfig because the
 * thing guarded, document.documentElement, outlives any instance.
 */
let fullScreenFrames = 0;
let overflowBeforeFullScreen = '';

function lockPageScroll(): void {
  if (fullScreenFrames++ === 0) {
    overflowBeforeFullScreen = document.documentElement.style.overflow;
    document.documentElement.style.overflow = 'hidden';
  }
}

function unlockPageScroll(): void {
  if (--fullScreenFrames === 0) document.documentElement.style.overflow = overflowBeforeFullScreen;
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
  private readyDeadline: ReturnType<typeof setTimeout> | null = null;
  private readonly onMediaChange = () => this.applyPresentation();
  private readonly onFrameLoad = () => this.armReadyDeadline(READY_AFTER_LOAD_MS);

  /**
   * The version settled by `ready`, which is also the first proof the frame has
   * navigated to the SDK origin — null until then.
   */
  private protocol: number | null = null;

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
    iframe.addEventListener('load', this.onFrameLoad);
    this.host.appendChild(iframe);
    if (iframe.contentWindow) register(iframe.contentWindow, this);

    this.readyDeadline = setTimeout(() => this.reportNeverLoaded(), LOAD_BACKSTOP_MS);

    this.config.fullScreenQuery?.addEventListener('change', this.onMediaChange);
    this.applyPresentation();
    this.config.onConnect(this);
  }

  disconnect(): void {
    deregister(this.iframe?.contentWindow ?? null);
    this.config.fullScreenQuery?.removeEventListener('change', this.onMediaChange);
    this.restoreStyles?.();
    this.clearReadyDeadline();

    this.iframe?.removeEventListener('load', this.onFrameLoad);
    this.iframe?.remove();
    this.iframe = null;

    // Per-frame state: a remount navigates and handshakes from scratch.
    this.protocol = null;

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

  /**
   * Shortens the outstanding deadline, and only that: a null handle means the
   * frame has already handshaked, already been reported, or been unmounted, and
   * `load` fires after `ready` on the healthy path — so without the guard a
   * successful frame would re-arm its own failure timer.
   */
  private armReadyDeadline(ms: number): void {
    if (this.readyDeadline === null) return;

    clearTimeout(this.readyDeadline);
    this.readyDeadline = setTimeout(() => this.reportNeverLoaded(), ms);
  }

  private clearReadyDeadline(): void {
    if (this.readyDeadline === null) return;

    clearTimeout(this.readyDeadline);
    this.readyDeadline = null;
  }

  /**
   * The one failure in the flow neither side could report. `onLoadError` needs
   * a `load-error` message, which needs the app to be running — precisely what
   * has not happened when the document 404s, the partner's CSP `frame-src`
   * refuses it, an extension stops it, or the app dies before it can post.
   * Everything the app can see still reaches the partner the app's way.
   *
   * Reported once per mount, which the deadline handle already encodes: it is
   * non-null only between mount and whichever comes first of `ready`, this, and
   * unmount. A late `ready` is not a retraction — the partner has already
   * reacted, and a callback that un-fires is worse than one that was early —
   * but it is not refused either: the handshake runs as usual, so a frame that
   * recovers still works.
   *
   * The placeholder is left standing. Collapsing it here would move the
   * partner's layout at a moment they did not choose; they own that box and
   * have just been handed the reason to collapse it themselves.
   */
  private reportNeverLoaded(): void {
    if (this.readyDeadline === null) return;

    this.clearReadyDeadline();
    this.config.handlers.onLoadError?.({
      type: 'render_error',
      message: 'The doola frame loaded but never started.',
    });
  }

  post(message: LoaderMessage): void {
    // Nothing can receive before `ready`: the frame is still on about:blank,
    // whose origin is not the SDK origin, so the browser drops the post and
    // logs a cross-origin error in the partner's console. This is also why
    // `init` carries the presentation mode — see docs/protocol.md.
    if (this.protocol === null) return;

    // Target origin is always the SDK origin, never '*' — see docs/protocol.md.
    this.iframe?.contentWindow?.postMessage(
      envelope(message, this.protocol),
      this.config.sdkOrigin,
    );
  }

  private get presentationMode(): 'inline' | 'fullScreen' {
    return this.restoreStyles ? 'fullScreen' : 'inline';
  }

  handleMessage(event: MessageEvent): void {
    // Both checks, always: right origin AND right window. The source map
    // already matched the window; the origin check stops a hijacked or
    // navigated frame from speaking as a doola one.
    if (event.origin !== this.config.sdkOrigin) return;

    const message = parseAppMessage(event.data);
    if (!message) return;

    switch (message.type) {
      case 'ready': {
        // Set before the first post: `post` refuses to send until it is, and
        // every outbound `v` from here on is the version it settles.
        const protocol = negotiate(message.payload.protocolMax);
        this.protocol = protocol;
        this.clearReadyDeadline();

        // Rejection swallowed: the partner hears via onAuthError and this
        // frame via token-error (both from the manager's failure callback).
        void this.config.sessions
          .current()
          .then((session) =>
            this.post({
              type: 'init',
              payload: {
                session,
                protocol,
                presentation: this.presentationMode,
                locale: this.config.state.locale,
              },
            }),
          )
          .catch(() => {});
        break;
      }
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
      // Both mean "start checkout for this company", which is why they share a
      // destination and why onFormed can fire twice for one — DoolaOptions.onFormed.
      case 'formed':
      case 'checkout-request':
        // The projection IS the "carries ONLY the company id" rule from
        // DoolaOptions.onFormed in the contract — because anything handed to
        // partner JS can be tampered with before their checkout reads it. A
        // future app field must not leak by accident.
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

      // Captured, not reconstructed: cssText is assigned wholesale, so
      // rebuilding it from INLINE_FRAME_CSS would drop the height the app had
      // negotiated and leave the frame at 0px. Restoring the height measured
      // while inline is also the correct one — the app keeps reporting heights
      // while full screen, and those are measured against a different viewport.
      //
      // A frame that mounts already under the breakpoint captures the
      // placeholder, because it goes full screen before the app has negotiated
      // anything and `resize` is ignored from then on. Its first return to
      // inline therefore shows the placeholder until the next `resize`, which
      // follows within a frame or two since the app's observer watches
      // documentElement and the viewport just changed. That is correct, not a
      // gap: the loader never knew an inline height, and the last full-screen
      // one would be measured against the wrong viewport. Do not "fix" it by
      // restoring that.
      const inlineStyles = iframe.style.cssText;

      iframe.style.cssText = FULLSCREEN_FRAME_CSS;
      lockPageScroll();

      this.restoreStyles = () => {
        iframe.style.cssText = inlineStyles;
        unlockPageScroll();
        this.restoreStyles = null;
      };
      this.post({ type: 'presentation', payload: { mode: this.presentationMode } });
    } else if (!wantFullScreen && this.restoreStyles) {
      this.restoreStyles();
      this.post({ type: 'presentation', payload: { mode: this.presentationMode } });
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
