# v1.5.4.23 validation

- All three packages include matching Japanese and English Chrome message catalogs, default_locale=en, and valid manifest references for name, description and action.default_title. Catalog strings are nonempty and within metadata length limits.
- Production HTML/JS/CSS match v1.5.4.22 byte-for-byte except version strings. Existing initial preferred-language selection, saved override and live UI switching are retained.
- 13 screenshot browser checks passed: all themes/sizes/tabs, language switching, width resizing, Offline/OtherPlatform, local images and refresh. No API/external requests or JavaScript errors.
- The local headless Chromium could not load an unpacked extension service worker, so Chrome-managed catalog selection and manifest substitution were validated structurally rather than through an installed-extension browser test.
- English is the default catalog for unsupported Chrome UI languages. Chrome metadata follows Chrome UI language independently of the app language setting.
- No new permissions. No store submission or real-account mutations.
