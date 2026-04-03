'use strict';

/**
 * Export library: HTML en Excel generatie voor attestering
 * - genereerHtmlAttest: standalone HTML (alle CSS inline)
 * - genereerExcelAttest: per-leerling Excel rapport
 * - genereerExcelKlas: klasoverzicht met % per BK
 */

const ExcelJS = require('exceljs');

// ── HTML Export ─────────────────────────────────────────────────────────────

/**
 * Genereer standalone HTML-attest voor een leerling
 * Print-klaar met inline CSS, school logo placeholder, BK/DPK/LPD hiërarchie
 *
 * @param {Object} leerling - { id, naam, voornaam, klas_id }
 * @param {Object} klas - { id, naam, richting, schooljaar }
 * @param {Array} flatLpds - [{ bk, dpk, lpd, key, behaald }, ...]
 * @param {Object} resultaten - { [lpd_uuid]: boolean }
 * @returns {string} HTML
 */
function genereerHtmlAttest(leerling, klas, flatLpds, resultaten, schoolNaam = '') {
  const vandaag = new Date().toLocaleDateString('nl-BE');
  const volleNaam = `${leerling.voornaam} ${leerling.naam}`;

  // Build LPD rows
  let lpdRows = '';
  for (const item of flatLpds) {
    const icon = item.behaald ? '✓' : '○';
    const klasse = item.behaald ? 'behaald' : 'niet-behaald';

    lpdRows += `
        <tr>
          <td class="bk-col">${escapeHtml(item.bk)}</td>
          <td class="dpk-col">${escapeHtml(item.dpk)}</td>
          <td class="lpd-col">${escapeHtml(item.lpd)}</td>
          <td class="icon-col ${klasse}">${icon}</td>
          <td class="datum-col">${item.behaald ? vandaag : '—'}</td>
        </tr>
        `;
  }

  const html = `<!DOCTYPE html>
<html lang="nl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Attest ${volleNaam}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }

    body {
      font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
      background: #f5f5f5;
      color: #333;
      line-height: 1.6;
      padding: 20px;
    }

    .page {
      background: white;
      max-width: 210mm;
      height: 297mm;
      margin: 0 auto 20px;
      padding: 40px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.1);
      page-break-after: always;
    }

    .header {
      text-align: center;
      margin-bottom: 30px;
      border-bottom: 3px solid #2563EB;
      padding-bottom: 20px;
    }

    .logo-placeholder {
      width: 80px;
      height: 80px;
      background: #e0e7ff;
      border: 2px solid #2563EB;
      border-radius: 8px;
      margin: 0 auto 15px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 24px;
    }

    .school-name {
      font-size: 18px;
      font-weight: 600;
      color: #1e40af;
      margin-bottom: 5px;
    }

    .title {
      font-size: 24px;
      font-weight: 700;
      color: #1e3a8a;
      margin: 20px 0;
    }

    .student-info {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 20px;
      margin: 30px 0;
      padding: 15px;
      background: #f0f9ff;
      border-left: 4px solid #2563EB;
      border-radius: 4px;
    }

    .info-row {
      display: flex;
      justify-content: space-between;
    }

    .info-label {
      font-weight: 600;
      color: #1e3a8a;
      min-width: 120px;
    }

    .info-value {
      color: #333;
    }

    table {
      width: 100%;
      border-collapse: collapse;
      margin: 30px 0;
      font-size: 12px;
    }

    th {
      background: #2563EB;
      color: white;
      padding: 12px;
      text-align: left;
      font-weight: 600;
      border: 1px solid #1e40af;
    }

    td {
      padding: 10px 12px;
      border: 1px solid #ddd;
    }

    tr:nth-child(odd) {
      background: #f9fafb;
    }

    tr:hover {
      background: #eff6ff;
    }

    .bk-col {
      font-weight: 600;
      color: #1e40af;
      width: 12%;
    }

    .dpk-col {
      color: #475569;
      width: 15%;
    }

    .lpd-col {
      width: 55%;
    }

    .icon-col {
      text-align: center;
      width: 8%;
      font-size: 14px;
      font-weight: 700;
    }

    .icon-col.behaald {
      color: #16a34a;
      background: #f0fdf4;
    }

    .icon-col.niet-behaald {
      color: #6b7280;
      background: #f3f4f6;
    }

    .datum-col {
      width: 10%;
      text-align: center;
      color: #64748b;
      font-size: 11px;
    }

    .footer {
      margin-top: 40px;
      padding-top: 20px;
      border-top: 1px solid #ddd;
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 40px;
      font-size: 12px;
    }

    .signature-block {
      text-align: center;
    }

    .signature-line {
      margin-top: 30px;
      border-top: 1px solid #333;
      padding-top: 5px;
      font-size: 11px;
      color: #666;
    }

    .date-printed {
      text-align: right;
      margin-top: 30px;
      font-size: 11px;
      color: #666;
    }

    @media print {
      body { background: white; padding: 0; }
      .page { margin: 0; box-shadow: none; page-break-after: always; }
    }
  </style>
</head>
<body>
  <div class="page">
    <div class="header">
      <div class="logo-placeholder">🏫</div>
      <div class="school-name">${escapeHtml(schoolNaam)}</div>
      <div class="title">Attestering Leerplan Doelen</div>
    </div>

    <div class="student-info">
      <div>
        <div class="info-row">
          <span class="info-label">Leerling:</span>
          <span class="info-value">${escapeHtml(volleNaam)}</span>
        </div>
        <div class="info-row">
          <span class="info-label">Klas:</span>
          <span class="info-value">${escapeHtml(klas.naam)}</span>
        </div>
      </div>
      <div>
        <div class="info-row">
          <span class="info-label">Schooljaar:</span>
          <span class="info-value">${klas.schooljaar}</span>
        </div>
        <div class="info-row">
          <span class="info-label">Datum:</span>
          <span class="info-value">${vandaag}</span>
        </div>
      </div>
    </div>

    <table>
      <thead>
        <tr>
          <th>BK</th>
          <th>DPK</th>
          <th>Leerplandoel</th>
          <th>Behaald</th>
          <th>Datum</th>
        </tr>
      </thead>
      <tbody>
        ${lpdRows}
      </tbody>
    </table>

    <div class="footer">
      <div class="signature-block">
        <div>Leerling</div>
        <div class="signature-line"></div>
      </div>
      <div class="signature-block">
        <div>Leerkracht</div>
        <div class="signature-line"></div>
      </div>
    </div>

    <div class="date-printed">Gegenereerd: ${new Date().toLocaleString('nl-BE')}</div>
  </div>
</body>
</html>`;

  return html;
}

// ── Excel Export (per leerling) ──────────────────────────────────────────────

/**
 * Genereer Excel-attest voor een leerling
 * Kolommen: BK | DPK | Leerplandoel | Behaald (J/N) | Datum
 *
 * @param {Object} leerling
 * @param {Object} klas
 * @param {Array} flatLpds - [{ bk, dpk, lpd, key, behaald }, ...]
 * @returns {Promise<Buffer>} Excel workbook buffer
 */
async function genereerExcelAttest(leerling, klas, flatLpds) {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('Attestering');

  // Header styling
  const headerFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2563EB' } };
  const headerFont = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
  const headerAlignment = { horizontal: 'left', vertical: 'center', wrapText: true };

  // Kolom definities
  worksheet.columns = [
    { header: 'BK', key: 'bk', width: 15 },
    { header: 'DPK', key: 'dpk', width: 18 },
    { header: 'Leerplandoel', key: 'lpd', width: 50 },
    { header: 'Behaald', key: 'behaald', width: 10 },
    { header: 'Datum', key: 'datum', width: 12 }
  ];

  // Style header
  worksheet.getRow(1).eachCell((cell) => {
    cell.fill = headerFill;
    cell.font = headerFont;
    cell.alignment = headerAlignment;
  });
  worksheet.getRow(1).height = 25;

  // Data rows
  let rowNum = 2;
  let oddRow = false;

  for (const item of flatLpds) {
    const row = worksheet.getRow(rowNum);
    const vandaag = new Date().toLocaleDateString('nl-BE');

    row.getCell('bk').value = item.bk;
    row.getCell('dpk').value = item.dpk;
    row.getCell('lpd').value = item.lpd;
    row.getCell('behaald').value = item.behaald ? 'J' : 'N';
    row.getCell('datum').value = item.behaald ? vandaag : '';

    // Afwisselende rijen
    if (oddRow) {
      const fillColor = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF9FAFB' } };
      row.eachCell((cell) => {
        cell.fill = fillColor;
      });
    }

    // Inhoud alignment
    row.getCell('bk').alignment = { horizontal: 'left', vertical: 'top', wrapText: true };
    row.getCell('dpk').alignment = { horizontal: 'left', vertical: 'top', wrapText: true };
    row.getCell('lpd').alignment = { horizontal: 'left', vertical: 'top', wrapText: true };
    row.getCell('behaald').alignment = { horizontal: 'center', vertical: 'center' };
    row.getCell('datum').alignment = { horizontal: 'center', vertical: 'center' };

    // Conditioneel geformatteerd: groen voor behaald
    if (item.behaald) {
      row.getCell('behaald').font = { bold: true, color: { argb: 'FF16A34A' } };
      row.getCell('behaald').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF0FDF4' } };
    }

    rowNum++;
    oddRow = !oddRow;
  }

  // Bevriezende header
  worksheet.views = [{ state: 'frozen', ySplit: 1 }];

  // Metadata
  workbook.properties.title = `Attest ${leerling.voornaam} ${leerling.naam}`;
  workbook.properties.subject = `Leerplan ${klas.naam}`;
  workbook.properties.created = new Date();

  // Schrijf naar buffer
  const buffer = await workbook.xlsx.writeBuffer();
  return buffer;
}

// ── Excel Export (klasoverzicht) ─────────────────────────────────────────────

/**
 * Genereer Excel klasoverzicht
 * Rijen: leerlingen, Kolommen: BK's met % behaald
 *
 * @param {Object} klas
 * @param {Array} leerlingenMetStats - [{ id, naam, voornaam, bkStats: { bkTitel → percentage } }, ...]
 * @param {Array} bkNodes - [{ key, titel, is_section, depth }, ...] BK nodes uit LLinkid
 * @returns {Promise<Buffer>} Excel workbook buffer
 */
async function genereerExcelKlas(klas, leerlingenMetStats, bkNodes) {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('Klasoverzicht');

  // Header styling
  const headerFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2563EB' } };
  const headerFont = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };

  // Kolommen: Leerling + per BK
  const columns = [
    { header: 'Leerling', key: 'leerling', width: 25 }
  ];

  for (const bk of bkNodes) {
    columns.push({
      header: bk.titel,
      key: `bk_${bk.key}`,
      width: 12
    });
  }

  worksheet.columns = columns;

  // Style header
  worksheet.getRow(1).eachCell((cell) => {
    cell.fill = headerFill;
    cell.font = headerFont;
    cell.alignment = { horizontal: 'center', vertical: 'center', wrapText: true };
  });
  worksheet.getRow(1).height = 25;

  // Data rows
  let rowNum = 2;
  let oddRow = false;

  for (const leerling of leerlingenMetStats) {
    const row = worksheet.getRow(rowNum);
    const volleNaam = `${leerling.voornaam} ${leerling.naam}`;

    row.getCell('leerling').value = volleNaam;

    for (const bk of bkNodes) {
      const percentage = leerling.bkStats[bk.titel] ?? 0;
      const cell = row.getCell(`bk_${bk.key}`);
      cell.value = percentage;
      cell.numFmt = '0"%"';
      cell.alignment = { horizontal: 'center', vertical: 'center' };

      // Conditioneel geformatteerd: groen/geel/rood
      if (percentage >= 80) {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF0FDF4' } };
        cell.font = { bold: true, color: { argb: 'FF16A34A' } };
      } else if (percentage >= 60) {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEF3C7' } };
        cell.font = { color: { argb: 'FFD97706' } };
      } else if (percentage > 0) {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEE2E2' } };
        cell.font = { color: { argb: 'FFDC2626' } };
      }
    }

    // Afwisselende rijen (lichte achtergrond)
    if (oddRow) {
      const fillColor = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF9FAFB' } };
      row.eachCell((cell) => {
        cell.fill = fillColor;
      });
    }

    rowNum++;
    oddRow = !oddRow;
  }

  // Bevriezende header
  worksheet.views = [{ state: 'frozen', ySplit: 1 }];

  // Metadata
  workbook.properties.title = `Klasoverzicht ${klas.naam}`;
  workbook.properties.subject = `Schooljaar ${klas.schooljaar}`;
  workbook.properties.created = new Date();

  // Schrijf naar buffer
  const buffer = await workbook.xlsx.writeBuffer();
  return buffer;
}

// ── BK HTML Attest ───────────────────────────────────────────────────────────

/**
 * Genereer officieel HTML-attest "Bewijs van beroepskwalificatie" voor een leerling.
 * Print-klaar met inline CSS, BK/DBK/competentie hiërarchie.
 *
 * @param {Object} leerling     - { id, naam, voornaam, klas_id }
 * @param {Object} klas         - { id, naam, richting, schooljaar }
 * @param {Array}  bkStats      - Uitvoer van berekenStats(): [{ key, titel, stats, dpkSecties }]
 * @param {Array}  [bkMapping]  - Metadata uit richting_bk_mapping.json: [{ code, naam, niveau, dbks }]
 *                                Optioneel — verrijkt de output met officiële code en niveau.
 * @param {boolean} [alleenBehaald] - Toon enkel BK's met status >= 80% (standaard: false)
 * @returns {string} HTML
 */
function genereerBkHtmlAttest(leerling, klas, bkStats, bkMapping = [], alleenBehaald = false) {
  const vandaag   = new Date().toLocaleDateString('nl-BE');
  const volleNaam = `${leerling.voornaam} ${leerling.naam}`;
  const schoolNaam = process.env.SCHOOL_NAAM || '';

  // Bouw een lookup-map van BK-naam → mapping-metadata
  const metaLookup = new Map();
  for (const bk of bkMapping) {
    metaLookup.set(bk.naam, bk);
    metaLookup.set(bk.code, bk);
  }

  // Filter BK's indien gevraagd
  const bkLijst = alleenBehaald
    ? bkStats.filter(bk => bk.stats.percentage >= 80)
    : bkStats;

  // Bouw tabelrijen op per BK → DBK → competentie
  let bkSectiesHtml = '';
  for (const bk of bkLijst) {
    const meta = metaLookup.get(bk.titel) || {};
    const bkCode   = meta.code  || '';
    const bkNiveau = meta.niveau != null ? `Niveau ${meta.niveau}` : '';
    const pct = bk.stats.percentage;
    const statusKlasse = pct >= 80 ? 'behaald' : pct >= 60 ? 'gedeeltelijk' : pct > 0 ? 'niet-behaald' : 'niet-behaald';
    const statusTekst  = pct >= 80 ? 'Behaald' : pct >= 60 ? 'Gedeeltelijk' : 'Niet behaald';

    let dbkRijen = '';
    for (const dpk of bk.dpkSecties) {
      // Sla synthetische (niet-echte) DPK's over als ze dezelfde naam als de BK hebben
      const dpkTitel = dpk.synthetic ? '' : dpk.titel;
      const dpkPct   = dpk.stats.percentage;
      const dpkKlasse = dpkPct >= 80 ? 'behaald' : dpkPct >= 60 ? 'gedeeltelijk' : dpkPct > 0 ? 'niet-behaald' : 'niet-behaald';

      for (const lpd of dpk.lpds) {
        const lpdKlasse = lpd.behaald ? 'behaald' : 'niet-behaald';
        dbkRijen += `
          <tr>
            <td class="dbk-col">${escapeHtml(dpkTitel)}</td>
            <td class="comp-col">${escapeHtml(lpd.titel)}</td>
            <td class="status-col ${lpdKlasse}">${lpd.behaald ? '✓ Behaald' : '○ Niet behaald'}</td>
          </tr>`;
      }
    }

    bkSectiesHtml += `
      <div class="bk-blok">
        <div class="bk-header">
          <div class="bk-header-links">
            ${bkCode ? `<span class="bk-code">${escapeHtml(bkCode)}</span>` : ''}
            <span class="bk-naam">${escapeHtml(bk.titel)}</span>
            ${bkNiveau ? `<span class="bk-niveau">${escapeHtml(bkNiveau)}</span>` : ''}
          </div>
          <div class="bk-status ${statusKlasse}">
            ${escapeHtml(statusTekst)} — ${pct}%
            (${bk.stats.behaald}/${bk.stats.totaal})
          </div>
        </div>
        <table>
          <thead>
            <tr>
              <th class="dbk-col">DBK / Competentiecomponent</th>
              <th class="comp-col">Leerplandoel / Competentie</th>
              <th class="status-col">Status</th>
            </tr>
          </thead>
          <tbody>
            ${dbkRijen}
          </tbody>
        </table>
      </div>`;
  }

  if (bkLijst.length === 0) {
    bkSectiesHtml = '<p class="geen-data">Geen beroepskwalificaties beschikbaar.</p>';
  }

  return `<!DOCTYPE html>
<html lang="nl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>BK-attest ${volleNaam}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }

    body {
      font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
      background: #f5f5f5;
      color: #333;
      line-height: 1.6;
      padding: 20px;
    }

    .page {
      background: white;
      max-width: 210mm;
      margin: 0 auto 20px;
      padding: 40px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.1);
    }

    .header {
      text-align: center;
      margin-bottom: 30px;
      border-bottom: 3px solid #2563EB;
      padding-bottom: 20px;
    }

    .logo-placeholder {
      width: 80px;
      height: 80px;
      background: #e0e7ff;
      border: 2px solid #2563EB;
      border-radius: 8px;
      margin: 0 auto 15px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 24px;
    }

    .school-name {
      font-size: 18px;
      font-weight: 600;
      color: #1e40af;
      margin-bottom: 5px;
    }

    .title {
      font-size: 22px;
      font-weight: 700;
      color: #1e3a8a;
      margin: 15px 0 5px;
    }

    .subtitle {
      font-size: 13px;
      color: #64748b;
    }

    .student-info {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 20px;
      margin: 25px 0;
      padding: 15px;
      background: #f0f9ff;
      border-left: 4px solid #2563EB;
      border-radius: 4px;
    }

    .info-row {
      display: flex;
      gap: 8px;
      margin-bottom: 4px;
    }

    .info-label {
      font-weight: 600;
      color: #1e3a8a;
      min-width: 110px;
    }

    .info-value {
      color: #333;
    }

    .bk-blok {
      margin-bottom: 30px;
      border: 1px solid #e2e8f0;
      border-radius: 6px;
      overflow: hidden;
    }

    .bk-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 12px 16px;
      background: #1e3a8a;
      color: white;
      gap: 16px;
    }

    .bk-header-links {
      display: flex;
      align-items: center;
      gap: 10px;
      flex-wrap: wrap;
    }

    .bk-code {
      font-size: 11px;
      font-weight: 600;
      background: rgba(255,255,255,0.2);
      padding: 2px 6px;
      border-radius: 3px;
      letter-spacing: 0.5px;
    }

    .bk-naam {
      font-size: 15px;
      font-weight: 700;
    }

    .bk-niveau {
      font-size: 11px;
      background: rgba(255,255,255,0.15);
      padding: 2px 7px;
      border-radius: 10px;
    }

    .bk-status {
      font-size: 13px;
      font-weight: 600;
      white-space: nowrap;
      padding: 4px 10px;
      border-radius: 4px;
    }

    .bk-status.behaald      { background: #16a34a; color: white; }
    .bk-status.gedeeltelijk { background: #D97706; color: white; }
    .bk-status.niet-behaald { background: #6b7280; color: white; }

    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 12px;
    }

    th {
      background: #2563EB;
      color: white;
      padding: 10px 12px;
      text-align: left;
      font-weight: 600;
      border: 1px solid #1e40af;
    }

    td {
      padding: 9px 12px;
      border: 1px solid #e2e8f0;
    }

    tr:nth-child(odd) td {
      background: #f9fafb;
    }

    .dbk-col  { width: 25%; color: #475569; font-style: italic; }
    .comp-col { width: 55%; }
    .status-col {
      width: 20%;
      text-align: center;
      font-weight: 600;
      font-size: 11px;
    }

    .status-col.behaald      { color: #16a34a; background: #f0fdf4; }
    .status-col.niet-behaald { color: #6b7280; background: #f3f4f6; }

    .geen-data {
      color: #6b7280;
      font-style: italic;
      text-align: center;
      padding: 20px;
    }

    .footer {
      margin-top: 40px;
      padding-top: 20px;
      border-top: 1px solid #ddd;
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 40px;
      font-size: 12px;
    }

    .signature-block { text-align: center; }

    .signature-line {
      margin-top: 30px;
      border-top: 1px solid #333;
      padding-top: 5px;
      font-size: 11px;
      color: #666;
    }

    .date-printed {
      text-align: right;
      margin-top: 20px;
      font-size: 11px;
      color: #999;
    }

    @media print {
      body { background: white; padding: 0; }
      .page { margin: 0; box-shadow: none; }
      .bk-blok { page-break-inside: avoid; }
    }
  </style>
</head>
<body>
  <div class="page">
    <div class="header">
      <div class="logo-placeholder">🏫</div>
      <div class="school-name">${escapeHtml(schoolNaam)}</div>
      <div class="title">Bewijs van beroepskwalificatie</div>
      <div class="subtitle">Officieel attest duaal leren</div>
    </div>

    <div class="student-info">
      <div>
        <div class="info-row">
          <span class="info-label">Leerling:</span>
          <span class="info-value">${escapeHtml(volleNaam)}</span>
        </div>
        <div class="info-row">
          <span class="info-label">Klas:</span>
          <span class="info-value">${escapeHtml(klas.naam)}</span>
        </div>
        <div class="info-row">
          <span class="info-label">Richting:</span>
          <span class="info-value">${escapeHtml(klas.richting || '')}</span>
        </div>
      </div>
      <div>
        <div class="info-row">
          <span class="info-label">Schooljaar:</span>
          <span class="info-value">${klas.schooljaar}</span>
        </div>
        <div class="info-row">
          <span class="info-label">Datum:</span>
          <span class="info-value">${vandaag}</span>
        </div>
      </div>
    </div>

    ${bkSectiesHtml}

    <div class="footer">
      <div class="signature-block">
        <div>Leerling</div>
        <div class="signature-line"></div>
      </div>
      <div class="signature-block">
        <div>Directie / Verantwoordelijke</div>
        <div class="signature-line"></div>
      </div>
    </div>

    <div class="date-printed">Gegenereerd: ${new Date().toLocaleString('nl-BE')}</div>
  </div>
</body>
</html>`;
}

// ── BK Excel Attest (per leerling) ───────────────────────────────────────────

/**
 * Genereer Excel BK-attest voor een leerling.
 * Kolommen: BK Code | BK Naam | DBK | Competentie | Status | Percentage
 * Kleurcodering: groen ≥80%, oranje ≥60%, rood >0%
 *
 * @param {Object} leerling   - { id, naam, voornaam, klas_id }
 * @param {Object} klas       - { id, naam, richting, schooljaar }
 * @param {Array}  bkStats    - Uitvoer van berekenStats()
 * @param {Array}  [bkMapping] - Metadata uit richting_bk_mapping.json: [{ code, naam, niveau, dbks }]
 * @returns {Promise<Buffer>} Excel workbook buffer
 */
async function genereerBkExcelAttest(leerling, klas, bkStats, bkMapping = []) {
  const workbook  = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('BK Attest');

  const headerFill      = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E3A8A' } };
  const headerFont      = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
  const headerAlignment = { horizontal: 'left', vertical: 'center', wrapText: true };

  // Kolom definities
  worksheet.columns = [
    { header: 'BK Code',     key: 'bk_code',    width: 15 },
    { header: 'BK Naam',     key: 'bk_naam',    width: 28 },
    { header: 'DBK / Competentiecomponent', key: 'dbk',  width: 25 },
    { header: 'Leerplandoel / Competentie', key: 'comp', width: 45 },
    { header: 'Status',      key: 'status',     width: 14 },
    { header: 'BK %',        key: 'percentage', width: 10 },
  ];

  // Style header
  worksheet.getRow(1).eachCell((cell) => {
    cell.fill      = headerFill;
    cell.font      = headerFont;
    cell.alignment = headerAlignment;
  });
  worksheet.getRow(1).height = 25;

  // Lookup-map BK-naam → metadata
  const metaLookup = new Map();
  for (const bk of bkMapping) {
    metaLookup.set(bk.naam, bk);
  }

  let rowNum = 2;
  let bkWissel = false;

  for (const bk of bkStats) {
    const meta   = metaLookup.get(bk.titel) || {};
    const bkCode = meta.code || '';
    const pct    = bk.stats.percentage;

    // Achtergrondkleur per BK-blok (lichte wisseling voor leesbaarheid)
    const bkAchtergrond = bkWissel
      ? { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } }
      : null;

    for (const dpk of bk.dpkSecties) {
      const dpkTitel = dpk.synthetic ? '' : dpk.titel;

      for (const lpd of dpk.lpds) {
        const row = worksheet.getRow(rowNum);

        row.getCell('bk_code').value    = bkCode;
        row.getCell('bk_naam').value    = bk.titel;
        row.getCell('dbk').value        = dpkTitel;
        row.getCell('comp').value       = lpd.titel;
        row.getCell('status').value     = lpd.behaald ? 'Behaald' : 'Niet behaald';
        row.getCell('percentage').value = pct;

        // Percentagecel opmaak
        row.getCell('percentage').numFmt = '0"%"';

        // Alignment
        row.eachCell((cell) => {
          cell.alignment = { horizontal: 'left', vertical: 'top', wrapText: true };
        });
        row.getCell('status').alignment     = { horizontal: 'center', vertical: 'center' };
        row.getCell('percentage').alignment = { horizontal: 'center', vertical: 'center' };

        // Status-kleur
        if (lpd.behaald) {
          row.getCell('status').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF0FDF4' } };
          row.getCell('status').font = { bold: true, color: { argb: 'FF16A34A' } };
        } else {
          row.getCell('status').font = { color: { argb: 'FF6B7280' } };
        }

        // Percentage-kleur (BK-niveau)
        if (pct >= 80) {
          row.getCell('percentage').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF0FDF4' } };
          row.getCell('percentage').font = { bold: true, color: { argb: 'FF16A34A' } };
        } else if (pct >= 60) {
          row.getCell('percentage').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEF3C7' } };
          row.getCell('percentage').font = { color: { argb: 'FFD97706' } };
        } else if (pct > 0) {
          row.getCell('percentage').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEE2E2' } };
          row.getCell('percentage').font = { color: { argb: 'FFDC2626' } };
        }

        // BK-blok achtergrond (enkel als geen andere kleur al gezet)
        if (bkAchtergrond) {
          row.getCell('bk_code').fill = bkAchtergrond;
          row.getCell('bk_naam').fill = bkAchtergrond;
          row.getCell('dbk').fill     = bkAchtergrond;
          row.getCell('comp').fill    = bkAchtergrond;
        }

        rowNum++;
      }
    }

    bkWissel = !bkWissel;
  }

  // Bevriezende header
  worksheet.views = [{ state: 'frozen', ySplit: 1 }];

  // Metadata
  workbook.properties.title   = `BK-attest ${leerling.voornaam} ${leerling.naam}`;
  workbook.properties.subject = `Beroepskwalificaties ${klas.naam} — ${klas.schooljaar}`;
  workbook.properties.created = new Date();

  const buffer = await workbook.xlsx.writeBuffer();
  return buffer;
}

// ── BK Excel Klasoverzicht ───────────────────────────────────────────────────

/**
 * Genereer Excel BK-klasoverzicht.
 * Rijen: leerlingen. Kolommen: één per BK met % behaald.
 * Zelfde kleurcodering als het bestaande klasoverzicht.
 *
 * @param {Object} klas         - { id, naam, richting, schooljaar }
 * @param {Array}  leerlingen   - [{ id, naam, voornaam }, ...]
 * @param {Array}  allBkStats   - [{ leerlingId, bkStats: berekenStats()-uitvoer }, ...]
 *                                bkStats is de array van BK-secties per leerling
 * @returns {Promise<Buffer>} Excel workbook buffer
 */
async function genereerBkExcelKlas(klas, leerlingen, allBkStats) {
  const workbook  = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('BK Klasoverzicht');

  const headerFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E3A8A' } };
  const headerFont = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };

  // Verzamel alle unieke BK-titels (uit de eerste leerling met data, of alle leerlingen)
  const bkTitelSet = new Set();
  for (const { bkStats } of allBkStats) {
    for (const bk of bkStats) {
      bkTitelSet.add(bk.titel);
    }
  }
  const bkTitels = Array.from(bkTitelSet);

  // Kolommen: Leerling + één kolom per BK
  const columns = [
    { header: 'Leerling', key: 'leerling', width: 25 }
  ];
  for (const titel of bkTitels) {
    columns.push({
      header: titel,
      key:    `bk_${titel}`,
      width:  14,
    });
  }
  worksheet.columns = columns;

  // Style header
  worksheet.getRow(1).eachCell((cell) => {
    cell.fill      = headerFill;
    cell.font      = headerFont;
    cell.alignment = { horizontal: 'center', vertical: 'center', wrapText: true };
  });
  worksheet.getRow(1).height = 30;

  // Data rows
  let rowNum  = 2;
  let oddRow  = false;

  // Maak een lookup van leerlingId → bkStats
  const statsMap = new Map();
  for (const { leerlingId, bkStats } of allBkStats) {
    statsMap.set(leerlingId, bkStats);
  }

  for (const leerling of leerlingen) {
    const row       = worksheet.getRow(rowNum);
    const volleNaam = `${leerling.voornaam} ${leerling.naam}`;
    const bkStats   = statsMap.get(leerling.id) || [];

    // Bouw een lookup titel → percentage voor deze leerling
    const pctMap = new Map();
    for (const bk of bkStats) {
      pctMap.set(bk.titel, bk.stats.percentage);
    }

    row.getCell('leerling').value     = volleNaam;
    row.getCell('leerling').alignment = { horizontal: 'left', vertical: 'center' };

    for (const titel of bkTitels) {
      const percentage = pctMap.get(titel) ?? 0;
      const cel        = row.getCell(`bk_${titel}`);

      cel.value  = percentage;
      cel.numFmt = '0"%"';
      cel.alignment = { horizontal: 'center', vertical: 'center' };

      // Kleurcodering: groen ≥80%, oranje ≥60%, rood >0%
      if (percentage >= 80) {
        cel.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF0FDF4' } };
        cel.font = { bold: true, color: { argb: 'FF16A34A' } };
      } else if (percentage >= 60) {
        cel.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEF3C7' } };
        cel.font = { color: { argb: 'FFD97706' } };
      } else if (percentage > 0) {
        cel.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEE2E2' } };
        cel.font = { color: { argb: 'FFDC2626' } };
      } else if (oddRow) {
        cel.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF9FAFB' } };
      }
    }

    // Afwisselende rijkleur voor naamkolom
    if (oddRow) {
      row.getCell('leerling').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF9FAFB' } };
    }

    rowNum++;
    oddRow = !oddRow;
  }

  // Bevriezende header
  worksheet.views = [{ state: 'frozen', ySplit: 1 }];

  // Metadata
  workbook.properties.title   = `BK Klasoverzicht ${klas.naam}`;
  workbook.properties.subject = `Schooljaar ${klas.schooljaar}`;
  workbook.properties.created = new Date();

  const buffer = await workbook.xlsx.writeBuffer();
  return buffer;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Escape HTML special characters
 */
function escapeHtml(text) {
  if (!text) return '';
  const map = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  };
  return text.replace(/[&<>"']/g, m => map[m]);
}

// ── Exports ──────────────────────────────────────────────────────────────────

module.exports = {
  genereerHtmlAttest,
  genereerExcelAttest,
  genereerExcelKlas,
  genereerBkHtmlAttest,
  genereerBkExcelAttest,
  genereerBkExcelKlas,
};
