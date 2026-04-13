# Roadmap — BK-DPK-LPD Attestering (Web)

> Claude: controleer dit bestand bij elke sessie. Markeer taken als:
> `[ ]` todo — `[-]` bezig (+ datum) — `[x]` afgerond (+ datum)
> Gedetailleerd plan: `docs/implementatieplan.md`

## Afgerond

- [x] 2026-03-28 Desktop app (Python/CustomTkinter) — feature-complete, standalone exe
- [x] 2026-04-01 Web app basis: Express/EJS, login, klassen, leerlingen, WISA-sync
- [x] 2026-04-01 LLinkid-integratie: leerplannen ophalen, doelen tonen, koppeling richting→leerplan
- [x] 2026-04-03 BK-database ontwerp: 7 tabellen (beroepskwalificaties, dbk, competenties, mapping, attestering)
- [x] 2026-04-03 BK-integratie backend: CRUD, seeding vanuit richting_bk_mapping.json, statistieken
- [x] 2026-04-03 BK-mapping UI: admin koppelt LPD's aan competenties per BK
- [x] 2026-04-03 Attestering: BK/DBK-percentages berekend en getoond naast LPD-secties
- [x] 2026-04-09 Export: HTML/Excel/CSV klasoverzicht, WISA-import
- [x] 2026-04-13 Rebrand: DIA-logo, app-naam "Attestering"
- [x] 2026-04-13 Onderwijs Vlaanderen API verkend: 16 APIs, key werkend
- [x] 2026-04-13 Research: WISA sync, leerplan/BK structuur, duaal vs regulier, API data, code-kwaliteit

## Fase 1 — WISA Sync veilig maken (HOOGSTE PRIORITEIT)

- [ ] `wisa_id` (stamboeknummer) kolom toevoegen aan leerlingen
- [ ] Sync van delete+insert naar upsert op wisa_id
- [ ] Bestaande attesteringen behouden bij re-sync
- [ ] Schooljaar-filter in sync UI
- [ ] Verdwenen leerlingen markeren als "uitgeschreven" i.p.v. verwijderen

## Fase 2 — Meerdere leerplannen per klas/leerling

- [ ] `klas_leerplan_mapping` → composiet PK (klas_id + leerplan_uuid) + type-kolom
- [ ] `lpd_resultaten` uitbreiden met `leerplan_uuid`
- [ ] Attestering-route: meerdere leerplannen laden
- [ ] UI: LPD's groeperen per leerplan
- [ ] LLinkid koppel-endpoint implementeren (TODO in code)

## Fase 3 — Onderwijs Vlaanderen API live integratie

- [ ] API-client voor Beroepskwalificaties 2.0 + Opleidingstrajecten
- [ ] Instelling 147637 (Damiaaninstituut B en C) als standaard
- [ ] seedBkData() idempotent maken (ON DUPLICATE KEY UPDATE)
- [ ] Cache met TTL in database
- [ ] Fuzzy LIKE matching vervangen door exacte koppeltabel

## Fase 4 — Code-kwaliteit en performance

- [ ] CSS-bestand aanmaken: variabelen + utility classes (490 inline styles verwijderen)
- [ ] JS uit EJS templates naar public/js/*.js
- [ ] EJS partials: page-header, empty-state, progress-bar, card
- [ ] Routes opruimen: business logic naar lib/
- [ ] lib/export.js (1129r) opsplitsen

## Fase 5 — Regulier SO ondersteuning

- [ ] Onderwijsvorm-concept (duaal vs regulier) in datamodel
- [ ] Regulier: attestering per vak/leerplan (A/B/C)
- [ ] Duaal: huidige BK/DPK workflow behouden
- [ ] Auto-detectie via WISA leerwegcode (D=duaal, V=voltijds)
