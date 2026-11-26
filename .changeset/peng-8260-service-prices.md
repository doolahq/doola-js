---
'@doola/js': minor
---

`createCustomerSession` and `createSessionHandler` take an optional `servicePrices` (`currency` and `pricesInCents`) and send it on the customer session, in place of the prices set in the Partner Portal for that session. If you send prices, they are the complete price list for that customer: a service you leave out is not offered. If you send none, the portal's prices apply. A list that prices nothing counts as none, so to offer none of the priced services, turn them off in the Partner Portal. Amounts are whole numbers in the currency's ISO 4217 minor unit. Omitted, the field is not sent and the mint body is unchanged. `createSessionHandler` reads the prices once, when it is created.

The helpers send the prices as they are; doola checks them and refuses a mistake with a 400 `E_VALIDATION_FAILED`. A failure now carries doola's per-field errors as `doolaFields` (each field's `code` and `message`), for your logs only: the session route never sends it to the browser.

New types `DoolaServicePrices` and `DoolaPricedService` (`EinCreation`, `VariantEinExpedited`) name the prices object and the services it prices.
