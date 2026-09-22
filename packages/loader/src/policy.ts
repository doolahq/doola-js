/**
 * Numbers the loader decides on its own, kept apart from the code that uses
 * them so anything without a DOM — the browser suite, tooling — can read them
 * rather than restate them. They are policy, not options: each one prevents a
 * failure that is a property of the network or the device, and none of them is
 * a partner's to tune.
 */

/**
 * The height an inline frame reserves before the app reports a real one.
 *
 * The app cannot measure until it is running and connected, so anything the
 * frame shows before that — the bundle still downloading, "connecting", the
 * auth screen a failed first mint produces, the error boundary after a crash
 * that took the app's ResizeObserver down with it — would paint into a
 * zero-height box and the founder would see nothing at all. The loader owns
 * the box, so the loader owns its default.
 */
export const PLACEHOLDER_FRAME_HEIGHT_PX = 160;

/**
 * How long a frame may stay silent after its document has loaded.
 *
 * The app announces `ready` from an inline script in the document head, posted
 * while the document parses and before any bundle is fetched. So once `load`
 * has fired, `ready` has either already been posted or never will be: what is
 * left is the message crossing the bus, not a download. Seconds, not tens of
 * seconds.
 *
 * This is why the frame element's `load` event is the arming signal and not the
 * failure signal. Chromium fires `load` for a 404, for a CSP-refused frame and
 * for a connection-refused request exactly as it does for a healthy document —
 * and fires `error` for none of them, which is measured, not assumed
 * (PENG-6726). `load` says the navigation finished; only the absence of `ready`
 * says what it finished as.
 */
export const READY_AFTER_LOAD_MS = 5_000;

/**
 * The backstop for a document that never finishes loading at all — a stalled
 * connection, where `load` never fires and the grace above is never armed.
 * Long enough not to pre-empt a slow network, short enough that a dead embed
 * is not silent for a minute.
 */
export const LOAD_BACKSTOP_MS = 20_000;
