# Research: WISA Sync Logica — Problemen & Risico's

> Onderzocht: 2026-04-13

## Sync-flow

1. UI: gebruiker vult werkdatum + schooljaar in, klikt "Synchroniseer WISA"
2. Route `POST /wisa/sync` → `WisaClient.queryKlassenLeerlingen(werkdatum)`
3. `db.syncWisaKlassenLeerlingen(rijen, schooljaar)` schrijft naar DB
4. Per klas: upsert klas → auto-koppel leerplan → **verwijder alle leerlingen** → bulk-insert

## Gevonden problemen

### 1. Destructieve sync (HOOG risico)

Bij elke sync wordt per klas:
- Alle `lpd_resultaten` expliciet verwijderd (`database.js:434-440`)
- Alle `leerlingen` verwijderd (`database.js:439`)
- Alle `bk_attestering` en `dbk_attestering` via `ON DELETE CASCADE` mee verwijderd

**Gevolg:** Elke WISA-sync wist alle attesteringsdata van de gesynchroniseerde klassen.

### 2. Geen leerling-identificatie (HOOG risico)

De `leerlingen` tabel heeft geen `wisa_id`, `stamboeknummer` of externe sleutel — enkel auto-increment `id`, `naam`, `voornaam`, `klas_id`.

**Gevolg:** Als een leerling van klas verandert, wordt die als nieuw record aangemaakt. Oude attesteringen gaan verloren. Onmogelijk om data mee te verhuizen.

### 3. Geen schooljaar-archivering (MEDIUM risico)

Klassen met `UNIQUE KEY (naam, schooljaar)` — dus klassen van vorig jaar blijven staan. Maar er is geen logica om ze te archiveren of als "afgesloten" te markeren.

### 4. Geen cleanup van verdwenen klassen (MEDIUM risico)

De sync loopt enkel over klassen die WISA teruggeeft. Klassen die niet meer bestaan in WISA worden niet verwijderd of gemarkeerd — ze blijven in de DB staan.

### 5. Inconsistente cascade (LAAG risico)

`lpd_resultaten` heeft **geen** `ON DELETE CASCADE` op `leerling_id`, maar `bk_attestering` en `dbk_attestering` wel. Daarom verwijdert `deleteLeerlingen()` eerst manueel lpd_resultaten.

### 6. Vage UI-waarschuwing (LAAG risico)

De confirm-dialog zegt "attesteringsdata" maar verduidelijkt niet dat LPD-resultaten + BK/DBK-attesteringen volledig gewist worden.

## Aanbevolen oplossingsrichting

1. Voeg `wisa_id` (stamboeknummer) toe aan leerlingen → herkenning bij re-sync
2. Verander sync van destructief (delete+insert) naar upsert-patroon (match op wisa_id)
3. Behoud bestaande attesteringen bij re-sync als leerling herkend wordt
4. Voeg `schooljaar`-filter toe aan UI (toon enkel actief schooljaar)
5. Markeer klassen als "afgesloten" wanneer ze uit WISA verdwijnen
