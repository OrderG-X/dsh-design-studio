<div align="center">

<img src="assets/hero.svg" alt="dsh-design-studio — a design canvas for DSH" width="760" />

<p>
  <a href="https://github.com/OrderG-X/dsh-design-studio/releases"><img src="https://img.shields.io/github/v/release/OrderG-X/dsh-design-studio?label=release&color=4D6BFE" alt="release" /></a>
  <img src="https://img.shields.io/badge/license-MIT-blue" alt="License: MIT" />
  <a href="https://github.com/awesome-dsh-plugin/awesome-dsh-plugin"><img src="https://img.shields.io/badge/DSH-plugin-4D6BFE" alt="DSH plugin" /></a>
</p>

<p>
  <a href="README.md">简体中文</a> ·
  <a href="README.en.md"><b>English</b></a>
</p>

</div>

> **What it is:** a DeepSeek Harness (DSH) plugin that shows the model's web pages, app screens, posters and slides live on a canvas in the right sidebar, in phone or browser frames. Click an element or drag a region, add a sentence, and the model edits it. Versions are saved every turn; export showcase images, PDF or PowerPoint, or preview on a phone. A one-click design check finds overflowing text, low contrast and small tap targets.
>
> **Use it for:** "make a landing page", "design an app screen", "make a poster", "make a few slides".
>
> **Install:** `dsh plugin add https://github.com/OrderG-X/dsh-design-studio/releases/latest/download/dsh-design-studio.tgz`, then restart DSH.

A design workbench for DSH (DeepSeek Harness), in the spirit of Google Stitch. When the model builds a web page, an app screen, a poster or a slide deck, the **Design Studio** tab in the right sidebar shows it live. Screens appear one by one on a canvas, each inside a phone or browser frame. When something looks off, click the element or drag over an area. The plugin turns your pick into text in the chat input. Add "make it orange" and send. The model edits the source, and the change flashes in the preview.

![demo](assets/demo.gif)

Say "switch the primary color to deep blue" and all three screens change together. Then go back to the previous version, drag the slider to compare, and export a showcase image in one click:

![version compare and export](assets/demo-versions.gif)

The exported showcase, straight from the plugin with no editing:

![showcase](assets/showcase.jpg)

## Install

```sh
dsh plugin add https://github.com/OrderG-X/dsh-design-studio/releases/latest/download/dsh-design-studio.tgz
```

**Restart DSH** after installing, because client code is bundled when DSH starts. The plugin is listed as 设计工作台 / Design Studio on the Plugins page.

For development, link a local checkout with `dsh plugin --profile desktop add link:/path/to/dsh-design-studio`. Client changes still need a restart. `lib/picker.js` is served fresh on every request, so it doesn't.

## What it does

1. **Opens by itself, but only for design work.** Design work means the model loaded the design skill, called `preview_page`, or wrote a page with a design-type tag (`<meta name="dsh-design">`). After that, the tab pops up when the model writes an `.html` file or starts a dev server (`npm run dev` and the like). HTML written by other tasks doesn't pop up. Instead, a blue dot appears on the header button, and clicking it previews the file. Ports the model only probes with `curl` or the browser tools are never opened.
2. **Frames by design type.** Supported types are web (browser window), app (phone with Dynamic Island), tablet, poster (1080×1350), slides (16:9) and email. The model names the type in the tool call, or the page declares it with `<meta name="dsh-design" content="app">`. You can add a size, as in `poster 1080x1920`. The toolbar's type menu switches it at any time.
3. **Shows several screens on one canvas.** HTML files in the same folder line up in creation order. Pan with two fingers and zoom with a pinch or ⌘ + scroll. Click a screen to select it and double-click to view it alone.
4. **Lets you watch it build.** A placeholder appears while the model works. Each new screen fades in from top to bottom with a scan line. While more screens are coming, a "generating…" card waits at the end of the canvas. When the model asks you something with a question card, the spinner turns into an orange dot reading "The model is waiting for your answer".
5. **Refreshes live without a white flash.** The next frame loads in the background and cross-fades in, keeping the scroll position. Dev servers keep their own hot reload; Vite and Next WebSockets pass through, including dev servers that only listen on IPv6 `::1` (recent Vite on macOS).
6. **Highlights what changed.** Changed and new elements glow briefly, and the preview scrolls to them if they are off screen. Shared CSS changes refresh every screen. A change to one screen's HTML leaves the others alone.
7. **Picks elements for the chat.** Hover outlines elements with their size. Click picks one element. Drag picks a region along with up to 10 main elements in it. The pick becomes a block in the chat input with the file, the CSS path, the HTML and key styles.
8. **Ships a built-in design guide.** The DSH skill `ui-design` loads before the model designs. It sets the type and canvas, writes `tokens.css` first and uses one file per screen. It covers spacing, type scale, color, contrast, Chinese typography, an "AI-look" blacklist and a self-check list, with notes for each design type. For a brand-new design the model first asks two or three key questions, then lays out three directions for the first screen (`home-a/b/c.html`, each with its own colors and fonts) side by side; you pick one and it builds the rest, moving the others to `drafts/`. If you already chose a feel in the questions, the three directions all stay in that feel and differ in layout and emphasis. Say "just build it", or give a specific brief, to skip this.
9. **Has a design tokens panel.** It lists the `:root` variables grouped by color, font, size, spacing, radius and shadow, with swatches. Click one to send it to the chat, say "make it forest green", and every screen updates together.
10. **Exports.** You can export one screen framed or plain, a full-page capture, or a **showcase** of all screens. The showcase uses the brand name as its title and takes its background and accent from your tokens. You can also export every screen as a **PDF** (one page per screen; web and email pages are full length, and page size follows the canvas) or a **PowerPoint** file (one slide per screen as an image, with the slide shape following the canvas; opens in PowerPoint, WPS and Keynote). Links between screens still work: in the PDF a button jumps to its page (and every screen has a bookmark), and in a slideshow it jumps to its slide, so the export is a clickable prototype. Files go to `exports/` in the design folder, and images are also copied to the clipboard.
11. **Keeps versions.** A version is saved before and after every model turn, named after what you asked (a picked element becomes a short name such as “「3.2 km」 · make it green”, not a selector dump). Open any version, drag the slider to **compare** it with now, or **restore** it. The current state is saved first, so restoring is always reversible.
12. **Switches to dark mode.** If the page has dark styles (`prefers-color-scheme: dark`, `[data-theme="dark"]` or `.dark`), a moon button toggles them, and exports follow.
13. **Makes two more versions.** Select a screen and ask for two alternative directions. They appear right next to the original on the canvas (the three starting directions `home-a/b/c` too, kept in a, b, c order). Click the check mark on the one you want: the chat input gets "use this one, move the other takes to `drafts/`, build the rest", ready to send.
14. **Views on your phone.** The scan button shows a QR code in the sidebar. Scan it with a phone on the same Wi-Fi and the design opens in the phone's browser at real size, fully tappable. The phone follows the screen you pick on the computer and refreshes when the model changes the design. The panel shows when the phone has opened it, lets you copy the link and stop sharing, and closes the link after 30 minutes idle.
15. **Works as a clickable prototype.** Screens link to each other with `<a href="detail.html">` or `data-href` (the built-in skill asks the model to do this). Select a screen on the canvas to see arrows for where it leads and what leads to it. Arrows that would cross another screen route around it, above the titles. The play button starts a demo: tap a button in the preview and the linked screen slides in, from the right going forward and from the left going back. The banner has back, restart and exit (Esc).
16. **Shows one screen at several sizes.** The third view button lays the current screen out at several widths: phone, tablet and desktop for web; small, standard and large for apps; three sizes for tablets. Cramped small screens show at a glance. Picking works there too and notes the width.
17. **Edits text in place.** Turn on the text button and click any text in the preview to edit it. Enter saves and Esc cancels. Local HTML is written back to the source file, only that one spot, with a version saved before and after. For dev-server pages, or when the text isn't in the source, a "change X to Y" request goes into the chat input for the model.
18. **Takes a reference image.** Drop an image onto the sidebar, paste it there, or use "Restyle from a reference…" in the tokens panel. The image is saved to `refs/` in the design folder (or the plugin cache when there is none). Its main colors with their shares, any small vivid accent, and whether it reads light or dark go into the chat input with the file path and an instruction to update `tokens.css` first.
19. **Checks the design.** The stethoscope button measures the rendered pages: text running off the screen, clipped, overflowing its box or overlapping; text contrast below WCAG (3:1 for large text, 4.5:1 for body); tap targets below 44 px in apps or 24 px on the web; tiny text; images that failed to load or are stretched; lines that are too long on web, email and tablet (about 45 Chinese characters or 90 letters); short labels and prices squeezed onto two lines; and too many font sizes. Every screen on the canvas is checked, and numbered markers appear on the problems in the preview (red for serious ones). Click an item to scroll to it. "Ask the model to fix" puts the list (screen, element, problem, by how much) into the chat input. After every model turn the sidebar measures again by itself: an open panel refreshes, and a closed one shows the number of remaining problems on its button (no number means all clear). Clicking an item brings its screen into view when the panel covers it or it is off the canvas. The model can run the check itself: in Design mode it calls `check_design` after writing or changing screens. The plugin opens each screen at real sizes in a hidden Chrome or Edge on this computer (several sizes at once, such as a short 375×667 and a large 430×932, and dark mode if asked). Besides the same list, it reports each screen's measurements (page height, top and bottom bar heights and their gap to the content) and catches four more problems: fixed top or bottom bars covering content or sitting too close to it (like the last row hidden under a tab bar; content merely scrolling under a bar is fine), script errors, stylesheets, scripts or fonts that failed to load, and links to screens that don't exist. Low-contrast and tiny text also name the CSS rule that sets them, with file and line. A repeat run says how many problems were fixed and how many are new (new ones are marked), and an incomplete run says so. The sidebar doesn't need to be open; without Chrome or Edge the sidebar measures instead.
20. **Lets the model look.** When the model wants to see the real rendering it calls `look_design`. The same hidden browser takes a screenshot at a given size (the top, scrolled to the bottom, the whole page in parts, or one element such as the tab bar, in light or dark) and hands the image to the model. No servers or screenshot scripts of its own.

On a narrow sidebar the less-used toolbar buttons move into a "More" menu.

`preview_page` takes `target` (a file path, port or URL), `kind` (web / app / tablet / poster / slides / email), and optionally `size` (such as `1080x1920`) and `screens` (dev-server routes to show side by side). `check_design` takes `screens` (which ones to measure), `sizes` (such as `["375x667","430x932"]`) and `dark`. `look_design` takes `screens`, `size`, `at` (top / bottom / full), `selector` (just this element) and `dark`.

## Design mode and switches

New sessions get a **Design** mode (shown as 设计模式) in the mode menu: all of Standard mode's tools plus the design skill and sidebar previews, with a design-focused persona. Pick it for design work; Standard, Creator and other modes keep these features too.

The plugin is split into parts, each with its own switch under DSH Plugins → Design Studio. Changes apply right away, no restart:

| Part | What it does | Default |
| --- | --- | --- |
| Design Studio | The sidebar and preview servers (turning it off means not using the plugin) | On |
| Open previews automatically | While designing, a written HTML file or a started dev server opens in the sidebar; off, the sidebar only offers a "Preview …" button | On |
| Preview and check tools (other modes) | Standard, Creator and other modes can use `preview_page`, `check_design` and `look_design` | On |
| Design skill (other modes) | Standard, Creator and other modes can load the `ui-design` skill | On |
| Design mode | The Design entry in the mode menu | On |

To design only in Design mode and keep other modes clean, turn off the two "(other modes)" switches. Design mode carries its own tool and skill and ignores them.

## Security

Each preview gets its own random `127.0.0.1` port, which is a different origin from DSH.

- **Only the previewed folder is served.** Requests that resolve outside it are refused. That covers `../`, encoded `../` and symlinks pointing outside.
- **DNS rebinding is blocked.** The Host header must be a local name plus this port.
- **Sidebar messages are checked.** The page talks only to DSH's own origins (`dsh-app://app` on desktop, plus DSH's web address). Outgoing messages name that origin, and incoming ones must come from the parent window with a matching origin. Another site that embeds the preview gets nothing and can't drive it. If you open DSH's web UI through a reverse proxy or a domain, that address must be listed in DSH's `trustedHosts` (`dsh-client-connection` config); otherwise picking, text edit and export won't work there.
- **The API requires a DSH login.** `/dsh-design-studio/api/*` checks it through DSH's `connection` service. Older DSH builds without that service accept only same-origin local requests.
- **Phone view is opt-in and locked down.** It listens only on this computer's LAN address (not 0.0.0.0) and checks the Host header. The link carries a random 128-bit token. On first open the phone trades it for an HttpOnly cookie scoped to that port, and the token leaves the address bar. Requests without it get 403. Stopping, or 30 minutes idle, closes the port, and the next start uses a new token. Anyone on the same Wi-Fi who gets the link can view it, so don't post it in a group chat.
- **Dev-server headers are relaxed only on the preview port.** When proxying a dev server, `X-Frame-Options` and CSP are removed there. The dev server itself is untouched.

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
node e2e/check-page.mjs    # design check in headless Chrome
node e2e/e2e-studio.mjs    # end to end: a throwaway DSH from npm, a fake model and headless Chrome
```

## Feedback

Found a bug or want a feature? [Open an issue](https://github.com/OrderG-X/dsh-design-studio/issues/new/choose). Including your DSH and plugin versions helps a lot.

## License

MIT
