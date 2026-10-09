# v1.6.1 Mist validation

Sage has been replaced by Mist: pale neutral gray surfaces, charcoal text, muted blue-gray accent, light color scheme. Saved sage preferences migrate to mist. There are six theme options, with localized Mist/ミスト labels.

Theme settings use one nonwrapping row with a flexible label and right-aligned swatches. Browser checks measure that label and controls share a center line, all six swatches share one row, and controls align with the settings row right edge at 320/620/860/1280px. At 320px this verifies the settings panel; full-page layout checks apply at 620px and above.

Fresh Chromium checks passed: 9 screenshot UI groups plus 2 production release/view groups. Covers both languages, six themes, three sizes, normal/simple world consistency, all instance filters/Friends/world views, image rendering, theme persistence and retired Sage migration. Japanese Mist world/settings screenshots reviewed. The v1.6 browser regression suite previously passed 47 groups.

Production uses controlled API responses. Screenshot UI is served locally with package CSP and a runtime URL shim. No actual service worker installation or real-account writes are claimed. Version remains 1.6.1. README contains usage only; updates are in CHANGELOG. Production permissions/endpoints are unchanged.

JS syntax and JSON checks, ZIP integrity and source SHA-256 hashes passed. Web Store package has no dummy data.
