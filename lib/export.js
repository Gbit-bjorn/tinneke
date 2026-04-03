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
  genereerExcelKlas
};
