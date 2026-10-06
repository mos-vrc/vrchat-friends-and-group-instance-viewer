# v1.5.4.22 validation

- 11 production browser checks passed: Offline loading status remains hidden while a delayed bulk request is active; timestamps remain local; cache freshness, language settings and refresh behavior remain functional.
- Location-mode default width is 280px, equal to its resizing minimum. Old default 336px preferences migrate; custom widths remain stored.
- Normal friend cards were checked at their exact new minimum widths: small 320px, medium 360px and large 400px. Full Offline timestamps fit before the thumbnail. Normal timestamp layout also passed at 860/1280px across all sizes and themes.
- 15 language/sidebar browser checks passed, including language detection/persistence, pointer and keyboard resizing, cancellation, zoom, bounds, reload and cache clearing.
- Tests use local Chromium and mock APIs. No real-account mutations or store submission performed.
- Normal, Chrome Web Store and screenshot packages were built. Web Store runtime files match the normal release exactly; neither includes screenshot fixtures.
- 13 screenshot browser checks passed, including local demo images, state toggles, language switching and sidebar resizing, with no API/external requests or runtime errors. Screenshot action launcher handler passed.
