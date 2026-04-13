# Research: Leerplan- en BK-structuur — Tekortkomingen

> Onderzocht: 2026-04-13

## Huidige structuur

### Koppeling leerling → leerplan
- Keten: `leerling → klas_id → klas → klas_leerplan_mapping → leerplan_uuid`
- `klas_leerplan_mapping` heeft `klas_id` als **PRIMARY KEY** → max. 1 leerplan per klas
- In `attestering.js:21`: `const leerplanUuid = await db.getKlasLeerplan(leerling.klas_id)`

### Koppeling richting → BK
- `richting_bk_mapping.json`: meerdere BK's per richting ✅ (bv. "Lassen-constructie" → 3 BK's)
- `seedBkData()` vult `beroepskwalificaties`, `deelberoepskwalificaties`, `richting_bk`
- Seed draait enkel als tabel leeg is — geen update-mechanisme
- `getBksVoorKlas()` gebruikt fuzzy `LIKE` matching → risico op false positives

### Koppeling richting → leerplan
- `richting_leerplan_mapping.json`: strict 1-op-1 (één UUID per richting)
- `richting_leerplan` tabel: `UNIQUE` op `richting` → hard 1-op-1

### LPD → competentie mapping
- `lpd_competentie_mapping`: koppelt `lpd_uuid` aan `competentie_id` met `gewicht`
- Leerplan-agnostisch — geen kolom die aangeeft uit welk leerplan de LPD komt
- Flexibel maar foutgevoelig bij handmatig beheer

## Tekortkomingen

| # | Probleem | Ernst |
|---|----------|-------|
| 1 | `klas_leerplan_mapping.klas_id` is PRIMARY KEY → max. 1 leerplan per klas | Architectureel |
| 2 | `richting_leerplan` heeft UNIQUE op richting → max. 1 leerplan per richting | Architectureel |
| 3 | `lpd_resultaten` heeft geen leerplan-kolom → resultaten zijn leerplan-blind | Datamodel |
| 4 | `lpd_competentie_mapping` heeft geen leerplan-context | Datamodel |
| 5 | `/llinkid/:uuid/koppel` slaat koppeling nog niet op in DB (TODO in code) | Implementatie |
| 6 | `getBksVoorKlas()` fuzzy SQL LIKE → false positives mogelijk | Bug-risico |
| 7 | `seedBkData()` draait enkel als tabel leeg → geen update bij JSON-wijzigingen | Operationeel |

## Probleem meerdere leerplannen

**De realiteit:** Een duaal-leerling volgt meerdere leerplannen:
- Beroepsgericht leerplan (bv. "Binnen- en buitenschrijnwerk")
- PAV (Project Algemene Vakken)
- Eventueel Frans, godsdienst, enz.

**Hoe de app er nu mee omgaat:** Niet. Het datamodel blokkeert dit hard.

**Gevolgen:**
1. Enkel beroepsgericht leerplan wordt bijgehouden — PAV/AV kan niet
2. `berekenBkStats()` werkt enkel op het beroepsgericht leerplan
3. LPDs van PAV/Frans die ook aan BK-competenties zouden bijdragen zijn onmogelijk te modelleren

## Aanbevolen oplossingsrichting

1. Verander `klas_leerplan_mapping` naar een koppeltabel (composiet PK: klas_id + leerplan_uuid)
2. Voeg een `type`-kolom toe (beroepsgericht / AV / vak) voor leerplanclassificatie
3. Voeg `leerplan_uuid` toe aan `lpd_resultaten` voor traceerbaarheid
4. Maak `seedBkData()` idempotent — update bestaande records i.p.v. skip als niet-leeg
5. Vervang fuzzy LIKE door exacte matching of een koppeltabel
