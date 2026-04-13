# Implementatieplan — BK/DPK/LPD Attestering Webapplicatie

> Opgesteld: 2026-04-13
> Gebaseerd op: research-wisa-sync.md, research-leerplan-bk-structuur.md, research-api-damiaaninstituut.md, research-duaal-vs-regulier.md, database-ontwerp-bk-integratie.md

---

## Overzicht

| Fase | Titel | Prioriteit | Complexiteit | Status |
|------|-------|-----------|--------------|--------|
| 1 | WISA Sync veilig maken | HOOGSTE | Medium | Niet gestart |
| 2 | Meerdere leerplannen per klas/leerling | HOOG | Hoog | Niet gestart |
| 3 | Onderwijs Vlaanderen API live integratie | MEDIUM | Hoog | Niet gestart |
| 4 | Code-kwaliteit en performance | LAAG | Medium | Niet gestart |
| 5 | Regulier SO ondersteuning | LAAG | Zeer hoog | Niet gestart |

**Afhankelijkheden:**
- Fase 2 is onafhankelijk van Fase 1 maar moet voor Fase 5 klaar zijn
- Fase 3 is onafhankelijk van alle andere fasen
- Fase 5 bouwt op Fase 1 en Fase 2

---

## Fase 1: WISA Sync veilig maken

**Probleem:** Elke sync verwijdert alle leerlingen en attesteringen via `deleteLeerlingen()` in `lib/database.js:434-440`. Er is geen manier om een leerling te herkennen bij een re-sync — de tabel heeft geen extern ID. Dit maakt de sync destructief en onbruikbaar zodra er attesteringsdata is.

**Betrokken bestanden:**
- `lib/database.js` — syncWisaKlassenLeerlingen(), deleteLeerlingen(), bulkInsertLeerlingen()
- `routes/wisa.js` — POST /wisa/sync
- `lib/wisa.js` — queryKlassenLeerlingen() (bepaalt wat uit WISA terugkomt)
- `views/wisa/sync.ejs` — UI voor synchronisatie
- Database: migratiescript nodig voor `wisa_id`-kolom en `uitgeschreven`-vlag

### Stap 1.1 — Migratie: voeg `wisa_id` toe aan leerlingen

- [ ] Schrijf SQL-migratiescript: voeg `wisa_id VARCHAR(20) DEFAULT NULL` toe aan `leerlingen`
- [ ] Voeg `INDEX idx_leerlingen_wisa_id ON leerlingen(wisa_id)` toe
- [ ] Zorg dat WISA-client het stamboeknummer teruggeeft in query-output (controleer `lib/wisa.js`)
- [ ] Pas `initTables()` in `lib/database.js` aan: voeg `wisa_id` toe aan `CREATE TABLE IF NOT EXISTS leerlingen` en voeg een `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` migratie toe voor bestaande installaties

**Waarom stamboeknummer:** Het stamboeknummer is de stabiele WISA-identifier die niet verandert bij klaswissel. De auto-increment `id` is intern en niet bruikbaar als koppelsleutel.

### Stap 1.2 — Migratie: voeg `uitgeschreven` toe aan leerlingen

- [ ] Voeg kolom `uitgeschreven TINYINT NOT NULL DEFAULT 0` toe aan `leerlingen`
- [ ] Voeg kolom `datum_uitschrijving DATETIME DEFAULT NULL` toe aan `leerlingen`
- [ ] Pas queries aan die leerlingen ophalen: voeg `WHERE uitgeschreven = 0` toe (of maak het instelbaar per view)

### Stap 1.3 — Vervang destructieve sync door upsert-logica

Verwijder `deleteLeerlingen()` uit de sync-flow. Vervang door:

- [ ] Nieuwe methode `upsertLeerling(klasId, wisa_id, naam, voornaam)` in `lib/database.js`:
  - Als `wisa_id` al bestaat in deze klas: update naam/voornaam (stille correctie), zet `uitgeschreven = 0`
  - Als `wisa_id` al bestaat maar in andere klas: update `klas_id` — leerling is van klas veranderd, **attesteringen blijven behouden**
  - Als `wisa_id` niet bestaat: maak nieuw record aan
- [ ] Vervang `bulkInsertLeerlingen()` in `syncWisaKlassenLeerlingen()` door aanroep naar `upsertLeerling()` per leerling
- [ ] Verwijder `deleteLeerlingen()` aanroep volledig uit sync-flow (methode mag blijven voor manuele admin-actie)

**Belangrijk:** De `lpd_resultaten` mogen nooit meer automatisch verwijderd worden bij sync. Dit was het kernprobleem.

### Stap 1.4 — Markeer verdwenen leerlingen als uitgeschreven

- [ ] Na upsert-loop: haal alle `wisa_id`'s op die WISA heeft teruggegeven voor deze klas
- [ ] Markeer leerlingen van die klas die **niet** in de teruggekregen set zitten als `uitgeschreven = 1`, `datum_uitschrijving = NOW()`
- [ ] Verwijder niets — preserveer alle attesteringsdata

### Stap 1.5 — Voeg schooljaar-filter toe aan sync-UI

- [ ] Route `POST /wisa/sync` in `routes/wisa.js`: lees `req.body.schooljaar` uit (naast `werkdatum`)
- [ ] Geef schooljaar mee aan `db.syncWisaKlassenLeerlingen()` — sla klassen op met het juiste schooljaar
- [ ] Valideer dat het schooljaar een redelijke waarde is (huidigSchooljaar ± 1)
- [ ] UI `views/wisa/sync.ejs`: voeg schooljaar-dropdown toe (staat al als `schooljaarOpties` in de route)

### Stap 1.6 — Verbeter UI-waarschuwing

- [ ] Pas confirm-dialog in `views/wisa/sync.ejs` aan: verwijder tekst die suggereert dat data gewist wordt, vervang door: "Dit synchroniseert leerlingen en klassen vanuit WISA. Bestaande attesteringen blijven behouden."
- [ ] Voeg informatieve melding toe na succesvolle sync: hoeveel leerlingen bijgewerkt/nieuw/uitgeschreven

**Complexiteit:** Medium — database-migratie is kritisch, logica is begrijpelijk
**Afhankelijkheden:** Geen — kan als eerste uitgevoerd worden
**Risico's:**
- WISA geeft stamboeknummer mogelijk niet terug in huidige query — verificatie vereist in `lib/wisa.js`
- Bestaande installaties hebben lege `wisa_id` → eerste sync na migratie doet nieuwe inserts, niet upserts (acceptabel eenmalig)

---

## Fase 2: Meerdere leerplannen per klas/leerling

**Probleem:** `klas_leerplan_mapping` heeft `klas_id` als PRIMARY KEY, dus maximaal 1 leerplan per klas. In de realiteit volgt een duale leerling meerdere leerplannen (beroepsgericht + PAV + andere AV-vakken). Het datamodel blokkeert dit architectureel.

**Betrokken bestanden:**
- `lib/database.js` — getKlasLeerplan(), upsertKlasLeerplan(), initTables()
- `routes/attestering.js` — haalt leerplan op via getKlasLeerplan()
- `routes/klassen.js` — beheert klas-leerplan koppelingen
- `routes/llinkid.js` — `/llinkid/:uuid/koppel` (heeft TODO: koppeling opslaan in DB)
- `views/klassen/` — UI voor leerplankoppelingen
- `views/attestering/` — toont LPD's gegroepeerd per leerplan
- Database: destructieve migratie van PK — vereist zorgvuldige aanpak

### Stap 2.1 — Datamodel: transformeer klas_leerplan_mapping naar koppeltabel

- [ ] Maak nieuwe tabel `klas_leerplan_mapping_nieuw` met composiet PK:

```sql
CREATE TABLE klas_leerplan_mapping_nieuw (
  klas_id       INT         NOT NULL,
  leerplan_uuid VARCHAR(36) NOT NULL,
  type          ENUM('beroepsgericht','AV','vak','overig') NOT NULL DEFAULT 'beroepsgericht',
  volgorde      INT         NOT NULL DEFAULT 0,
  PRIMARY KEY (klas_id, leerplan_uuid),
  FOREIGN KEY (klas_id) REFERENCES klassen(id) ON DELETE CASCADE
) CHARACTER SET utf8mb4;
```

- [ ] Migreer bestaande data: `INSERT INTO klas_leerplan_mapping_nieuw SELECT klas_id, leerplan_uuid, 'beroepsgericht', 0 FROM klas_leerplan_mapping`
- [ ] Hernoem tabellen: `klas_leerplan_mapping` → `klas_leerplan_mapping_oud`, `klas_leerplan_mapping_nieuw` → `klas_leerplan_mapping`
- [ ] Verwijder oude tabel na verificatie

**Let op:** Dit is een breaking change voor alle queries die `klas_leerplan_mapping` gebruiken. Fase 2.2 t/m 2.4 zijn afhankelijk van deze stap.

### Stap 2.2 — Voeg leerplan_uuid toe aan lpd_resultaten

- [ ] Voeg kolom `leerplan_uuid VARCHAR(36) DEFAULT NULL` toe aan `lpd_resultaten`
- [ ] Voeg index toe: `INDEX idx_lpd_resultaten_leerplan ON lpd_resultaten(leerplan_uuid)`
- [ ] Bestaande resultaten: laat `leerplan_uuid` NULL voor historische data (acceptabel)
- [ ] Pas `toggleLpd()` in `lib/database.js` aan: accepteer optionele `leerplanUuid` parameter

**Waarom:** Zonder leerplan-context is het onmogelijk te weten of een LPD-resultaat bij het beroepsgerichte leerplan of bij PAV hoort. Dit is nodig voor correcte BK-berekeningen (alleen beroepsgericht telt mee voor BK).

### Stap 2.3 — Pas database-methoden aan

- [ ] `getKlasLeerplan(klasId)` → verwijder of hernoem naar `getKlasLeerplannen(klasId)` — geeft array terug
- [ ] `getKlasBeroepsgerichtLeerplan(klasId)` — geeft het leerplan van type 'beroepsgericht' terug (achterwaartse compatibiliteit voor BK-berekeningen)
- [ ] `upsertKlasLeerplan(klasId, leerplanUuid, type, volgorde)` — voeg `type` en `volgorde` parameters toe
- [ ] `verwijderKlasLeerplan(klasId, leerplanUuid)` — verwijder specifieke koppeling (niet alle)

### Stap 2.4 — Pas attestering-route aan

In `routes/attestering.js`:
- [ ] Vervang `getKlasLeerplan()` door `getKlasLeerplannen()`
- [ ] Laad LPD's voor **elk** leerplan van de klas, gegroepeerd
- [ ] Geef `leerplanUuid` mee bij `toggleLpd()` aanroepen
- [ ] Zorg dat BK-berekeningen enkel het beroepsgericht leerplan gebruiken

### Stap 2.5 — Pas LLinkid-koppelroute af

In `routes/llinkid.js`, de route `/llinkid/:uuid/koppel`:
- [ ] Los de bestaande TODO op: sla koppeling effectief op in DB via `upsertKlasLeerplan()`
- [ ] Voeg `type`-parameter toe aan koppelformulier: gebruiker kan aangeven of het beroepsgericht, AV of een vak is

### Stap 2.6 — Pas UI aan voor meerdere leerplannen

In `views/klassen/` en `views/attestering/`:
- [ ] Klas-detailpagina: toon lijst van gekoppelde leerplannen met type en volgorde
- [ ] Voeg UI toe om leerplan te koppelen met type-keuze
- [ ] Attestering-view: groepeer LPD-checkboxen per leerplan (tabbladen of secties)

**Complexiteit:** Hoog — datamodel-migratie met breaking changes, veel afhankelijke code
**Afhankelijkheden:** Geen harde afhankelijkheid van Fase 1, maar doe Fase 1 eerst om syncproblemen te vermijden tijdens de migratie
**Risico's:**
- Migratie van PK vereist downtime of transactionele aanpak
- Bestaande attestering-routes kunnen breken als `getKlasLeerplan()` array teruggeeft i.p.v. string

---

## Fase 3: Onderwijs Vlaanderen API live integratie

**Probleem:** BK-data (`beroepskwalificaties`, `deelberoepskwalificaties`, `bk_competentiecomponenten`) wordt gevuld via `seedBkData()` op basis van een statische JSON. Dit seed-script draait enkel als de tabel leeg is — er is geen update-mechanisme. Nieuwe BK's of wijzigingen in de officiële API worden nooit opgepikt.

**Betrokken bestanden:**
- `lib/bk-api.js` — nieuwe module (aanmaken)
- `lib/database.js` — seedBkData(), BK-gerelateerde queries
- `routes/admin.js` — admin-interface voor BK-beheer
- `routes/bk.js` — BK-overzichtsroutes
- `lib/bk-stats.js` — BK-statistieken
- `views/admin/` — UI voor BK-sync
- `richting_bk_mapping.json` — huidige statische bron

### Stap 3.1 — Bouw API-client voor Onderwijs Vlaanderen

Maak nieuw bestand `lib/bk-api.js`:

- [ ] Implementeer `getOpleidingstrajecten(instellingNr)` — haalt alle trajecten op voor instelling 147637 (Damiaaninstituut B en C)
- [ ] Implementeer `getTrajectDetail(trajectId)` — haalt competenties/vaardigheden per BK op
- [ ] Implementeer `getBeroepskwalificaties()` — haalt BK-catalogus op (Beroepskwalificaties 2.0 API)
- [ ] Gebruik native `fetch` (Node 18+) — geen externe dependencies
- [ ] Voeg timeout en foutafhandeling toe (netwerk kan onbereikbaar zijn)
- [ ] Documenteer de API-endpoints in JSDoc (zie research-api-damiaaninstituut.md voor structuur)

### Stap 3.2 — Bouw lokale cache met TTL

In `lib/bk-api.js` of aparte `lib/bk-cache.js`:

- [ ] Sla API-responses op in de database met `datum_import` en `geldig_tot`
- [ ] TTL-logica: als `datum_import` ouder is dan 24 uur, herlaad vanuit API
- [ ] Fallback: als API onbereikbaar is, gebruik gecachte data (ook al is TTL verlopen)
- [ ] Voeg kolom `geldig_tot DATETIME` toe aan `beroepskwalificaties`-tabel voor TTL-tracking

### Stap 3.3 — Maak seedBkData() idempotent

In `lib/database.js`:

- [ ] Vervang huidige check "alleen seeden als tabel leeg" door volwaardige upsert-logica
- [ ] Gebruik `INSERT ... ON DUPLICATE KEY UPDATE` voor `beroepskwalificaties` (unieke sleutel op `code`)
- [ ] Idem voor `deelberoepskwalificaties` (unieke sleutel op `code`)
- [ ] Idem voor `bk_competentiecomponenten` (unieke sleutel op `code`)
- [ ] Voeg logging toe: hoeveel records ingevoegd/bijgewerkt/ongewijzigd

### Stap 3.4 — Vervang seedBkData() door liveSyncBkData()

- [ ] Maak nieuwe methode `liveSyncBkData(instellingNr)` in `lib/database.js` (of als aparte service)
- [ ] Aanroepvolgorde: API ophalen → valideren → upsert in DB → log resultaat
- [ ] Behoud `seedBkData()` als fallback voor offline/test-gebruik
- [ ] Verwijder of archiveer `richting_bk_mapping.json` zodra live sync betrouwbaar werkt (wacht op productietesting)

### Stap 3.5 — Admin-interface voor BK-sync

In `routes/admin.js` en `views/admin/`:

- [ ] Voeg route `POST /admin/bk/sync` toe: triggert `liveSyncBkData()`
- [ ] Toon resultaat: hoeveel BK's gesynchroniseerd, timestamp laatste sync
- [ ] Voeg "Laatste sync" status toe aan admin-dashboard
- [ ] Voeg cron-achtige auto-sync toe via `setInterval` bij opstart (optioneel, 1x per dag)

**Complexiteit:** Hoog — externe API-integratie, cache-logica, idempotente upserts
**Afhankelijkheden:** Geen — kan parallel met Fase 1 en 2 worden uitgevoerd
**Risico's:**
- Onderwijs Vlaanderen API kan van structuur veranderen — bouw robuuste validatie in
- Instelling 147637 is Damiaaninstituut-specifiek — maak instellingsnummer configureerbaar in `config.json` of omgevingsvariabele
- API kan traag zijn (~57 trajecten ophalen) — doe sync op achtergrond, niet in request-lifecycle

---

## Fase 4: Code-kwaliteit en performance

**Probleem:** Uit de codebase-structuur zijn typische knelpunten te verwachten: inline stijlen in EJS-templates, gedupliceerde query-logica in routes, ontbrekend centraal CSS-systeem, en geen gestandaardiseerde foutafhandeling.

> Concrete details volgen uit een volwaardige code-audit. Deze fase zet de structuur klaar.

**Betrokken bestanden:** Alle bestanden — dit is een horizontale fase

### Stap 4.1 — Code-audit uitvoeren

- [ ] Scan alle `views/**/*.ejs` op inline `style=`-attributen — inventariseer
- [ ] Scan alle `routes/*.js` op gedupliceerde query-patronen — inventariseer
- [ ] Controleer `public/` op CSS-organisatie: is er een centraal stylesheet of gefragmenteerd?
- [ ] Inventariseer alle `console.log`-statements die in productie staan
- [ ] Check alle routes op ontbrekende `try/catch` rondom `await`-calls

### Stap 4.2 — Centraal CSS-systeem

- [ ] Maak `public/css/components/` map aan met losse component-bestanden (cards, tables, badges, forms)
- [ ] Verplaats inline stijlen uit EJS naar CSS-klassen
- [ ] Definieer CSS-variabelen voor kleuren en spacing in `public/css/variables.css`

### Stap 4.3 — Query-logica consolideren

- [ ] Identificeer gedupliceerde SQL-patronen in routes (bv. leerling ophalen + klas join)
- [ ] Verplaats naar `lib/database.js` als herbruikbare methoden
- [ ] Routes mogen enkel HTTP-logica bevatten — geen SQL inline

### Stap 4.4 — Foutafhandeling standaardiseren

- [ ] Alle `async`-route-handlers: wrap in `try/catch`, stuur consistent JSON-fout of redirect naar error-pagina
- [ ] Centrale error-middleware in `server.js` — controleer of deze al bestaat en volledig is
- [ ] Verwijder `console.log` in productiepad, vervang door gestructureerd logging (bv. prefix met timestamp en route)

### Stap 4.5 — Performance: N+1 queries aanpakken

- [ ] Identificeer routes die per leerling een aparte query doen in een loop
- [ ] Vervang door bulk-queries met `IN (?)` of `JOIN`
- [ ] Relevante kandidaten: attestering-overzicht per klas, BK-statistieken per leerling

**Complexiteit:** Medium — geen functionele wijzigingen, maar brede impact
**Afhankelijkheden:** Doe na Fase 1 en 2 — anders wordt bijgewerkte code direct opnieuw verbeterd
**Risico's:** Laag — refactoring zonder gedragswijziging

---

## Fase 5: Regulier SO ondersteuning

**Probleem:** De volledige app is gebouwd rondom de BK/DPK-workflow van duaal leren. Regulier SO (ASO/TSO/BSO) werkt fundamenteel anders: geen BK's, oriënteringsattesten A/B/C, 6-12 leerplannen per leerling, enkel leerkrachten (geen werkplekmentor).

**Betrokken bestanden:** Vrijwel alle bestanden — dit is de grootste uitbreiding

### Stap 5.1 — Voeg onderwijsvorm-concept toe

In `lib/database.js` en datamodel:

- [ ] Voeg kolom `onderwijsvorm ENUM('duaal','regulier','onbekend') NOT NULL DEFAULT 'onbekend'` toe aan `klassen`
- [ ] Voeg kolom `finaliteit ENUM('arbeidsmarkt','doorstroom','dubbel','onbekend') DEFAULT 'onbekend'` toe aan `klassen`
- [ ] Pas `syncWisaKlassenLeerlingen()` aan: detecteer onderwijsvorm op basis van richting/leerweg-code uit WISA (code `D` = duaal, `V` = voltijds regulier)
- [ ] Voeg admin-UI toe om onderwijsvorm manueel te corrigeren per klas

### Stap 5.2 — Automatische detectie op basis van klas/richting

- [ ] Bouw detectie-functie `detecteerOnderwijsvorm(richtingNaam, leerwegCode)`:
  - Leerweg `D` → duaal
  - Leerweg `V` + finaliteit arbeidsmarkt → regulier BSO
  - Leerweg `V` + finaliteit doorstroom/dubbel → regulier ASO/TSO
- [ ] Pas WISA-sync aan om `leerwegCode` op te halen uit WISA-data (controleer of dit beschikbaar is in `lib/wisa.js`)
- [ ] Fallback: als onbekend, toon klas als "onbekend" in UI met manuele correcieoptie

### Stap 5.3 — Datamodel: oriënteringsattesten

- [ ] Maak nieuwe tabel `vak_attestering`:

```sql
CREATE TABLE IF NOT EXISTS vak_attestering (
  id              INT          PRIMARY KEY AUTO_INCREMENT,
  leerling_id     INT          NOT NULL,
  leerplan_uuid   VARCHAR(36)  NOT NULL,
  attest          ENUM('A','B','C','uitgesteld','nvt') NOT NULL DEFAULT 'nvt',
  opmerking       TEXT         DEFAULT NULL,
  datum_gewijzigd DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (leerling_id) REFERENCES leerlingen(id) ON DELETE CASCADE,
  UNIQUE KEY uq_ll_leerplan (leerling_id, leerplan_uuid)
) CHARACTER SET utf8mb4;
```

- [ ] Voeg methoden toe in `lib/database.js`: `getVakAttestatering(leerlingId)`, `setVakAttest(leerlingId, leerplanUuid, attest, opmerking)`

### Stap 5.4 — Aparte attestering-flow voor regulier SO

In `routes/attestering.js`:

- [ ] Detecteer bij laden van attesteringspagina: is de klas duaal of regulier?
- [ ] Duaal: huidige BK/DPK/LPD-workflow — ongewijzigd
- [ ] Regulier: laad alle leerplannen van de klas (na Fase 2), toon per vak een A/B/C-attest-keuze
- [ ] LPD-checkboxen blijven beschikbaar voor regulier als optionele detailregistratie

### Stap 5.5 — Pas UI aan voor onderwijsvorm

In `views/attestering/` en `views/klassen/`:

- [ ] Toon badge "Duaal" of "Regulier" bij klas-naam
- [ ] Regulier-view: kaartjes per vak/leerplan met groot A/B/C-knoppen (simpel en snel)
- [ ] Duaal-view: huidige LPD-checkboxen met BK-voortgangsbalk — ongewijzigd
- [ ] Klasoverzicht: filter op onderwijsvorm

### Stap 5.6 — Export aanpassen voor regulier

In `routes/export.js` en `lib/export.js`:

- [ ] Voeg export-optie toe voor oriënteringsattesten (per klas, per leerling, per vak)
- [ ] Formaat: tabel leerling × vak met A/B/C-waarden
- [ ] Duaal-export ongewijzigd

**Complexiteit:** Zeer hoog — nieuwe workflow, nieuw datamodel, nieuwe UI, impact op vrijwel alle modules
**Afhankelijkheden:**
- Fase 1 moet klaar zijn (stabiele sync)
- Fase 2 moet klaar zijn (meerdere leerplannen per klas)
**Risico's:**
- WISA geeft mogelijk geen `leerwegCode` terug — manuele invoer als fallback
- LLinkid-leerplannen voor regulier SO hebben andere structuur dan duale leerplannen — verificatie nodig
- Grote scope: overweeg op te splitsen in Fase 5a (datamodel + detectie) en Fase 5b (UI + export)

---

## Migratiestrategie

Elke fase die het datamodel wijzigt heeft een migratiescript nodig. Gebruik het bestaande patroon in `lib/database.js` van `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` met `.catch(() => {})` voor idempotente migraties bij herstart.

**Volgorde voor productie-uitrol:**
1. Maak een databasebackup vóór elke fase
2. Voer migratiescript uit op testomgeving
3. Valideer data-integriteit na migratie
4. Uitrol op productie buiten schooluren

---

## Niet in scope

- Werkplek-portal (aparte login voor werkplekmentoren) — apart project
- Mobiele app — buiten scope
- Integratie met andere schoolbeheersystemen dan WISA
- Automatische BK-berekening op basis van werkplekcomponent (complex domeinlogica)
