# Research: Code-kwaliteit en Performance Analyse

> Onderzocht: 2026-04-13

## Inline Styles — 490 totaal

| Bestand | Inline styles |
|---|---|
| `views/attestering/detail.ejs` | 83 |
| `views/klassen/detail.ejs` | 65 |
| `views/bk/mapping.ejs` | 54 |
| `views/dashboard.ejs` | 38 |
| `views/bk/index.ejs` | 38 |
| `views/bk/detail.ejs` | 38 |
| `views/llinkid/detail.ejs` | 31 |
| `views/wisa/sync.ejs` | 30 |
| `views/admin/gebruikers.ejs` | 24 |
| `views/llinkid/doelen.ejs` | 23 |
| `views/klassen/nieuw.ejs` | 23 |
| `views/llinkid/index.ejs` | 18 |
| `views/partials/head.ejs` | 17 |

### Herhalende patronen
- `display:flex; justify-content:space-between; align-items:center` — tientallen keren
- Heading-stijl: `font-size:17px; font-weight:700; color:#0F172A`
- Subtext-stijl: `font-size:14px; color:#475569`
- Button-stijl: `min-height:44px; display:inline-flex; align-items:center; gap:8px`
- Icon-wrapper: `width:64px; height:64px; background:#EFF6FF; border-radius:12px; display:flex`
- Hardcoded kleuren: `#0F172A`, `#475569`, `#64748B`, `#1E3A8A` zonder CSS-variabelen

## CSS-organisatie — KRITIEK

- `public/css/` is **leeg** (enkel `.gitkeep`)
- Alle styling zit in `<style>` blok in `views/partials/head.ejs`
- Geen CSS-framework, geen design system, geen CSS-variabelen
- Google Fonts (Inter) via CDN

## JavaScript — alles inline

- `public/js/` is **leeg** (enkel `.gitkeep`)
- Alle client-side JS zit als inline `<script>` in EJS templates
- `attestering/detail.ejs`: 910+ regels totaal
- `bk/mapping.ejs`: 644+ regels
- `klassen/detail.ejs`: 413+ regels

## EJS Partials — minimaal

- Slechts 2 partials: `head.ejs` en `footer.ejs`
- Geen partials voor: cards, badges, tabellen, form-inputs, empty states, page headers
- Copy-paste van identieke patronen (empty state, flex-header, progress bar)

## Route-structuur

- `routes/bk.js` (308r): bevat API upsert-logica die in `lib/` hoort
- `lib/export.js` (1129r): te groot, onvoldoende opgesplitst
- `lib/database.js` (906r): goed gestructureerd maar groeit

## Refactoring-prioriteiten

1. **CSS-bestand aanmaken** met variabelen + utility classes → inline styles verwijderen
2. **JS uit templates** naar `public/js/*.js` bestanden
3. **EJS partials** voor herhaalde componenten (page-header, empty-state, progress-bar)
4. **Routes opruimen** — business logic naar lib/
5. **Database opsplitsen** als het verder groeit
