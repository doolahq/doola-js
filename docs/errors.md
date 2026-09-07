# Error taxonomy

Two disjoint families, matching the two failure surfaces a partner can observe.
Both handlers are passed once, at `loadDoola`; the split is auth versus load,
not where they are registered.

The type unions and per-case meaning in
[`packages/js/src/types.d.ts`](../packages/js/src/types.d.ts) are canonical —
that file ships in the npm package and is what partners see in their IDE. This
document is the response playbook layered on top; when they disagree, the
contract wins and this file has the bug.

## Auth errors → `onAuthError`

| type                      | meaning                                                                                                                                                                                                                                                                          | partner's correct response                                                                             |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `partner_session_expired` | Their own user session died; their token route returned its own 401 (the route never forwards doola's — see `FetchAccessToken`). Renewal cannot succeed.                                                                                                                         | Redirect to their login. Retrying is pointless.                                                        |
| `email_in_use`            | The customer's email already belongs to a doola account outside the partner's tenant — the broker's 409 `E_EMAIL_IN_USE`. First mint only; cannot occur on renewal.                                                                                                              | Terminal — retrying never succeeds. Surface a support path or ask for a different email.               |
| `mint_failed`             | First token fetch failed for a transient or unknown reason: network, malformed response, or a 5xx from their route — including the 502 it uses for doola-side auth failures (see `FetchAccessToken`). Statuses with their own meaning are mapped to the cases above, never here. | Retry / surface their own error state.                                                                 |
| `renewal_failed`          | A mid-session renewal failed for a non-401 reason. The app keeps working until the current token expires.                                                                                                                                                                        | Usually nothing; escalates to `partner_session_expired` semantics if their route starts returning 401. |

## Load errors → `onLoadError`

| type                    | meaning                                                                            |
| ----------------------- | ---------------------------------------------------------------------------------- |
| `api_connection_error`  | Could not reach doola.                                                             |
| `authentication_error`  | Session rejected by the API (expired mid-flight and backstop renewal also failed). |
| `invalid_request_error` | 4xx caused by integration configuration; not retryable.                            |
| `render_error`          | The component could not render — commonly browser extensions or CSP.               |
| `api_error`             | Everything else, including doola 5xx.                                              |

Both handlers may be called more than once per incident and must be idempotent
(`onAuthError` in the contract says when it fires). In most cases the component
renders its own error UI; `onLoadError` exists for the partner's analytics and for
anything on _their_ page that depends on the frame.
