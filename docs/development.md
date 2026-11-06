# Design Studio: development and tests

## Local development

For development, enter the absolute path of a local checkout under **Add plugin**; it installs as a `link:`. Client changes still need a restart. `lib/picker.js` is served fresh on every request, so it doesn't.

## Tests

```sh
node test/test-serve.mjs
node test/test-core.mjs
node test/test-client.mjs
node test/test-skill.mjs
node test/test-history.mjs
node test/test-phone.mjs
node test/test-doc.mjs     # PDF and PowerPoint export
node test/test-look.mjs    # check_design / look_design (the real-browser part needs Chrome or Edge)
node test/test-system.mjs  # brand design systems (the real-browser part needs Chrome or Edge)
node test/test-tweaks.mjs  # tweaks: tweaks.json, write-back (every top-level copy of a variable), wiring check, live page
node test/test-handoff.mjs # build as code: project detection (incl. uni-app from CLI or HBuilderX, Taro, native WeChat), handoff note (mini program rules per target) and screenshots, default destination, symlink guards, lossless pixel compare (inner scroll areas, data-theme dark, redirects off localhost blocked)
node e2e/check-page.mjs    # design check in headless Chrome
node e2e/e2e-studio.mjs    # end to end: a throwaway DSH from npm, a fake model and headless Chrome
```
