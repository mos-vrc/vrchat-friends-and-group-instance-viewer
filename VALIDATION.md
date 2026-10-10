# 検証内容 / Validation

## Pagination policy

Favorites (world, vrcPlusWorld and friend) and online/Offline friend lists request n=100. The offset still advances by the actual returned array length. An empty page confirms completion; a short page is not treated as completion. Validation, duplicate-page detection, abort and safety limits remain active. Request concurrency and rate-limit waiting follow the shared request policy.

Sources reviewed on 2026-10-09 (community-maintained API specifications, not official VRChat documentation):
- https://vrchat.community/reference/get-favorites — n: 1–100, zero-based offset.
- https://vrchat.community/reference/get-friends — n: 1–100; offline flag.
- https://vrchat.community/reference/get-recent-worlds — n: 1–100. Recent keeps the previously observed 50-slot window because inaccessible rows can be filtered. Returned length does not reveal consumed slots or a server cap, so increasing its offset blindly risks skipping worlds.

Typed group-content batch loading, shared in-flight reads, cached world details and confirmed Favorite-write updates prevent individual or duplicate requests. Endpoints without documented pagination are not given speculative paging parameters.

## Verification

Pagination checks cover complete IDs/order, server cap 50, Offline parameters, empty/exact-100 lists, repeated pages, abort, 403/429 propagation and Recent filtered rows/final-page repetition. Favorite tests cover add/move/remove/undo, unavailable worlds, sparse/legacy/VRC+ list metadata, external conflicts and uncertain writes. Chromium checks cover Friend hydration after cache deletion/reopen, release UI, feedback/retry and unavailable-world safety. Browser API writes use controlled responses; no live account data is changed. This Chromium is tested using local HTTP, package CSP and a runtime shim, not installed-extension service-worker verification.


## Origin rule and failure handling verification

Header rule tests verify scope to the extension initiator, HTTPS vrchat.com, known Favorite/rename/InviteMe write paths, POST/DELETE/PUT, and no Cookie modification. Worker tests verify installation before writes and no network write if installation fails. API tests use the supplied 403 JSON and verify that it is classified without replay. World operation tests cover first registration and an interrupted move after DELETE, with no futile restore writes. Chromium UI tests verify Japanese/English failure guidance and no automatic full Favorite reread after Origin rejection; generic rejected-write rollback and 429 behavior remain covered.

The test Chromium can render and test the UI but does not expose an installed-extension service worker. Thus actual declarativeNetRequest header application and successful live VRChat writes have not been verified here. No live-account changes were made. The reported 429 indicates server throttling; suppressing avoidable follow-up reads reduces load but does not guarantee absence of throttling.


## Header setup diagnostics

The user reported no network POST when the v1.6.4 message appeared. This identifies an unsent header-setup failure rather than a live VRChat rejection, but the original Chrome exception was not captured. The long Origin regex has been replaced by four small URL filters, while exact write routes/query checks remain in the worker. Tests emulate a rejected rule installation and verify the original diagnostic reaches the localized UI, sends no DELETE or POST, and preserves registration. They do not establish that regex complexity was the original installation error. Installed-extension validation remains unavailable in this test Chromium, even with the default disable-extensions argument removed. Live VRChat success is not asserted.

Results: 82 controlled checks passed (45 Node, 29 production browser and 8 screenshot UI checks). Syntax, JSON, package integrity and source hashes were verified.

## Request throttling verification

Controlled-clock tests cover two-second shared fallback cooldown, bounded 1/2/4-second per-request retries, server Retry-After seconds/date, concurrent responses, persisted deadlines, single concurrency and 500ms spacing. A 340-world fixture verifies that a move checks only its 90-world source list (two paged requests), preserves unrelated memberships and does not extend global snapshot freshness. External moves, stale/new registrations and 429 before deletion remain covered. Chromium tests exercise bounded retries, recovery and localized guidance with controlled API responses.
