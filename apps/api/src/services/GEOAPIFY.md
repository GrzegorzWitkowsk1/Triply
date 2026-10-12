# Geoapify fallback accounting

Overpass and its mirrors remain primary. Only transport/provider failures activate
Geoapify after the existing bounded Overpass attempts. Empty valid responses do
not activate fallback. Disabled Geoapify or a missing backend key preserves the
existing `null` provider-unavailable result. Existing attraction caching remains in use.

Billing reference (checked 2026-10-12):
https://apidocs.geoapify.com/docs/places/#pricing — one credit per started batch
of 20 returned places. The client reserves `ceil(limit / 20)` before HTTP and
settles successful validated responses using all returned features, before any
filtering or deduplication. Empty results retain one credit conservatively.
Malformed, oversized, timed-out, network-failed, and HTTP-failed responses consume
the full reservation because their billable usage cannot be established.

`apiUsage` has a unique `(provider, service, date)` index, UTC date keys, consumed
and reserved totals, an attempt count, and reservation IDs. Initialization handles
duplicate-key races. Reservation uses a single conditional MongoDB update with
`$expr` checking `consumed + reserved + requested <= limit`, and increments/pushes
atomically. Writes require majority acknowledgement. Missing connectivity, index
creation failure, or uncertain acknowledgement prevents HTTP. All backend
instances must use the same database and daily-limit configuration.

Settlement matches the reservation ID and credit amount, removes it, and moves
credits to consumed in one atomic operation. Repeated settlement cannot release
credits twice. Crashes and failed settlement leave reservations counted for the
whole day; there is no expiry or automatic reclaim of abandoned reservations.
Only cancellation before fetch or a UTC rollover before fetch releases a reservation
with zero usage. Each day's record is independent; no reset job or TTL deletion
is used. Previous records are retained for diagnostics.

There are at most two HTTP attempts. Only 502/503/504 are retried, each with a new
reservation. Retry-After is respected; waits longer than two seconds end retries.
Quota/auth errors, invalid responses, network errors, and timeouts are not retried.
Redirects are rejected to prevent additional unmetered requests or key forwarding.
Usage logs contain no key, URL, response body, or raw provider error.

Provider identities use `geoapify/<sha256(place_id)>` to fit the existing identifier
length limit; `sourceId` preserves the upstream ID. Category classification feeds
the existing normalizer and scorer. Actual OSM raw metadata, when provided, feeds
existing opening-hours and admission parsing. Missing information stays unknown.
Address, description, and source metadata are optional shared contract fields and
are persisted in the existing attraction schema. No discovery-specific branches
are added to scheduling, pricing, routing, or editing.

The application budget covers this client's requests only, not other software
using the same API key. Accounting is by UTC request-start day; provider-side
billing timestamps around midnight may differ. Conservative failures and crashes
can exhaust the local budget before the provider's reported usage does.
