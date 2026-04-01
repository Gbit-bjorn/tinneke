'use strict';

require('dotenv').config();

/**
 * Debug script: onderzoek edge cases in berekenStats() voor
 * leerplan UUID f8351b0a-7af6-4b83-8d70-ae841dc55737
 *
 * Uitvoeren vanuit C:\bk-dk-lpd\web:
 *   node debug_stats.js
 */

const { LLinkidClient } = require('./lib/llinkid');
const { berekenStats }  = require('./lib/stats');

const UUID = 'f8351b0a-7af6-4b83-8d70-ae841dc55737';

// ─── Hulpfuncties voor logging ───────────────────────────────────────────────

function sep(titel) {
  const lijn = '─'.repeat(60);
  console.log(`\n${lijn}`);
  console.log(` ${titel}`);
  console.log(lijn);
}

function logDoel(d, prefix = '') {
  const type  = d.is_goal ? 'GOAL   ' : 'SECTION';
  const nr    = d.nr ? `[${d.nr}]` : '[geen nr]';
  const parent = d.parentKey ? d.parentKey.slice(-8) : 'ROOT    ';
  console.log(
    `${prefix}${type} depth=${d.depth} parent=…${parent} ${nr} ${d.key.slice(-8)} — ${d.titel.slice(0, 60)}`
  );
}

// ─── Stap 1: Laad echte doelen van LLinkid ──────────────────────────────────

async function main() {
  sep(`Stap 1 — Laad doelen van LLinkid voor ${UUID}`);

  const client = new LLinkidClient();
  let doelen;

  try {
    doelen = await client.getDoelen(UUID);
    console.log(`Totaal geladen nodes: ${doelen.length}`);
  } catch (err) {
    console.error('FOUT bij getDoelen:', err.message);
    process.exit(1);
  }

  if (doelen.length === 0) {
    console.error('Geen doelen gevonden — controleer de UUID.');
    process.exit(1);
  }

  // ─── Stap 2: Volledige structuurinspectie ────────────────────────────────

  sep('Stap 2 — Volledige structuur (alle nodes)');

  const sections = doelen.filter(d => d.is_section);
  const goals    = doelen.filter(d => d.is_goal);

  console.log(`  Secties:  ${sections.length}`);
  console.log(`  Goals:    ${goals.length}`);
  console.log(`  Goals zonder nr:  ${goals.filter(g => !g.nr).length}`);
  console.log(`  Goals met lege nr: ${goals.filter(g => g.nr === '').length}`);
  console.log(`  Goals met null nr: ${goals.filter(g => g.nr === null).length}`);
  console.log();

  console.log('Alle secties:');
  for (const s of sections) logDoel(s, '  ');

  console.log('\nAlle goals (eerste 30):');
  for (const g of goals.slice(0, 30)) logDoel(g, '  ');
  if (goals.length > 30) {
    console.log(`  ... en ${goals.length - 30} meer goals`);
  }

  // ─── Stap 3: Parent-child relaties ───────────────────────────────────────

  sep('Stap 3 — Parent-child relaties (boom)');

  const keyMap = new Map(doelen.map(d => [d.key, d]));

  // Vind root nodes (geen parent of parent niet in doelen)
  const roots = doelen.filter(d =>
    !d.parentKey || !keyMap.has(d.parentKey)
  );

  console.log(`Root nodes (${roots.length}):`);
  for (const r of roots) logDoel(r, '  ');

  // Toon kinderen per sectie
  console.log('\nKinderen per sectie:');
  for (const s of sections) {
    const kids = doelen.filter(d => d.parentKey === s.key);
    const goalKids    = kids.filter(d => d.is_goal);
    const sectionKids = kids.filter(d => d.is_section);
    console.log(`  …${s.key.slice(-8)} "${s.titel.slice(0, 40)}" → ${kids.length} kinderen (${goalKids.length} goals, ${sectionKids.length} secties)`);
  }

  // ─── Stap 4: berekenStats stap-voor-stap ─────────────────────────────────

  sep('Stap 4 — berekenStats stap-voor-stap analyse');

  // Reproduceer de bkNodes berekening uit berekenStats
  function kinderen(parentKey) {
    return doelen.filter(d => d.parentKey === parentKey);
  }

  function heeftGoals(sectionKey) {
    const kids = kinderen(sectionKey);
    return kids.some(k => k.is_goal || (k.is_section && heeftGoals(k.key)));
  }

  const bkNodes = doelen.filter(d =>
    d.is_section && heeftGoals(d.key) &&
    (!d.parentKey || !doelen.find(p =>
      p.key === d.parentKey && p.is_section && heeftGoals(p.key)
    ))
  );

  console.log(`bkNodes gevonden: ${bkNodes.length}`);
  if (bkNodes.length === 0) {
    console.log('  WAARSCHUWING: bkNodes is leeg — fallback-pad wordt genomen');

    // Analyse waarom bkNodes leeg is
    console.log('\n  Diagnose:');
    const sectiesMetGoals = sections.filter(s => heeftGoals(s.key));
    console.log(`  Secties met goals: ${sectiesMetGoals.length}`);
    for (const s of sectiesMetGoals) {
      const parentIsGoalSection = s.parentKey && doelen.find(p =>
        p.key === s.parentKey && p.is_section && heeftGoals(p.key)
      );
      console.log(`    …${s.key.slice(-8)} "${s.titel.slice(0,40)}" — parent-is-goal-section: ${!!parentIsGoalSection}`);
    }

    // Fallback-pad analyse
    console.log('\n  Fallback-pad:');
    const alleGoals = doelen.filter(d => d.is_goal && d.nr);
    console.log(`  Goals met nr (voor fallback): ${alleGoals.length}`);
    const goalsZonderNr = doelen.filter(d => d.is_goal && !d.nr);
    console.log(`  Goals gefilterd wegens geen nr: ${goalsZonderNr.length}`);
    if (goalsZonderNr.length > 0) {
      console.log('  Gefilterde goals:');
      for (const g of goalsZonderNr) logDoel(g, '    ');
    }
  } else {
    for (const bk of bkNodes) {
      const dpkNodes = kinderen(bk.key).filter(d => d.is_section);
      console.log(`  bkNode: "${bk.titel.slice(0,50)}" — dpkNodes: ${dpkNodes.length}`);
      for (const dpk of dpkNodes) {
        const lpdsOnder = [];
        function verzamelGoals(key) {
          for (const d of doelen) {
            if (d.parentKey === key) {
              if (d.is_goal)         lpdsOnder.push(d);
              else if (d.is_section) verzamelGoals(d.key);
            }
          }
        }
        verzamelGoals(dpk.key);
        console.log(`    dpkNode: "${dpk.titel.slice(0,40)}" — goals: ${lpdsOnder.length}`);
      }
    }
  }

  // ─── Stap 5: berekenStats met lege resultaten ────────────────────────────

  sep('Stap 5 — berekenStats met lege resultaten (normaal geval)');

  const resultatenLeeg = {};
  const stats1 = berekenStats(doelen, resultatenLeeg);

  console.log(`Resultaat: ${stats1.length} BK-secties`);
  for (const bk of stats1) {
    console.log(`  BK: "${bk.titel.slice(0,50)}" — totaal=${bk.stats.totaal} behaald=${bk.stats.behaald}`);
    for (const dpk of bk.dpkSecties) {
      console.log(`    DPK: "${dpk.titel.slice(0,40)}" — totaal=${dpk.stats.totaal} lpds=${dpk.lpds.length}`);
    }
  }

  // ─── Stap 6: Edge case — resultaten als Array (bug simulatie) ────────────

  sep('Stap 6 — Edge case: resultaten is een Array (niet een Object)');

  // Dit kan gebeuren als getLpdResultaten ooit een [] teruggeeft
  // in plaats van {}  — bv. door een toekomstige refactoring
  const resultatenAlsArray = [];
  console.log(`resultaten is Array: ${Array.isArray(resultatenAlsArray)}`);
  console.log(`resultaten[someKey] === true: ${resultatenAlsArray['some-uuid'] === true}`);
  console.log('Array-index lookup werkt in JS, maar alle values zijn undefined -> false');

  try {
    const stats2 = berekenStats(doelen, resultatenAlsArray);
    console.log(`berekenStats met Array: ${stats2.length} secties — geen crash, maar alles staat op niet-behaald`);
    const totaalBehaald = stats2.reduce((s, bk) => s + bk.stats.behaald, 0);
    console.log(`Totaal behaald (moet 0 zijn): ${totaalBehaald}`);
  } catch (err) {
    console.error(`CRASH met Array-resultaten: ${err.message}`);
  }

  // ─── Stap 7: Edge case — resultaten met behaald=0 (getal, niet bool) ─────

  sep('Stap 7 — Edge case: behaald=0 als getal uit MySQL (TINYINT)');

  // MySQL TINYINT geeft 0 of 1, database.js converteert met rij.behaald === 1
  // Maar stel dat de conversie overgeslagen wordt:
  const eersteGoal = goals[0];
  if (eersteGoal) {
    const resultatenMetGetal = { [eersteGoal.key]: 0 };  // 0 in plaats van false
    const stats3 = berekenStats(doelen, resultatenMetGetal);
    const behaaldCount = stats3.reduce((s, bk) => s + bk.stats.behaald, 0);
    console.log(`behaald=0 (getal): resultaten[key] === true → ${resultatenMetGetal[eersteGoal.key] === true}`);
    console.log(`Totaal behaald: ${behaaldCount} (moet 0 zijn want 0 !== true)`);

    const resultatenMetEen = { [eersteGoal.key]: 1 };   // 1 in plaats van true
    const stats4 = berekenStats(doelen, resultatenMetEen);
    const behaaldCount2 = stats4.reduce((s, bk) => s + bk.stats.behaald, 0);
    console.log(`behaald=1 (getal): resultaten[key] === true → ${resultatenMetEen[eersteGoal.key] === true}`);
    console.log(`Totaal behaald: ${behaaldCount2} (zou 0 zijn, want 1 !== true — BUG als DB TINYINT niet geconverteerd!)`);
  }

  // ─── Stap 8: Edge case — null/undefined doelen ───────────────────────────

  sep('Stap 8 — Edge case: doelen is lege array');

  try {
    const stats5 = berekenStats([], {});
    console.log(`Lege doelen: resultaat=${JSON.stringify(stats5)}`);
    console.log('WAARSCHUWING: returns [] — renderen toont "Geen doelen beschikbaar" of niets');
  } catch (err) {
    console.error(`CRASH met lege doelen: ${err.message}`);
  }

  // ─── Stap 9: Controleer of bkNodes gefilterd worden door geneste secties ──

  sep('Stap 9 — Geneste secties: worden sub-secties onterecht als bkNode opgenomen?');

  const dubbeleNodes = bkNodes.filter(bk =>
    bkNodes.some(other => other.key !== bk.key && other.parentKey === bk.key)
  );
  if (dubbeleNodes.length > 0) {
    console.log('PROBLEEM: sommige bkNodes zijn kinderen van andere bkNodes:');
    for (const d of dubbeleNodes) logDoel(d, '  ');
  } else {
    console.log('OK: geen overlap in bkNodes (geen parent-child paren)');
  }

  // ─── Stap 10: Samenvatting ───────────────────────────────────────────────

  sep('Stap 10 — Samenvatting bevindingen');

  const totaalGoals     = goals.length;
  const goalsZonderNr   = goals.filter(g => !g.nr).length;
  const goalsMetNr      = goals.filter(g => !!g.nr).length;
  const aantalBkSecties = stats1.length;
  const aantalLpds      = stats1.reduce((s, bk) =>
    s + bk.dpkSecties.reduce((s2, dpk) => s2 + dpk.lpds.length, 0), 0
  );

  console.log(`UUID getest:          ${UUID}`);
  console.log(`Totaal nodes:         ${doelen.length}`);
  console.log(`Secties:              ${sections.length}`);
  console.log(`Goals totaal:         ${totaalGoals}`);
  console.log(`Goals met nr:         ${goalsMetNr}`);
  console.log(`Goals zonder nr:      ${goalsZonderNr}  ← gefilterd in fallback-pad`);
  console.log(`bkNodes (top-level):  ${bkNodes.length}`);
  console.log(`BK-secties in output: ${aantalBkSecties}`);
  console.log(`LPDs in output:       ${aantalLpds}`);

  if (aantalLpds === 0 && totaalGoals > 0) {
    console.log('\nPROBLEEM GEDETECTEERD: er zijn goals maar berekenStats geeft 0 LPDs terug!');
    console.log('Mogelijke oorzaken:');
    if (bkNodes.length === 0) {
      console.log('  1. bkNodes is leeg (zie stap 4) EN alle goals hebben geen nr (zie fallback-pad)');
    }
    console.log('  2. heeftGoals() vindt goals maar ze zijn onbereikbaar via alleGoalsOnder()');
  } else if (aantalLpds === 0 && totaalGoals === 0) {
    console.log('\nGeen goals aanwezig in dit leerplan — normale situatie.');
  } else {
    console.log('\nOK: berekenStats geeft correcte output.');
  }
}

main().catch(err => {
  console.error('\nOnverwachte fout:', err);
  process.exit(1);
});
