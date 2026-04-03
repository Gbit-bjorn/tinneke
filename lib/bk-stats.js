'use strict';

/**
 * BK/DBK attesteringsstatistieken op basis van LPD-resultaten + competentie-mapping.
 *
 * Dit module is OPTIONEEL: als een richting geen BK-mapping heeft, retourneert
 * het lege resultaten. De bestaande stats.js blijft onafhankelijk werken.
 *
 * Tabellen die gebruikt worden:
 *   - richting_bk              (richting -> BK)
 *   - beroepskwalificaties     (BK referentiedata)
 *   - deelberoepskwalificaties (DBK tussenlaag)
 *   - bk_competentiecomponenten (competenties per BK/DBK)
 *   - lpd_competentie_mapping  (LPD <-> competentie koppeling)
 *   - lpd_resultaten           (behaald per leerling)
 *   - bk_attestering           (resultaat per leerling per BK)
 *   - dbk_attestering          (resultaat per leerling per DBK)
 */

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Bepaal de status op basis van percentage.
 * @param {number} percentage  0-100
 * @returns {'niet_gestart'|'bezig'|'behaald'}
 */
function bepaalStatus(percentage) {
  if (percentage >= 100) return 'behaald';
  if (percentage > 0)    return 'bezig';
  return 'niet_gestart';
}

// ── Competenties en LPD-mapping laden per BK ─────────────────────────────────

/**
 * Haal alle competentiecomponenten op voor een BK, inclusief de gekoppelde
 * LPD-UUIDs. Gebruikt getLpdCompetentieMapping() eenmalig en groepeert in JS
 * (voorkomt N+1-probleem per competentie).
 *
 * @param {import('./database').Database} db
 * @param {number} bkId
 * @returns {Promise<{dbks: Array, componenten: Array}>}
 */
async function laadBkStructuur(db, bkId) {
  // DBK's ophalen via Database-methode
  const dbks = await db.getDeelberoepskwalificaties(bkId);

  // Alle competentiecomponenten voor deze BK (met of zonder DBK)
  const componenten = await db.getCompetenties(bkId);

  // LPD-mappings eenmalig ophalen en groeperen per competentie_id (geen N+1)
  const mappingRows = await db.getLpdCompetentieMapping(bkId);
  const mappingPerCompetentie = {};
  for (const row of mappingRows) {
    if (!mappingPerCompetentie[row.competentie_id]) {
      mappingPerCompetentie[row.competentie_id] = [];
    }
    mappingPerCompetentie[row.competentie_id].push(row.lpd_uuid);
  }

  for (const comp of componenten) {
    comp.lpdUuids = mappingPerCompetentie[comp.id] ?? [];
  }

  return { dbks, componenten };
}

// ── Hoofdberekening: één BK voor één leerling ────────────────────────────────

/**
 * Bereken de volledige BK-statistieken voor één leerling en één BK.
 * Controleert per competentiecomponent welke LPD's behaald zijn.
 *
 * @param {import('./database').Database} db
 * @param {number} leerlingId
 * @param {object} bk           BK-object ({id, code, naam, niveau})
 * @returns {Promise<object>}    Volledig BK-resultaat met hiërarchie
 */
async function berekenEnkeleBk(db, leerlingId, bk) {
  const { dbks, componenten } = await laadBkStructuur(db, bk.id);

  // Geen competenties gemapped? Retourneer BK met needsMapping vlag
  if (componenten.length === 0) {
    return {
      code: bk.code,
      naam: bk.naam,
      niveau: bk.niveau,
      totaal: 0,
      behaald: 0,
      percentage: 0,
      status: 'niet_gestart',
      needsMapping: true,
      dbks: [],
      _bkId: bk.id,
      _dbkCodeNaarId: {},
    };
  }

  // Haal alle LPD-resultaten op voor deze leerling (één keer, hergebruik)
  const lpdResultaten = await db.getLpdResultaten(leerlingId);

  // Bouw competentie-objecten op met behaald-status per LPD
  const competentieObjecten = componenten.map(comp => {
    const lpds = comp.lpdUuids.map(uuid => ({
      uuid,
      titel: uuid,   // Alleen UUID beschikbaar, titel komt uit LLinkid (niet in DB)
      behaald: lpdResultaten[uuid] === true,
    }));
    const alleBehaald = lpds.length > 0 && lpds.every(l => l.behaald);

    return {
      code: comp.code,
      omschrijving: comp.omschrijving,
      dbkId: comp.dbk_id,
      lpds,
      behaald: alleBehaald,
    };
  });

  // Groepeer competenties per DBK
  let dbkResultaten;

  // Bouw een map van DBK-code naar DBK-id voor gebruik in slaAttesteringOp
  const dbkCodeNaarId = {};
  for (const dbk of dbks) {
    dbkCodeNaarId[dbk.code] = dbk.id;
  }

  if (dbks.length > 0) {
    // Elke DBK krijgt zijn eigen competenties
    dbkResultaten = dbks.map(dbk => {
      const comps = competentieObjecten.filter(c => c.dbkId === dbk.id);
      const totaal  = comps.length;
      const behaald = comps.filter(c => c.behaald).length;
      const percentage = totaal > 0 ? Math.round((behaald / totaal) * 100) : 0;

      return {
        code: dbk.code,
        naam: dbk.naam,
        totaal,
        behaald,
        percentage,
        status: bepaalStatus(percentage),
        competenties: comps.map(c => ({
          code: c.code,
          omschrijving: c.omschrijving,
          lpds: c.lpds,
          behaald: c.behaald,
        })),
      };
    });

    // Competenties zonder DBK (dbk_id IS NULL) toevoegen als losse groep
    const losseComps = competentieObjecten.filter(c => c.dbkId === null);
    if (losseComps.length > 0) {
      const totaal  = losseComps.length;
      const behaald = losseComps.filter(c => c.behaald).length;
      const percentage = totaal > 0 ? Math.round((behaald / totaal) * 100) : 0;

      dbkResultaten.push({
        code: `${bk.code}-OVERIG`,
        naam: `${bk.naam} (overige competenties)`,
        totaal,
        behaald,
        percentage,
        status: bepaalStatus(percentage),
        competenties: losseComps.map(c => ({
          code: c.code,
          omschrijving: c.omschrijving,
          lpds: c.lpds,
          behaald: c.behaald,
        })),
      });
    }
  } else {
    // Geen DBK's: alle competenties in een synthetische DBK met BK-naam
    const totaal  = competentieObjecten.length;
    const behaald = competentieObjecten.filter(c => c.behaald).length;
    const percentage = totaal > 0 ? Math.round((behaald / totaal) * 100) : 0;

    dbkResultaten = [{
      code: `${bk.code}-DBK-SYNTH`,
      naam: bk.naam,
      totaal,
      behaald,
      percentage,
      status: bepaalStatus(percentage),
      competenties: competentieObjecten.map(c => ({
        code: c.code,
        omschrijving: c.omschrijving,
        lpds: c.lpds,
        behaald: c.behaald,
      })),
    }];
  }

  // Aggregeer naar BK-niveau
  const totaal     = dbkResultaten.reduce((s, d) => s + d.totaal, 0);
  const behaald    = dbkResultaten.reduce((s, d) => s + d.behaald, 0);
  const percentage = totaal > 0 ? Math.round((behaald / totaal) * 100) : 0;

  return {
    code: bk.code,
    naam: bk.naam,
    niveau: bk.niveau,
    totaal,
    behaald,
    percentage,
    status: bepaalStatus(percentage),
    dbks: dbkResultaten,
    // Interne velden voor slaAttesteringOp (niet deel van publieke API)
    _bkId: bk.id,
    _dbkCodeNaarId: dbkCodeNaarId,
  };
}

// ── Attestering opslaan in DB ────────────────────────────────────────────────

/**
 * Sla de berekende BK- en DBK-attesteringen op in de database.
 * Gebruikt db.updateBkAttestering() en db.updateDbkAttestering() (UPSERT).
 * Synthetische DBK's (niet in de database) worden overgeslagen.
 *
 * @param {import('./database').Database} db
 * @param {number} leerlingId
 * @param {object} bkResultaat   Resultaat van berekenEnkeleBk()
 */
async function slaAttesteringOp(db, leerlingId, bkResultaat) {
  const bkId = bkResultaat._bkId;
  if (!bkId) return;

  // BK-attestering opslaan via Database-methode
  await db.updateBkAttestering(leerlingId, bkId, bkResultaat.percentage, bkResultaat.status);

  // DBK-attesteringen opslaan — synthetische DBK's bestaan niet in de database
  const dbkCodeNaarId = bkResultaat._dbkCodeNaarId ?? {};
  for (const dbk of bkResultaat.dbks) {
    const dbkId = dbkCodeNaarId[dbk.code];
    if (!dbkId) continue;  // Synthetische of onbekende DBK, sla over

    await db.updateDbkAttestering(leerlingId, dbkId, dbk.percentage, dbk.status);
  }
}

// ── Publieke functies ────────────────────────────────────────────────────────

/**
 * Bereken de volledige BK/DBK-statistieken voor één leerling.
 * Zoekt de BK's op die horen bij de richting van de klas, berekent
 * percentages op basis van LPD-resultaten en competentie-mapping,
 * en slaat de resultaten op in bk_attestering / dbk_attestering.
 *
 * Als de richting geen BK-mapping heeft, retourneert dit gracefully
 * een leeg resultaat — de rest van de applicatie draait gewoon door.
 *
 * @param {import('./database').Database} db
 * @param {number} leerlingId
 * @param {number} klasId
 * @returns {Promise<{heeftBks: boolean, bks: Array}>}
 */
async function berekenBkStats(db, leerlingId, klasId) {
  const bks = await db.getBksVoorKlas(klasId);

  // Geen BK-mapping voor deze richting? Geen probleem.
  if (bks.length === 0) {
    return { heeftBks: false, bks: [] };
  }

  const resultaten = [];
  for (const bk of bks) {
    const bkResultaat = await berekenEnkeleBk(db, leerlingId, bk);
    await slaAttesteringOp(db, leerlingId, bkResultaat);
    // Verwijder interne velden voor publieke output
    const { _bkId, _dbkCodeNaarId, ...publiekResultaat } = bkResultaat;
    resultaten.push(publiekResultaat);
  }

  return { heeftBks: true, bks: resultaten };
}

/**
 * Bereken BK-statistieken voor alle leerlingen van een klas.
 * Retourneert een samenvatting per leerling per BK (voor klasoverzicht).
 *
 * @param {import('./database').Database} db
 * @param {number} klasId
 * @returns {Promise<Array>}  [{leerlingId, naam, voornaam, bks: [...]}]
 */
async function berekenBkStatsVoorKlas(db, klasId) {
  const leerlingen = await db.getLeerlingen(klasId);
  const bks = await db.getBksVoorKlas(klasId);

  // Geen BK-mapping? Lege lijst retourneren.
  if (bks.length === 0) return [];

  const overzicht = [];
  for (const ll of leerlingen) {
    const bkResultaten = [];
    for (const bk of bks) {
      const bkResultaat = await berekenEnkeleBk(db, ll.id, bk);
      await slaAttesteringOp(db, ll.id, bkResultaat);
      // Verwijder interne velden voor publieke output
      const { _bkId, _dbkCodeNaarId, ...publiekResultaat } = bkResultaat;
      bkResultaten.push(publiekResultaat);
    }

    overzicht.push({
      leerlingId: ll.id,
      naam: ll.naam,
      voornaam: ll.voornaam,
      bks: bkResultaten,
    });
  }

  return overzicht;
}

/**
 * Herbereken een enkele BK voor een enkele leerling.
 * Bedoeld om aan te roepen wanneer een LPD getoggeld wordt
 * (als er een BK-mapping bestaat voor die LPD).
 *
 * @param {import('./database').Database} db
 * @param {number} leerlingId
 * @param {number} bkId        Database-ID van de BK
 * @returns {Promise<object|null>}  BK-resultaat of null als BK niet gevonden
 */
async function herbereken(db, leerlingId, bkId) {
  const bk = await db.getBeroepskwalificatie(bkId);
  if (!bk) return null;

  const bkResultaat = await berekenEnkeleBk(db, leerlingId, bk);
  await slaAttesteringOp(db, leerlingId, bkResultaat);
  // Verwijder interne velden voor publieke output
  const { _bkId, _dbkCodeNaarId, ...publiekResultaat } = bkResultaat;
  return publiekResultaat;
}

module.exports = { berekenBkStats, berekenBkStatsVoorKlas, herbereken };
