---
'@doola/js': minor
'@doola/sdk-protocol': minor
---

`loadDoola` takes an optional `onServiceOrder({ companyId, orderId })`, the payment handoff for a service the founder adds on their company's dashboard, such as an EIN. It carries the two ids and nothing else. Your server reads the order from doola right before charging, charges the sum of its items' prices, never starts a charge on an order that is not `AWAITING_PAYMENT`, and confirms it. It fires again for the same order when the founder clicks Resume, so charge once per order id: keep one payment record per order id in your own store, with an idempotency key per charge attempt. A charge that went through, or might have, is looked up at your payment provider and confirmed, never charged again. The dashboard offers services only to partners that pass `onServiceOrder`. Without it, nothing changes: the loader sends the frame exactly what it sent before, and a service order message is dropped, never sent to `onFormed`.

Protocol: a new app-to-loader message, `service-checkout-request` (`{ companyId, orderId }`), and an optional `serviceOrders` boolean on `init`, which the loader sends only as `true` when the partner registered `onServiceOrder`. The app reads anything but `true` as not registered. No protocol bump: a peer that does not know the field ignores it, and one that does not know the message drops it.
