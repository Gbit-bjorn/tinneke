'use strict';

/**
 * @fileoverview WISA API client — haalt klassen en leerlingen op via SOAP.
 * Gebruikt de node-soap package om te communiceren met de WISA APIService.
 *
 * Relevante env vars:
 *   WISA_URL        — base URL van de WISA server (default: http://wenen.wisa-asp.net:8081)
 *   WISA_USERNAME   — gebruikersnaam (default: CI)
 *   WISA_PASSWORD   — wachtwoord (default: CLWisfijn2022)
 *   WISA_DATABASE   — databasenaam (default: SGKSOA)
 *   WISA_QUERY_KLASSEN — query-code voor klassen/leerlingen (default: DUAAL_API)
 */

const soap = require('soap');

// ---------------------------------------------------------------------------
// Hulpfuncties
// ---------------------------------------------------------------------------

/**
 * Formatteert een Date-object als DD/MM/YYYY voor de WISA API.
 *
 * @param {Date} datum
 * @returns {string}
 */
function formateerDatum(datum) {
  const dag = String(datum.getDate()).padStart(2, '0');
  const maand = String(datum.getMonth() + 1).padStart(2, '0');
  const jaar = datum.getFullYear();
  return `${dag}/${maand}/${jaar}`;
}

/**
 * Decodeert de ruwe SOAP-response naar een leesbare string.
 * De WISA API geeft bytes terug die als Buffer, base64-string of genest object
 * kunnen aankomen. Probeert utf-8, valt terug op latin-1.
 *
 * @param {*} result — het return-veld van de SOAP-response
 * @returns {string}
 */
function decodeerResponse(result) {
  // Haal de eigenlijke waarde op uit het response-object
  const raw = result?.Result?.$value ?? result?.return ?? result?.GetCSVDataResult ?? result;

  if (Buffer.isBuffer(raw)) {
    // Probeer utf-8, controleer op vervangingstekens (wijst op verkeerde encoding)
    const utf8Tekst = raw.toString('utf-8');
    if (!utf8Tekst.includes('\uFFFD')) return utf8Tekst;
    return raw.toString('latin1');
  }

  if (raw instanceof Uint8Array) {
    return Buffer.from(raw).toString('utf-8');
  }

  if (typeof raw === 'string') {
    // Kan gewone tekst zijn, of base64-geëncodeerd
    try {
      const decoded = Buffer.from(raw, 'base64').toString('utf-8');
      // Eenvoudige heuristiek: base64-decoded tekst bevat printbare tekens
      if (decoded.length > 0 && /[\x20-\x7E]/.test(decoded.slice(0, 20))) {
        return decoded;
      }
    } catch {
      // base64-decodering mislukt — gebruik raw string
    }
    return raw;
  }

  return String(raw ?? '');
}

/**
 * Parseert een puntkomma-gescheiden CSV-string naar een array van objects.
 * De eerste rij wordt gebruikt als kolomnamen.
 *
 * @param {string} csvTekst
 * @returns {Array<Record<string, string>>}
 */
function parseerCsv(csvTekst) {
  if (!csvTekst || csvTekst.trim() === '') return [];

  const regels = csvTekst
    .trim()
    .split(/\r?\n/)
    .filter((r) => r.trim() !== '');

  if (regels.length < 2) return [];

  // Eerste rij is de header
  const kolommen = regels[0].split(';').map((k) => k.trim());

  const rijen = [];
  for (let i = 1; i < regels.length; i++) {
    const waarden = regels[i].split(';');
    const rij = {};
    kolommen.forEach((kolom, idx) => {
      rij[kolom] = (waarden[idx] ?? '').trim();
    });
    rijen.push(rij);
  }

  return rijen;
}

// ---------------------------------------------------------------------------
// WisaClient klasse
// ---------------------------------------------------------------------------

/**
 * Client voor de WISA APIService (SOAP).
 * Cachet de soap-client na de eerste initialisatie.
 */
class WisaClient {
  constructor() {
    /** @type {string} */
    this.baseUrl = process.env.WISA_URL ?? 'http://wenen.wisa-asp.net:8081';

    /** @type {string} */
    this.gebruikersnaam = process.env.WISA_USERNAME ?? 'CI';

    /** @type {string} */
    this.wachtwoord = process.env.WISA_PASSWORD ?? 'CLWisfijn2022';

    /** @type {string} */
    this.database = process.env.WISA_DATABASE ?? 'SGKSOA';

    /** @type {string} */
    this.queryKlassen = process.env.WISA_QUERY_KLASSEN ?? 'DUAAL_API';

    /** @type {string} */
    this.wsdlUrl = `${this.baseUrl}/SOAP?service=WisaAPIService`;

    /** @private @type {import('soap').Client|null} */
    this._client = null;
  }

  /**
   * Maakt een soap-client aan of geeft de gecachte client terug.
   * Gebruikt `strict: false` voor tolerantie bij WISA-afwijkingen van de WSDL.
   *
   * @returns {Promise<import('soap').Client>}
   */
  async _getClient() {
    if (this._client) return this._client;

    try {
      this._client = await soap.createClientAsync(this.wsdlUrl, {
        strict: false,
      });
      return this._client;
    } catch (fout) {
      throw new Error(`WISA SOAP-client aanmaken mislukt: ${fout.message}`);
    }
  }

  /**
   * Haalt klassen en leerlingen op via de geconfigureerde query.
   *
   * @param {Date|null} [werkdatum=null] — peildatum; null = vandaag
   * @returns {Promise<Array<Record<string, string>>>} array van rij-objecten
   */
  async queryKlassenLeerlingen(werkdatum = null) {
    const datum = werkdatum instanceof Date ? werkdatum : new Date();
    const datumString = formateerDatum(datum);

    const client = await this._getClient();

    // Opbouw van de SOAP-parameters conform WISA API-schema
    const args = {
      Credentials: {
        'tns:Username': this.gebruikersnaam,
        'tns:Password': this.wachtwoord,
        'tns:Database': this.database,
      },
      QueryCode: this.queryKlassen,
      Params: {
        'tns:TWISAAPIParamValue': [
          {
            'tns:Name': 'werkdatum',
            'tns:Value': datumString,
          },
        ],
      },
      Header: true,
      Separator: ';',
    };

    let resultaat;
    try {
      // node-soap geeft [result, rawResponse, soapHeader, rawRequest] terug
      const [response] = await client.GetCSVDataAsync(args);
      resultaat = response;
    } catch (fout) {
      throw new Error(`WISA GetCSVData mislukt (${datumString}): ${fout.message}`);
    }

    const csvTekst = decodeerResponse(resultaat);
    return parseerCsv(csvTekst);
  }

  /**
   * Test of de verbinding met WISA tot stand komt.
   *
   * @returns {Promise<{ ok: boolean, message: string }>}
   */
  async testVerbinding() {
    try {
      const rijen = await this.queryKlassenLeerlingen();
      return {
        ok: true,
        message: `Verbinding OK — ${rijen.length} rijen ontvangen`,
      };
    } catch (fout) {
      return {
        ok: false,
        message: `Verbinding mislukt: ${fout.message}`,
      };
    }
  }
}

module.exports = { WisaClient };
