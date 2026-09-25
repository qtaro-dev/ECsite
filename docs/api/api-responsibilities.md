# API responsibilities (T03)

Source of truth: detailed design §6 and screens/flows in `docs/wireframes/`. This table covers HTTP operations only. Server Component display reads use the server data layer directly and therefore have no synthetic API endpoint. All successful responses use `{ data, requestId }`; errors use `{ error: { code, message, fieldErrors? }, requestId }`. Mutations validate input on the server, apply Origin checks to browser-authenticated writes, and never trust browser price, shipping, stock, role, or payment state.

| Operation | Caller / authorization | Request and response responsibility | UI mapping | Main failures |
|---|---|---|---|---|
| `GET /api/products` | Public | Search published products; q ≤100, category/usage/manufacturer, integer price bounds, category specifications, PC-case `minGpuClearanceMm`, sort, page; 24/page | S01–S04 | 400 invalid filters; 429; 503 |
| `POST /api/compatibility` | Public | Category/product IDs (max one per category); five ordered findings `rule/status/reason/comparedValues/matchingUrl`; incompatibility links use `/search` filters including minimum GPU clearance | S05, S13 | 400; 404 unpublished/unknown product; 429; 503 |
| `GET /api/cart` | Anonymous cart cookie or own member session | Current prices, availability and estimated shipping | S06 | 401; 404; 503 |
| `PUT /api/cart` | Anonymous cart cookie or own member session | Product ID and quantity 1–10; server recomputes cart projection | S04, S06 | 400; 401; 409 stock/quantity; 429; 503 |
| `POST /api/cart/merge` | Authenticated member plus anonymous cart cookie | Return current cart plus per-product resulting quantity for entries adjusted to the quantity/stock limit | S07–S09 → S12 | 401; 403; 409; 429; 503 |
| `POST /api/checkout/quote` | Authenticated member | Saved address ID or validated domestic address; recalculate item/stock/compatibility/tax/shipping; return quote ID and expiry | S12–S13 | 400; 401; 403; 404; 409; 429; 503 shipping unavailable |
| `POST /api/checkout/start` | Authenticated member | Quote ID, explicit confirmation and required `Idempotency-Key`; ignore client totals, revalidate, allocate stock, create Stripe test Checkout, return order ID and Checkout Session URL | S13 | 400; 401; 403; 404; 409 changed quote/stock; 429; 503 |
| `GET /api/checkout/status?orderId=` | Owning member only | Return order state, user guidance and retry eligibility; no success inference from redirect | S14, S17 | 400; 401; 404 other owner/absent; 429; 503 |
| `POST /api/webhooks/stripe` | Publicly reachable Stripe webhook; verify `Stripe-Signature` | Exact raw body bytes; event dedupe; duplicate acknowledged without reprocessing | S14 state refresh (server side) | 400 invalid signature/payload; 429; 503 |
| `POST /api/internal/reconcile-payments` | Supabase Cron only; environment-specific `INTERNAL_JOB_SECRET` HMAC | `X-Internal-Job-Timestamp` is Unix seconds; `X-Internal-Job-Signature` is lowercase hex HMAC-SHA256 over ASCII timestamp + LF byte + exact raw body bytes. Reject absent/malformed signature or timestamp outside ±300 seconds with 401. Reconciliation is idempotent so valid calls can safely retry during the timestamp window. | Background operation | 400 malformed body; 401 signature/timestamp; 429; 503. |
| `POST /api/auth/sms/start` | Public registration/reset flow; server rate limited | Purpose and flow; return issuance state only, never OTP | S08–S10 | 400; 429; 503 |
| `POST /api/auth/sms/verify` | Public registration/reset flow; server rate limited | Challenge and 6-digit code; return verification state and short-lived token, never submitted code | S09–S10 | 400; 404 expired/invalid challenge; 429; 503 |
| `POST /api/auth/register` | Same-origin registration form | Email, password, confirmation, terms acknowledgement; Supabase confirmation email; passwords never echoed | S08–S09 | 400; 403; 503 |
| `POST /api/auth/login` | Same-origin login form | Email and password; generic credential failures; SSR cookie session and validated same-site return path | S07 | 400; 401; 403; 503 |
| `POST /api/auth/logout` | Same-origin member action | Clear Supabase SSR session cookies | S15 | 403; 503 |
| `POST /api/auth/verify/resend` | Same-origin verification screen | Email only; generic response that does not disclose account existence | S09 | 400; 403; 503 |
| `GET /auth/callback` | Supabase Auth email confirmation redirect | Exchange one-time code for SSR cookie session and redirect to verification stage or validated same-site path | S09 | 302 to same-site path |
| `POST /api/auth/email-hook` | Supabase Auth Hook signed request | Verify signature over raw body, allowlisted template, send result; no secrets in response/log | S08–S10 | 400 malformed; 401 invalid signature; 429; 503 delivery failure |
| `GET /api/account/addresses` | Authenticated member | Own addresses only | S11–S12 | 401; 429; 503 |
| `POST /api/account/addresses` | Authenticated member; Origin validated | Create domestic address for current member | S11–S12 | 400; 401; 403; 409; 429; 503 |
| `PATCH /api/account/addresses` | Authenticated member; Origin validated | Update address identified in payload; non-owned address is indistinguishable from absent (404) | S11 | 400; 401; 404; 409; 503 |
| `DELETE /api/account/addresses/{id}` | Authenticated member; Origin validated | Delete own address only | S11 | 401; 404; 409; 503 |
| `POST /api/account/delete` | Authenticated member, reauthentication and explicit confirmation | Safe handling of active payment, then idempotent member/Auth deletion | S15 | 400; 401; 409 active operation; 503 |
| `GET /api/admin/products` | `admin_memberships` verified server side | Search products including drafts for A02 | A01–A02 | 401; 403; 429; 503 |
| `GET /api/admin/overview` | `admin_memberships` verified on every request | Published products, out-of-stock inventory, orders, failed notifications; `requestId` is the audit correlation ID | A01 | 401; 403; 503 |
| `POST /api/admin/products` | `admin_memberships`; Origin validated | Create category-typed product; incomplete draft allowed, publish validation enforced; audit ID | A02 | 400; 401; 403; 409; 429; 503 |
| `PATCH /api/admin/products` | `admin_memberships`; Origin validated | Update typed product with expected version and audit ID | A02 | 400; 401; 403; 404; 409; 503 |
| `GET /api/admin/inventory` | `admin_memberships` | Read physical, allocated and available quantities | A03 | 401; 403; 429; 503 |
| `POST /api/admin/inventory` | `admin_memberships`; Origin validated | Quantity adjustment with reason and expected version; atomic result | A03 | 400; 401; 403; 404; 409; 503 |
| `GET /api/admin/orders` | `admin_memberships` | Read-only orders, payment attempts and audit context | A04 | 401; 403; 429; 503 |
| `GET/PATCH /api/admin/settings/shipping` | `admin_memberships`; Origin validated for PATCH | Read or versioned update of shipping rules/rate table; audit; unavailable configuration blocks quote | A05 | 400; 401; 403; 409; 503 |
| `GET/PATCH /api/admin/settings/email` | `admin_memberships`; Origin validated for PATCH | Read safe settings / save SMTP settings; secret is never returned | A06 | 400; 401; 403; 409; 503 |
| `POST /api/admin/settings/email/test` | `admin_memberships`; Origin validated; rate limited | Test configured connection and return safe diagnostic only | A06 | 401; 403; 429; 503 |

## Security and contract notes

- The session security scheme intentionally describes server-managed cookies without guessing a cookie name. Cookies are `HttpOnly`, `Secure`, `SameSite=Lax`; authenticated writes also require Origin validation.
- Stripe webhook verification uses the raw request body and Stripe signature header. Supabase email-hook verification uses the provider's signed raw payload. Neither endpoint uses member-cookie authorization.
- Supabase SSR session refresh happens in the Next.js 16 `proxy.ts`; authorization uses server-side `auth.getUser()`. Never trust a decoded browser token or user-editable metadata for owner or checkout decisions.
- Email registration accounts cannot begin checkout until email confirmation and trusted signup SMS challenge state are both verified. T19 supplies the server-side SMS state lookup; Google OAuth exemption is implemented with T18.
- Admin access is checked server-side against `admin_memberships`; hiding admin links is not authorization. Stored SMTP credentials, service-role credentials, OTP values, full addresses, and internal DB errors are not returned or logged.
- T36 checks the SSR user with `auth.getUser()` and then checks the active membership using a server-only service-role client. The service-role key is never imported by a client component. Dashboard output contains only four operational counts and an audit correlation ID.
- `POST /api/internal/reconcile-payments` uses the approved HMAC contract recorded in OpenAPI. Timestamp freshness limits replay age; already processed reconciliation work must remain idempotent.
- The design's address update route is collection `PATCH /api/account/addresses`; this contract preserves it. Common product fields and inventory/shipping/email setting fields are typed where the design names them. Category-specific product-spec payloads and the internal heavy-shipping rate-row shape remain unspecified by design and must be fixed before feature implementation needs those schemas.
