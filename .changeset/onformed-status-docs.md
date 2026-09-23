---
'@doola/js': patch
---

Correct the `onFormed` docs. A submitted company reads as
`formationSubmissionStatus: "AWAITING_PAYMENT"` from
`GET /v1/partner/companies/{companyId}`, and
`POST /v1/partner/companies/{companyId}/payment-confirmed` moves it to
`"PENDING"`. 0.1.0 named the field `status`, gave `"PENDING"` as the value
right after submit, and described the awaiting-payment state as not shipped
yet. A partner following it would have checked the wrong field for the wrong
value. Documentation only: no runtime or type change.
