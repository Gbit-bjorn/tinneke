'use strict';

/**
 * Gedeelde BK/DPK/LPD statistiekberekening.
 * Gebruikt door zowel attestering als export routes.
 */

function alleGoalsOnder(rootKey, doelen) {
  const resultaten = [];
  for (const d of doelen) {
    if (d.parentKey === rootKey) {
      if (d.is_goal)         resultaten.push(d);
      else if (d.is_section) resultaten.push(...alleGoalsOnder(d.key, doelen));
    }
  }
  return resultaten;
}

/**
 * Bouw BK/DPK/LPD-hiërarchie op uit LLinkid-doelen + DB-resultaten.
 * Werkt met zowel geneste (BK → DPK → LPD) als vlakke structuren.
 *
 * @param {Array} doelen     - Doelen uit LLinkidClient.getDoelen()
 * @param {Object} resultaten - Map van lpd_uuid → boolean (behaald)
 * @returns {Array} bkSecties
 */
function berekenStats(doelen, resultaten) {
  function kinderen(parentKey) {
    return doelen.filter(d => d.parentKey === parentKey);
  }

  // Zoek secties die direct of indirect goals bevatten (ongeacht depth)
  function heeftGoals(sectionKey) {
    const kids = kinderen(sectionKey);
    return kids.some(k => k.is_goal || (k.is_section && heeftGoals(k.key)));
  }

  // Zoek de hoogste secties die goals bevatten als BK-niveau
  const bkNodes = doelen.filter(d => d.is_section && heeftGoals(d.key) &&
    // Alleen secties waarvan de parent GEEN sectie-met-goals is (= topniveau)
    (!d.parentKey || !doelen.find(p => p.key === d.parentKey && p.is_section && heeftGoals(p.key)))
  );

  // Als er geen BK-secties zijn, maak één virtuele sectie met alle goals
  if (bkNodes.length === 0) {
    const alleGoals = doelen.filter(d => d.is_goal && d.nr);
    const lpds = alleGoals.map(g => ({
      key: g.key, titel: g.titel, nr: g.nr, behaald: resultaten[g.key] === true,
    }));
    const totaal = lpds.length, behaald = lpds.filter(l => l.behaald).length;
    const percentage = totaal > 0 ? Math.round((behaald / totaal) * 100) : 0;
    return [{ key: '_all', titel: 'Doelen', stats: { totaal, behaald, percentage },
      dpkSecties: [{ key: '_all_dpk', titel: 'Alle doelen', stats: { totaal, behaald, percentage }, lpds }] }];
  }

  const bkSecties = bkNodes.map(bk => {
    const dpkNodes = kinderen(bk.key).filter(d => d.is_section);

    // Als de BK-sectie direct goals heeft (zonder DPK-tussenlaag)
    if (dpkNodes.length === 0) {
      const lpdsRaw = alleGoalsOnder(bk.key, doelen);
      const lpds = lpdsRaw.map(lpd => ({
        key: lpd.key, titel: lpd.titel, nr: lpd.nr, behaald: resultaten[lpd.key] === true,
      }));
      const totaal = lpds.length, behaald = lpds.filter(l => l.behaald).length;
      const percentage = totaal > 0 ? Math.round((behaald / totaal) * 100) : 0;
      return { key: bk.key, titel: bk.titel, stats: { totaal, behaald, percentage },
        dpkSecties: [{ key: bk.key + '_lpd', titel: bk.titel, stats: { totaal, behaald, percentage }, lpds }] };
    }

    const dpkSecties = dpkNodes.map(dpk => {
      const lpdsRaw = alleGoalsOnder(dpk.key, doelen);
      const lpds = lpdsRaw.map(lpd => ({
        key: lpd.key, titel: lpd.titel, nr: lpd.nr, behaald: resultaten[lpd.key] === true,
      }));
      const totaal = lpds.length, behaald = lpds.filter(l => l.behaald).length;
      const percentage = totaal > 0 ? Math.round((behaald / totaal) * 100) : 0;
      return { key: dpk.key, titel: dpk.titel, stats: { totaal, behaald, percentage }, lpds };
    });

    const totaal     = dpkSecties.reduce((s, d) => s + d.stats.totaal, 0);
    const behaald    = dpkSecties.reduce((s, d) => s + d.stats.behaald, 0);
    const percentage = totaal > 0 ? Math.round((behaald / totaal) * 100) : 0;

    return { key: bk.key, titel: bk.titel, stats: { totaal, behaald, percentage }, dpkSecties };
  });

  return bkSecties;
}

/**
 * Flatten de BK-hiërarchie naar een platte lijst voor exports.
 */
function flattenBkHierarchy(bkSecties) {
  const lpds = [];
  for (const bk of bkSecties) {
    for (const dpk of bk.dpkSecties) {
      for (const lpd of dpk.lpds) {
        lpds.push({ bk: bk.titel, dpk: dpk.titel, lpd: lpd.titel, key: lpd.key, behaald: lpd.behaald });
      }
    }
  }
  return lpds;
}

module.exports = { berekenStats, flattenBkHierarchy, alleGoalsOnder };
