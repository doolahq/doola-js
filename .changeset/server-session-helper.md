---
'@doola/js': minor
---

New `@doola/js/server` entry with `createSessionHandler` and `createCustomerSession`, which build the session route from step 1 of the guide. They pick the API host from your secret key, rewrite doola's 401 to a 502 so a signed-in customer is never sent to your login, and forward only `accessToken` and `expiresIn`. Server only, with no dependencies, on Node 18 or later and any runtime with the web-standard `fetch`. The browser entry is unchanged.
