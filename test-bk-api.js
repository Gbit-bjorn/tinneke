'use strict';

/**
 * Test-script voor de BkApiClient (v2 API).
 * Gebruik: node test-bk-api.js
 *
 * Laadt de API-sleutel uit .env (BK_API_KEY=...).
 * Drukt ruwe API-responses af — handig om de structuur te inspecteren.
 */

require('dotenv').config();

const { BkApiClient } = require('./lib/bk-api');

// ---------------------------------------------------------------------------
// Hulpfuncties
// ---------------------------------------------------------------------------

function sectie(titel) {
  const lijn = '─'.repeat(60);
  console.log(`\n${lijn}`);
  console.log(`  ${titel}`);
  console.log(lijn);
}

function drukAfResultaat(label, data) {
  console.log(`\n[${label}]`);
  console.log(JSON.stringify(data, null, 2));
}

async function testStap(label, fn) {
  try {
    const resultaat = await fn();
    drukAfResultaat(label, resultaat);
    return resultaat;
  } catch (err) {
    console.error(`\n[${label}] FOUT: ${err.message}`);
    if (err.responseBody) {
      console.error(`  Response body: ${err.responseBody.slice(0, 500)}`);
    }
    return null;
  }
}

// ---------------------------------------------------------------------------
// Diagnose: toon configuratie
// ---------------------------------------------------------------------------

sectie('Configuratie');

const apiKey = process.env.BK_API_KEY;
if (!apiKey) {
  console.warn('  WAARSCHUWING: BK_API_KEY is niet ingesteld in .env');
  console.warn('  Maak een .env-bestand aan met: BK_API_KEY=jouw-sleutel-hier');
} else {
  const gemaskeerd = `${apiKey.slice(0, 4)}${'*'.repeat(Math.max(0, apiKey.length - 8))}${apiKey.slice(-4)}`;
  console.log(`  BK_API_KEY: ${gemaskeerd}`);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

const client = new BkApiClient();

(async () => {
  // ---- 1. listBks: eerste pagina ----
  sectie('1. listBks() — eerste pagina BK\'s ophalen');
  const resultaat = await testStap('listBks (pagina 0, size 5)', () =>
    client.listBks({ pagenr: 0, size: 5, verberg_versies: true })
  );

  // Bepaal een BK-code voor de volgende stappen
  let bkCode = 'BK-0038-3'; // bekende testcode
  if (resultaat && resultaat.items && resultaat.items.length > 0) {
    const eersteCode = resultaat.items[0].versie_nr_lang || resultaat.items[0].versie_nr_kort;
    if (eersteCode) {
      bkCode = eersteCode;
      console.log(`\n  Gebruik code uit listBks: ${bkCode}`);
    }
  }

  // ---- 2. listBks: paginatie meta ----
  sectie('2. listBks() — paginatie meta inspecteren');
  if (resultaat) {
    console.log('\n[meta]');
    console.log(JSON.stringify(resultaat.meta, null, 2));
  }

  // ---- 3. getBk: detail van één BK ----
  sectie(`3. getBk("${bkCode}") — detail ophalen`);
  const bkDetail = await testStap(`getBk(${bkCode})`, () => client.getBk(bkCode));

  // ---- 4. Deelkwalificaties uit detail ----
  sectie(`4. Deelkwalificaties van "${bkCode}"`);
  if (bkDetail && bkDetail.deelkwalificaties && bkDetail.deelkwalificaties.length > 0) {
    console.log('\n[deelkwalificaties]');
    console.log(JSON.stringify(bkDetail.deelkwalificaties, null, 2));

    // ---- 5. getDeelkwalificatie: detail van eerste DKW ----
    const eersteDkw = bkDetail.deelkwalificaties[0];
    const dkwCode = eersteDkw.nr_lang;
    if (dkwCode) {
      sectie(`5. getDeelkwalificatie("${bkCode}", "${dkwCode}")`);
      await testStap(`getDeelkwalificatie(${dkwCode})`, () =>
        client.getDeelkwalificatie(bkCode, dkwCode)
      );
    }
  } else {
    console.log('\n  Geen deelkwalificaties gevonden in detail-response.');
  }

  // ---- 6. Competenties uit detail ----
  sectie('6. Competenties inspecteren');
  if (bkDetail && bkDetail.competenties) {
    console.log(`\n  Aantal competenties: ${bkDetail.competenties.length}`);
    if (bkDetail.competenties.length > 0) {
      console.log('\n[eerste competentie]');
      console.log(JSON.stringify(bkDetail.competenties[0], null, 2));
    }
  } else {
    console.log('\n  Geen competenties gevonden in detail-response.');
  }

  // ---- Samenvatting ----
  sectie('Samenvatting');
  console.log('  Tests afgerond. Beschikbare velden in een BK-detail:');
  if (bkDetail) {
    const velden = Object.keys(bkDetail);
    velden.forEach(v => console.log(`    • ${v}`));
  }
})();
