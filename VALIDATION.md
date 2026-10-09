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


Results: 7 pagination checks, 30 Favorite checks, 27 production Chromium checks and 8 screenshot Chromium checks passed (72 total). JavaScript syntax, JSON, ZIP integrity and source hashes passed for the generated variants.
