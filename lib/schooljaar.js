'use strict';

/**
 * Gedeelde hulpfunctie voor schooljaarberekening.
 *
 * Logica: september (maand 8) is het begin van een nieuw schooljaar.
 * Januari t/m augustus vallen nog onder het vorige kalenderjaar.
 *
 * Voorbeelden:
 *   - september 2025 t/m augustus 2026 → schooljaar 2025
 *   - januari 2026 t/m augustus 2026   → schooljaar 2025
 */

/**
 * Geeft het startjaar van het huidige schooljaar terug.
 * @returns {number} Bijv. 2025 voor schooljaar 2025–2026
 */
function huidigSchooljaar() {
  const nu = new Date();
  return nu.getMonth() >= 8 ? nu.getFullYear() : nu.getFullYear() - 1;
}

module.exports = { huidigSchooljaar };
