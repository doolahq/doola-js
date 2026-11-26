---
'@doola/js': minor
---

`createCustomerSession` and `createSessionHandler` take an optional `servicePrices` (`currency` and `pricesInCents`) and send it on the customer session, in place of the prices set in the Partner Portal for that session. If you send prices, they are the complete price list for that customer: a service you leave out is not offered. If you send none, the portal's prices apply. Omitted, the field is not sent and the mint body is unchanged. The helpers pass the prices through as they are; doola checks them and refuses a mistake with a 400 `E_VALIDATION_FAILED`.

New types `DoolaServicePrices` and `DoolaPricedService` (`EinCreation`, `VariantEinExpedited`) name the prices object and the services it prices.
