# Error taxonomy

Two disjoint families, matching the two failure surfaces a partner can observe.

The type unions and per-case meaning in
[`packages/js/src/types.d.ts`](../packages/js/src/types.d.ts) are canonical —
that file ships in the npm package and is what partners see in their IDE. This
document is the response playbook layered on top; when they disagree, the
contract wins and this file has the bug.

## Auth errors → `onAuthError` (init-level)

| type                      | meaning                                                                                                   | partner's correct response                                                                             |
| ------------------------- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `partner_session_expired` | Their own user session died; their token route returned 401. Renewal cannot succeed.                      | Redirect to their login. Retrying is pointless.                                                        |
| `mint_failed`             | First token fetch failed (network, 5xx from their route, malformed response).                             | Retry / surface their own error state.                                                                 |
| `renewal_failed`          | A mid-session renewal failed for a non-401 reason. The app keeps working until the current token expires. | Usually nothing; escalates to `partner_session_expired` semantics if their route starts returning 401. |

## Load errors → `onLoadError` (component-level)

| type                    | meaning                                                                            |
| ----------------------- | ---------------------------------------------------------------------------------- |
| `api_connection_error`  | Could not reach doola.                                                             |
| `authentication_error`  | Session rejected by the API (expired mid-flight and backstop renewal also failed). |
| `invalid_request_error` | 4xx caused by integration configuration; not retryable.                            |
| `render_error`          | The component could not render — commonly browser extensions or CSP.               |
| `api_error`             | Everything else, including doola 5xx.                                              |

Handlers may be called more than once per incident and must be idempotent.
In most cases the component renders its own error UI; `onLoadError` exists for the
partner's analytics and for anything on _their_ page that depends on the frame.
