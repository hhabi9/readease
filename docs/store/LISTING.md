# Chrome Web Store listing — copy-paste sheet

Everything below maps 1:1 to fields in the [developer dashboard](https://chrome.google.com/webstore/devconsole).

Upload package: `readease-v0.3.1.zip` (repo root; rebuild with `./scripts/package.sh`).

## Store listing tab

**Name** (from manifest): ReadEase - Text Size & Reading Highlighter

**Summary** (132 chars max):

> Make pages easier to read: enlarge just the article text while menus stay put, and highlight passages as you go. Saved per site.

**Description:**

> Reading on the web shouldn't mean squinting. ReadEase lets you grow the text
> you're actually reading — articles, study notes, documentation — without
> blowing up the whole layout, and mark up passages while you read.
>
> TEXT SIZE
> • Scale reading text from 50% to 250% with a slider, A−/A+ buttons, or keyboard shortcuts
> • Main-text mode grows paragraphs, lists, and headings while menus, buttons, and sidebars keep their size
> • Whole-page mode scales everything, for when you want it all bigger
> • Your choice is saved per site and re-applied automatically next visit
> • Works inside modern web apps (shadow DOM and embedded frames included)
>
> READING HIGHLIGHTER
> • Flip it on, select text, and it's highlighted — in four colors
> • Click a highlight to remove it, or clear them all from the popup
> • Highlights are per-session: they vanish on reload, keeping pages clean
>
> KEYBOARD SHORTCUTS
> • Alt+Shift+Up / Alt+Shift+Down — text size
> • Alt+Shift+H — toggle the highlighter
>
> PRIVATE BY DESIGN
> No accounts, no analytics, no ads, no servers. ReadEase makes zero network
> requests; settings live in your browser's extension storage and nothing is
> ever transmitted.

**Category:** Accessibility
**Language:** English

**Assets** (all in `docs/store/`):
- Screenshots (1280×800): `screenshot-1-article.png`, `screenshot-2-popup.png`
- Small promo tile (440×280): `promo-tile-440x280.png`
- Marquee (1400×560, optional): `promo-marquee-1400x560.png`

## Privacy tab

**Single purpose description:**

> Improves readability of web pages the user is reading by letting them
> enlarge the page's reading text and temporarily highlight passages.

**Permission justifications:**

- `storage` — Saves the user's per-site text-size preference (scale percentage
  and main-text/whole-page mode) and their chosen highlight color so settings
  persist between visits. Nothing else is stored.
- **Host permissions (content script on all sites)** — The user can invoke
  text resizing and highlighting on any page they happen to be reading, so the
  content script must be able to run on any site. It only adjusts font sizes
  and wraps selected text in highlight marks, locally; it reads nothing back
  and transmits nothing.

**Remote code:** No, I am not using remote code.

**Data usage:** check **none** of the collection boxes, then certify the three
disclosures (no sale of data, no unrelated use, no creditworthiness use). The
extension collects nothing.

**Privacy policy URL:** https://github.com/hhabi9/readease/blob/main/PRIVACY.md

## Distribution tab

- Visibility: Public
- Distribution: all regions
