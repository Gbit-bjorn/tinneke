# Roadmap — BK-DPK-LPD Attestering (Web)

> Claude: controleer dit bestand bij elke sessie. Markeer taken als:
> `[ ]` todo — `[-]` bezig (+ datum) — `[x]` afgerond (+ datum)

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

## Hoge prioriteit

- [ ] Onderwijs Vlaanderen API integratie — BK-data live ophalen i.p.v. statische JSON
- [ ] Opleidingstrajecten API — duale trajecten met competenties koppelen
- [ ] Export BK-bewijs — PDF/HTML per leerling met BK/DBK-hiërarchie en percentages
- [ ] Onderwijsdoelen API — officiële eindtermen/minimumdoelen integreren

## Medium prioriteit

- [ ] Admin UI richting→BK koppeling (nu handmatig via JSON)
- [ ] Batch-herberekening BK-stats (nu on-demand per leerling)
- [ ] Structuuronderdelen API — studierichtingen koppelen aan officiële structuur
- [ ] Onderwijsaanbod SO API — welke school biedt welke duale richting aan

## Laag prioriteit

- [ ] DKW-kolommen in WISA DUAAL_API2
- [ ] Testen op school-PC (exe, zonder Python)
- [ ] App icoon voor desktop exe
