# Database-ontwerp: Officiele BK-integratie in Tinneke

## Huidige situatie

De webapplicatie kent momenteel **geen eigen BK-structuur**. De BK/DPK-hierarchie
wordt volledig afgeleid uit de LLinkid API (secties in het leerplan). Dit werkt,
maar heeft beperkingen:

1. LLinkid-secties zijn **leerplan**-structuur, niet de officiele **BK**-structuur
2. Er is geen officiele BK-code, BK-naam of niveau vastgelegd
3. De mapping richting -> BK ontbreekt
4. Export van een "Bewijs van beroepskwalificatie" is onmogelijk zonder officiele BK-data
5. Deelberoepskwalificaties (DBK) als tussenlaag bestaan niet

### Bestaande tabellen (blijven ongewijzigd)

```
klassen              (id, naam, richting, schooljaar, laatste_sync)
leerlingen           (id, naam, voornaam, klas_id)
lpd_resultaten       (id, leerling_id, lpd_uuid, behaald, datum_gewijzigd)
klas_leerplan_mapping (klas_id, leerplan_uuid)
richting_leerplan    (id, richting, leerplan_uuid, identifier, graad)
users                (id, username, password, naam, rol, actief, aangemaakt)
```

De tabel `lpd_resultaten` blijft het hart van het systeem: leerkrachten vinken
individuele LPD-doelen af. De BK-laag bouwt daar **bovenop**.

---

## Nieuwe tabellen

### 1. `beroepskwalificaties` -- officiele BK-referentiedata

Bevat de officiele beroepskwalificaties van Onderwijs Vlaanderen.

```sql
CREATE TABLE IF NOT EXISTS beroepskwalificaties (
  id          INT          PRIMARY KEY AUTO_INCREMENT,
  code        VARCHAR(20)  NOT NULL UNIQUE,       -- 'BK-0038'
  naam        VARCHAR(500) NOT NULL,               -- 'Medewerker houtbewerking'
  niveau      INT          NOT NULL DEFAULT 0,     -- EQF/VKS niveau (2-7)
  bron        VARCHAR(50)  NOT NULL DEFAULT 'onderwijs_vlaanderen',
  datum_import DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP
) CHARACTER SET utf8mb4;

CREATE INDEX idx_bk_code ON beroepskwalificaties(code);
```

### 2. `deelberoepskwalificaties` -- DBK als tussenlaag

Elke BK bestaat uit een of meer deelberoepskwalificaties.

```sql
CREATE TABLE IF NOT EXISTS deelberoepskwalificaties (
  id      INT          PRIMARY KEY AUTO_INCREMENT,
  code    VARCHAR(50)  NOT NULL UNIQUE,            -- 'DBK-0038-01'
  naam    VARCHAR(500) NOT NULL,                    -- 'Basisbewerkingen hout'
  bk_id   INT          NOT NULL,
  FOREIGN KEY (bk_id) REFERENCES beroepskwalificaties(id) ON DELETE CASCADE
) CHARACTER SET utf8mb4;

CREATE INDEX idx_dbk_bk ON deelberoepskwalificaties(bk_id);
```

### 3. `bk_competentiecomponenten` -- onderdelen van een BK/DBK

De officiele competentiecomponenten (kennis, vaardigheden, context) die bij
een BK/DBK horen. Dit zijn de "meetbare eenheden" van de BK.

```sql
CREATE TABLE IF NOT EXISTS bk_competentiecomponenten (
  id          INT           PRIMARY KEY AUTO_INCREMENT,
  code        VARCHAR(50)   NOT NULL UNIQUE,       -- 'CC-0038-01-K1'
  omschrijving TEXT          NOT NULL,
  type        ENUM('kennis', 'vaardigheid', 'context', 'attitude', 'anders')
              NOT NULL DEFAULT 'anders',
  dbk_id      INT           DEFAULT NULL,          -- NULL = rechtstreeks op BK
  bk_id       INT           NOT NULL,              -- altijd ingevuld
  FOREIGN KEY (dbk_id) REFERENCES deelberoepskwalificaties(id) ON DELETE CASCADE,
  FOREIGN KEY (bk_id)  REFERENCES beroepskwalificaties(id)     ON DELETE CASCADE
) CHARACTER SET utf8mb4;

CREATE INDEX idx_cc_dbk ON bk_competentiecomponenten(dbk_id);
CREATE INDEX idx_cc_bk  ON bk_competentiecomponenten(bk_id);
```

### 4. `richting_bk` -- mapping studierichting naar officiele BK('s)

Vervangt de huidige hardcoded `klas_bk_mapping.json`. Een studierichting
kan naar meerdere BK's leiden (bijv. "Binnen- en buitenschrijnwerk" levert
zowel BK-0038 als BK-0041 op).

```sql
CREATE TABLE IF NOT EXISTS richting_bk (
  id          INT          PRIMARY KEY AUTO_INCREMENT,
  richting    VARCHAR(255) NOT NULL,
  bk_id       INT          NOT NULL,
  verplicht   TINYINT      NOT NULL DEFAULT 1,     -- 1 = verplicht, 0 = optioneel
  FOREIGN KEY (bk_id) REFERENCES beroepskwalificaties(id) ON DELETE CASCADE,
  UNIQUE KEY uq_richting_bk (richting, bk_id)
) CHARACTER SET utf8mb4;

CREATE INDEX idx_rb_richting ON richting_bk(richting);
```

### 5. `lpd_competentie_mapping` -- de kernkoppeling LPD <-> BK

Dit is de cruciale brug: welke LPD-doelen (uit LLinkid) dragen bij aan welke
competentiecomponent van een BK. Eenzelfde LPD kan bijdragen aan meerdere
competentiecomponenten (many-to-many).

```sql
CREATE TABLE IF NOT EXISTS lpd_competentie_mapping (
  id              INT         PRIMARY KEY AUTO_INCREMENT,
  lpd_uuid        VARCHAR(36) NOT NULL,            -- UUID uit LLinkid
  competentie_id  INT         NOT NULL,
  gewicht         DECIMAL(3,2) NOT NULL DEFAULT 1.00, -- relatief gewicht (1.00 = standaard)
  FOREIGN KEY (competentie_id) REFERENCES bk_competentiecomponenten(id) ON DELETE CASCADE,
  UNIQUE KEY uq_lpd_cc (lpd_uuid, competentie_id)
) CHARACTER SET utf8mb4;

CREATE INDEX idx_lcm_lpd  ON lpd_competentie_mapping(lpd_uuid);
CREATE INDEX idx_lcm_cc   ON lpd_competentie_mapping(competentie_id);
```

### 6. `bk_attestering` -- per-leerling BK-status (berekend of overschreven)

Slaat het eindresultaat per leerling per BK op. Wordt automatisch berekend
op basis van `lpd_resultaten` + `lpd_competentie_mapping`, maar kan door
een admin handmatig overschreven worden.

```sql
CREATE TABLE IF NOT EXISTS bk_attestering (
  id              INT          PRIMARY KEY AUTO_INCREMENT,
  leerling_id     INT          NOT NULL,
  bk_id           INT          NOT NULL,
  percentage      INT          NOT NULL DEFAULT 0,  -- berekend percentage
  status          ENUM('niet_gestart', 'bezig', 'behaald', 'overschreven')
                  NOT NULL DEFAULT 'niet_gestart',
  handmatig       TINYINT      NOT NULL DEFAULT 0,  -- 1 = admin override
  opmerking       TEXT         DEFAULT NULL,
  datum_gewijzigd DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (leerling_id) REFERENCES leerlingen(id) ON DELETE CASCADE,
  FOREIGN KEY (bk_id)       REFERENCES beroepskwalificaties(id) ON DELETE CASCADE,
  UNIQUE KEY uq_ll_bk (leerling_id, bk_id)
) CHARACTER SET utf8mb4;

CREATE INDEX idx_ba_leerling ON bk_attestering(leerling_id);
CREATE INDEX idx_ba_bk       ON bk_attestering(bk_id);
```

### 7. `dbk_attestering` -- per-leerling DBK-status (tussenlaag)

Zelfde principe als `bk_attestering` maar op DBK-niveau.

```sql
CREATE TABLE IF NOT EXISTS dbk_attestering (
  id              INT          PRIMARY KEY AUTO_INCREMENT,
  leerling_id     INT          NOT NULL,
  dbk_id          INT          NOT NULL,
  percentage      INT          NOT NULL DEFAULT 0,
  status          ENUM('niet_gestart', 'bezig', 'behaald', 'overschreven')
                  NOT NULL DEFAULT 'niet_gestart',
  handmatig       TINYINT      NOT NULL DEFAULT 0,
  opmerking       TEXT         DEFAULT NULL,
  datum_gewijzigd DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (leerling_id) REFERENCES leerlingen(id)              ON DELETE CASCADE,
  FOREIGN KEY (dbk_id)      REFERENCES deelberoepskwalificaties(id) ON DELETE CASCADE,
  UNIQUE KEY uq_ll_dbk (leerling_id, dbk_id)
) CHARACTER SET utf8mb4;

CREATE INDEX idx_da_leerling ON dbk_attestering(leerling_id);
CREATE INDEX idx_da_dbk      ON dbk_attestering(dbk_id);
```

---

## Volledige migratie-SQL

Onderstaand script kan als migratie uitgevoerd worden op een bestaande database.
Alle statements zijn `IF NOT EXISTS`, dus veilig om opnieuw te draaien.

```sql
-- ============================================================
-- Migratie: BK-integratie
-- Datum: 2026-04-03
-- ============================================================

-- 1. Referentiedata: officiele BK-structuur
CREATE TABLE IF NOT EXISTS beroepskwalificaties (
  id           INT          PRIMARY KEY AUTO_INCREMENT,
  code         VARCHAR(20)  NOT NULL UNIQUE,
  naam         VARCHAR(500) NOT NULL,
  niveau       INT          NOT NULL DEFAULT 0,
  bron         VARCHAR(50)  NOT NULL DEFAULT 'onderwijs_vlaanderen',
  datum_import DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP
) CHARACTER SET utf8mb4;

CREATE TABLE IF NOT EXISTS deelberoepskwalificaties (
  id    INT          PRIMARY KEY AUTO_INCREMENT,
  code  VARCHAR(50)  NOT NULL UNIQUE,
  naam  VARCHAR(500) NOT NULL,
  bk_id INT          NOT NULL,
  FOREIGN KEY (bk_id) REFERENCES beroepskwalificaties(id) ON DELETE CASCADE
) CHARACTER SET utf8mb4;

CREATE TABLE IF NOT EXISTS bk_competentiecomponenten (
  id           INT           PRIMARY KEY AUTO_INCREMENT,
  code         VARCHAR(50)   NOT NULL UNIQUE,
  omschrijving TEXT          NOT NULL,
  type         ENUM('kennis', 'vaardigheid', 'context', 'attitude', 'anders')
               NOT NULL DEFAULT 'anders',
  dbk_id       INT           DEFAULT NULL,
  bk_id        INT           NOT NULL,
  FOREIGN KEY (dbk_id) REFERENCES deelberoepskwalificaties(id) ON DELETE CASCADE,
  FOREIGN KEY (bk_id)  REFERENCES beroepskwalificaties(id)     ON DELETE CASCADE
) CHARACTER SET utf8mb4;

-- 2. Mappings
CREATE TABLE IF NOT EXISTS richting_bk (
  id        INT          PRIMARY KEY AUTO_INCREMENT,
  richting  VARCHAR(255) NOT NULL,
  bk_id     INT          NOT NULL,
  verplicht TINYINT      NOT NULL DEFAULT 1,
  FOREIGN KEY (bk_id) REFERENCES beroepskwalificaties(id) ON DELETE CASCADE,
  UNIQUE KEY uq_richting_bk (richting, bk_id)
) CHARACTER SET utf8mb4;

CREATE TABLE IF NOT EXISTS lpd_competentie_mapping (
  id             INT          PRIMARY KEY AUTO_INCREMENT,
  lpd_uuid       VARCHAR(36)  NOT NULL,
  competentie_id INT          NOT NULL,
  gewicht        DECIMAL(3,2) NOT NULL DEFAULT 1.00,
  FOREIGN KEY (competentie_id) REFERENCES bk_competentiecomponenten(id) ON DELETE CASCADE,
  UNIQUE KEY uq_lpd_cc (lpd_uuid, competentie_id)
) CHARACTER SET utf8mb4;

-- 3. Attesteringsresultaten per leerling
CREATE TABLE IF NOT EXISTS bk_attestering (
  id              INT      PRIMARY KEY AUTO_INCREMENT,
  leerling_id     INT      NOT NULL,
  bk_id           INT      NOT NULL,
  percentage      INT      NOT NULL DEFAULT 0,
  status          ENUM('niet_gestart', 'bezig', 'behaald', 'overschreven')
                  NOT NULL DEFAULT 'niet_gestart',
  handmatig       TINYINT  NOT NULL DEFAULT 0,
  opmerking       TEXT     DEFAULT NULL,
  datum_gewijzigd DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (leerling_id) REFERENCES leerlingen(id) ON DELETE CASCADE,
  FOREIGN KEY (bk_id)       REFERENCES beroepskwalificaties(id) ON DELETE CASCADE,
  UNIQUE KEY uq_ll_bk (leerling_id, bk_id)
) CHARACTER SET utf8mb4;

CREATE TABLE IF NOT EXISTS dbk_attestering (
  id              INT      PRIMARY KEY AUTO_INCREMENT,
  leerling_id     INT      NOT NULL,
  dbk_id          INT      NOT NULL,
  percentage      INT      NOT NULL DEFAULT 0,
  status          ENUM('niet_gestart', 'bezig', 'behaald', 'overschreven')
                  NOT NULL DEFAULT 'niet_gestart',
  handmatig       TINYINT  NOT NULL DEFAULT 0,
  opmerking       TEXT     DEFAULT NULL,
  datum_gewijzigd DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (leerling_id) REFERENCES leerlingen(id)              ON DELETE CASCADE,
  FOREIGN KEY (dbk_id)      REFERENCES deelberoepskwalificaties(id) ON DELETE CASCADE,
  UNIQUE KEY uq_ll_dbk (leerling_id, dbk_id)
) CHARACTER SET utf8mb4;

-- 4. Indexen
CREATE INDEX IF NOT EXISTS idx_bk_code     ON beroepskwalificaties(code);
CREATE INDEX IF NOT EXISTS idx_dbk_bk      ON deelberoepskwalificaties(bk_id);
CREATE INDEX IF NOT EXISTS idx_cc_dbk      ON bk_competentiecomponenten(dbk_id);
CREATE INDEX IF NOT EXISTS idx_cc_bk       ON bk_competentiecomponenten(bk_id);
CREATE INDEX IF NOT EXISTS idx_rb_richting  ON richting_bk(richting);
CREATE INDEX IF NOT EXISTS idx_lcm_lpd     ON lpd_competentie_mapping(lpd_uuid);
CREATE INDEX IF NOT EXISTS idx_lcm_cc      ON lpd_competentie_mapping(competentie_id);
CREATE INDEX IF NOT EXISTS idx_ba_leerling ON bk_attestering(leerling_id);
CREATE INDEX IF NOT EXISTS idx_ba_bk       ON bk_attestering(bk_id);
CREATE INDEX IF NOT EXISTS idx_da_leerling ON dbk_attestering(leerling_id);
CREATE INDEX IF NOT EXISTS idx_da_dbk      ON dbk_attestering(dbk_id);
```

---

## Hoe de twee systemen naast elkaar werken

### Dataflow: bottom-up (bestaand) + top-down (nieuw)

```
BOTTOM-UP (leerkracht-workflow, ongewijzigd):
  Leerkracht vinkt LPD af
    -> lpd_resultaten.behaald = 1
    -> UI toont percentage per LLinkid-sectie (via stats.js)

TOP-DOWN (nieuw, BK-berekening):
  lpd_resultaten (behaald=1)
    + lpd_competentie_mapping (welke LPD hoort bij welke competentie)
    -> bk_competentiecomponenten (welke competenties zijn gedekt)
    -> deelberoepskwalificaties (DBK volledig als alle competenties gedekt)
    -> beroepskwalificaties (BK behaald als alle DBK's behaald)
    -> bk_attestering / dbk_attestering (resultaat opgeslagen)
```

### Berekeningslogica (pseudocode)

```javascript
async function herbereken_bk_status(leerling_id, bk_id) {
  // 1. Haal alle competentiecomponenten op voor deze BK
  const componenten = await db.query(`
    SELECT cc.id, cc.dbk_id
    FROM bk_competentiecomponenten cc
    WHERE cc.bk_id = ?
  `, [bk_id]);

  // 2. Per component: check of alle gemapte LPD's behaald zijn
  for (const cc of componenten) {
    const mappings = await db.query(`
      SELECT m.lpd_uuid, COALESCE(r.behaald, 0) AS behaald
      FROM lpd_competentie_mapping m
      LEFT JOIN lpd_resultaten r
        ON r.lpd_uuid = m.lpd_uuid AND r.leerling_id = ?
      WHERE m.competentie_id = ?
    `, [leerling_id, cc.id]);

    cc.totaal  = mappings.length;
    cc.behaald = mappings.filter(m => m.behaald).length;
  }

  // 3. Groepeer per DBK en bereken percentage
  // ... (aggregatie naar dbk_attestering en bk_attestering)
}
```

### Wanneer herberekenen?

De herberekening hoeft niet real-time. Mogelijke triggers:

1. **Bij openen attestering-pagina** -- herbereken voor zichtbare leerling
2. **Bij export** -- herbereken alle leerlingen van de klas
3. **Batch-job** -- periodiek (bijv. 's nachts) voor alle leerlingen

De bestaande `berekenStats()` in `stats.js` blijft werken voor de LLinkid-view.
De BK-view gebruikt een aparte berekeningsfunctie die de mapping-tabellen raadpleegt.

---

## De mapping LPD -> BK competentie

Dit is het moeilijkste onderdeel. Er zijn drie mogelijke strategien:

### Strategie A: Handmatige mapping (aanbevolen voor start)

Een admin koppelt in de UI individuele LPD-doelen aan competentiecomponenten.
Dit is arbeidsintensief maar geeft de meeste controle.

**UI-workflow:**
1. Admin selecteert een BK (bijv. BK-0038)
2. Systeem toont de competentiecomponenten van die BK
3. Per component toont het systeem de LPD-doelen uit het gekoppelde leerplan
4. Admin vinkt aan welke LPD's bij welke component horen
5. Mapping wordt opgeslagen in `lpd_competentie_mapping`

### Strategie B: Conventie-gebaseerd (LLinkid-secties = DBK)

Gebruik de bestaande LLinkid-sectiestructuur als proxy voor DBK's.
De secties in een LLinkid-leerplan komen vaak al overeen met de
deelberoepskwalificaties (dat is hoe de leerplanmakers ze opbouwen).

**Voordeel:** Geen handmatige mapping nodig.
**Nadeel:** Niet 100% accuraat; LLinkid-structuur kan afwijken van officiele BK.

### Strategie C: Hybride (aanbevolen voor productie)

Start met strategie B (automatische mapping op basis van LLinkid-secties),
maar laat admins de mapping aanpassen waar nodig. Sla de mapping altijd
expliciet op in `lpd_competentie_mapping`, ook als die automatisch is
gegenereerd.

---

## Seed-data: `richting_bk` vullen vanuit bestaande JSON

De huidige `klas_bk_mapping.json` kan omgezet worden naar `richting_bk` records.
Hiervoor moet eerst de `beroepskwalificaties` tabel gevuld zijn.

```javascript
async function seedRichtingBk(db, klasBkMapping, richtingLeerplanMapping) {
  // Combineer: klas -> richting (via klassen-tabel) -> BK-codes
  // Of gebruik de richting_leerplan mapping als brug
  for (const [klasCode, bkCodes] of Object.entries(klasBkMapping)) {
    if (klasCode.startsWith('_')) continue;
    for (const bkCode of bkCodes) {
      // Zoek de richting bij deze klascode
      // Insert in richting_bk als die combinatie nog niet bestaat
      await db.query(`
        INSERT IGNORE INTO richting_bk (richting, bk_id, verplicht)
        SELECT k.richting, bk.id, 1
        FROM klassen k
        CROSS JOIN beroepskwalificaties bk
        WHERE k.naam = ? AND bk.code = ?
        LIMIT 1
      `, [klasCode, bkCode]);
    }
  }
}
```

---

## Export: Bewijs van beroepskwalificatie

Met de nieuwe structuur kan een officieel bewijs gegenereerd worden:

```
BEWIJS VAN BEROEPSKWALIFICATIE

Leerling:    Jan Janssens
Richting:    Binnen- en buitenschrijnwerk
Schooljaar:  2025-2026

Beroepskwalificatie: BK-0038 - Medewerker houtbewerking (niveau 2)
Status: BEHAALD (100%)

  Deelberoepskwalificatie: DBK-0038-01 - Basisbewerkingen hout
  Status: BEHAALD (100%)
    [x] CC-0038-01-K1: Kent de eigenschappen van houtsoorten
    [x] CC-0038-01-V1: Kan hout manueel bewerken
    ...

  Deelberoepskwalificatie: DBK-0038-02 - Machinale houtbewerking
  Status: BEHAALD (100%)
    [x] CC-0038-02-K1: Kent de werking van houtverwerkingsmachines
    ...
```

De export-query combineert alle lagen:

```sql
SELECT
  bk.code    AS bk_code,
  bk.naam    AS bk_naam,
  bk.niveau  AS bk_niveau,
  ba.status  AS bk_status,
  ba.percentage AS bk_percentage,
  dbk.code   AS dbk_code,
  dbk.naam   AS dbk_naam,
  da.status  AS dbk_status,
  da.percentage AS dbk_percentage,
  cc.code    AS cc_code,
  cc.omschrijving AS cc_omschrijving,
  cc.type    AS cc_type
FROM bk_attestering ba
JOIN beroepskwalificaties bk ON bk.id = ba.bk_id
LEFT JOIN deelberoepskwalificaties dbk ON dbk.bk_id = bk.id
LEFT JOIN dbk_attestering da ON da.dbk_id = dbk.id AND da.leerling_id = ba.leerling_id
LEFT JOIN bk_competentiecomponenten cc ON cc.dbk_id = dbk.id
WHERE ba.leerling_id = ?
ORDER BY bk.code, dbk.code, cc.code;
```

---

## Entiteitsrelatiediagram

```
richting_leerplan          richting_bk
  (richting -> leerplan)     (richting -> BK)
         |                        |
         v                        v
  klas_leerplan_mapping    beroepskwalificaties
  (klas -> leerplan)         |
         |                   |--- deelberoepskwalificaties (DBK)
         v                   |         |
  LLinkid API               |         |--- bk_competentiecomponenten
  (doelen ophalen)           |                    |
         |                   |                    |
         v                   |                    v
  lpd_resultaten  <----------+---->  lpd_competentie_mapping
  (leerling vinkt af)                (LPD <-> competentie)
         |                                        |
         v                                        v
  stats.js (bestaand)              bk_attestering / dbk_attestering
  LLinkid-percentage view          Officieel BK-percentage view
```

---

## Samenvatting: wat verandert er?

| Aspect | Nu | Na migratie |
|---|---|---|
| BK-data | Geen | Officiele BK-tabel met code, naam, niveau |
| DBK-laag | Geen | `deelberoepskwalificaties` tabel |
| Competenties | Geen | `bk_competentiecomponenten` tabel |
| Richting -> BK | Hardcoded JSON | `richting_bk` tabel |
| LPD -> BK link | Impliciet via LLinkid-secties | Expliciet via `lpd_competentie_mapping` |
| BK-status leerling | Niet opgeslagen | `bk_attestering` + `dbk_attestering` |
| LPD-workflow | Ongewijzigd | Ongewijzigd |
| Export BK-bewijs | Niet mogelijk | Query over alle lagen |

**Totaal: 7 nieuwe tabellen, 0 gewijzigde tabellen.**
