'use strict';

/**
 * Onderwijs Vlaanderen Beroepskwalificaties API client — v2
 *
 * Base URL: https://onderwijs.api.vlaanderen.be/kwalificaties-en-curriculum/beroepskwalificaties/v2
 * Authenticatie: x-api-key header (API-sleutel via process.env.BK_API_KEY)
 *
 * Endpoints:
 *   GET /beroepskwalificatie                                              — lijst van BK's
 *   GET /beroepskwalificatie/{versie_nr_lang}                            — detail van één BK
 *   GET /beroepskwalificatie/{versie_nr_lang}/deelkwalificatie/{nr_lang} — detail van één DKW
 *
 * Paginatie: meta-object met total_elements, total_pages, number, size
 *   Queryparameters: pagenr, size, verberg_versies, zoek_gewijzigd_sinds
 *
 * Detail-respons bevat o.a.:
 *   versie_nr_lang, versie_nr_kort, titel, status, vks_niveau, erkenningsdatum,
 *   einddatum, definitie, omschrijving_kort, deelkwalificaties, competenties,
 *   synoniemen, domeinen, led_onderwerp, isced
 *
 * Cache: in-memory Map per instantie, TTL 1 uur.
 * Retry: bij HTTP 503 wordt tot 3x opnieuw geprobeerd (exponential backoff).
 */

const https = require('node:https');
const http = require('node:http');
const { URL } = require('node:url');

// ---------------------------------------------------------------------------
// Configuratie
// ---------------------------------------------------------------------------

const BASE_URL = 'https://onderwijs.api.vlaanderen.be/kwalificaties-en-curriculum/beroepskwalificaties/v2';

const PADEN = {
  lijst:          '/beroepskwalificatie',
  detail:         (versieNrLang) => `/beroepskwalificatie/${encodeURIComponent(versieNrLang)}`,
  deelkwalificatie: (versieNrLang, dkwNrLang) =>
    `/beroepskwalificatie/${encodeURIComponent(versieNrLang)}/deelkwalificatie/${encodeURIComponent(dkwNrLang)}`,
};

// ---------------------------------------------------------------------------
// Lage-niveau HTTP helper
// ---------------------------------------------------------------------------

/**
 * Voer een GET-request uit en geef de geparseerde JSON terug.
 * Retry bij 503, maximaal maxRetries pogingen (exponential backoff).
 *
 * @param {string} url
 * @param {object} headers      Request-headers (bijv. voor auth)
 * @param {number} maxRetries   Aantal pogingen (standaard 3)
 * @returns {Promise<any>}
 */
async function httpGet(url, headers = {}, maxRetries = 3) {
  for (let poging = 0; poging < maxRetries; poging++) {
    try {
      return await _doGet(url, headers);
    } catch (err) {
      if (err.statusCode === 503 && poging < maxRetries - 1) {
        // Exponential backoff: 1s, 2s, 4s
        await _sleep(1000 * Math.pow(2, poging));
        continue;
      }
      throw err;
    }
  }
}

function _sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Één HTTP GET-request. Gooit een Error met statusCode als de server een fout retourneert.
 *
 * @param {string} url
 * @param {object} extraHeaders
 * @returns {Promise<any>}
 */
function _doGet(url, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const transport = parsed.protocol === 'https:' ? https : http;

    const options = {
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path: parsed.pathname + parsed.search,
      method: 'GET',
      headers: {
        'User-Agent': 'bk-dk-lpd-web/1.0 (Node.js)',
        'Accept':     'application/json',
        ...extraHeaders,
      },
    };

    const req = transport.request(options, (res) => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');

        if (res.statusCode >= 400) {
          const err = new Error(`HTTP ${res.statusCode} voor ${url} — ${raw.slice(0, 200)}`);
          err.statusCode = res.statusCode;
          err.responseBody = raw;
          return reject(err);
        }

        try {
          resolve(JSON.parse(raw));
        } catch (parseErr) {
          reject(new Error(
            `Ongeldige JSON van ${url}: ${parseErr.message}\n` +
            `Eerste 200 tekens: ${raw.slice(0, 200)}`
          ));
        }
      });
    });

    req.on('error', reject);
    req.setTimeout(30_000, () => {
      req.destroy(new Error(`Timeout voor ${url}`));
    });
    req.end();
  });
}

// ---------------------------------------------------------------------------
// BkApiClient
// ---------------------------------------------------------------------------

class BkApiClient {
  /**
   * @param {object} opties
   * @param {string} [opties.apiKey]   API-sleutel (standaard: process.env.BK_API_KEY)
   */
  constructor(opties = {}) {
    this._apiKey = opties.apiKey || process.env.BK_API_KEY || '';

    // Vaste authorizatie-headers — x-api-key is het correcte formaat voor deze API
    this._headers = this._apiKey ? { 'x-api-key': this._apiKey } : {};

    /** @type {Map<string, {data: any, ts: number}>} In-memory cache met TTL */
    this._cache = new Map();
    /** Cache TTL in milliseconden (1 uur) */
    this._ttl = 60 * 60 * 1000;
  }

  // -------------------------------------------------------------------------
  // Cache helpers
  // -------------------------------------------------------------------------

  /** Haal een waarde uit de cache, of null als verlopen/niet aanwezig. */
  _cacheGet(sleutel) {
    const entry = this._cache.get(sleutel);
    if (!entry) return null;
    if (Date.now() - entry.ts > this._ttl) {
      this._cache.delete(sleutel);
      return null;
    }
    return entry.data;
  }

  /** Bewaar een waarde in de cache met tijdstempel. */
  _cacheSet(sleutel, data) {
    this._cache.set(sleutel, { data, ts: Date.now() });
  }

  // -------------------------------------------------------------------------
  // Interne GET met cache
  // -------------------------------------------------------------------------

  /**
   * Voer een gecachte GET-request uit tegen de vaste base-URL.
   *
   * @param {string} pad   Relatief pad inclusief eventuele querystring
   * @returns {Promise<any>}
   */
  async _get(pad) {
    const url = BASE_URL + pad;

    const cached = this._cacheGet(url);
    if (cached) return cached;

    const data = await httpGet(url, this._headers);
    this._cacheSet(url, data);
    return data;
  }

  // -------------------------------------------------------------------------
  // Publieke API
  // -------------------------------------------------------------------------

  /**
   * Lijst alle BK's op met optionele paginatie en filters.
   *
   * @param {object} [opties]
   * @param {number} [opties.pagenr]              Paginanummer (0-gebaseerd)
   * @param {number} [opties.size]                Aantal resultaten per pagina
   * @param {boolean} [opties.verberg_versies]    Verberg oudere versies van dezelfde BK
   * @param {string} [opties.zoek_gewijzigd_sinds] ISO-datum, bijv. "2024-01-01"
   * @returns {Promise<{items: Array, meta: object}>}
   */
  async listBks(opties = {}) {
    const params = new URLSearchParams();

    if (opties.pagenr     != null) params.set('pagenr',             String(opties.pagenr));
    if (opties.size       != null) params.set('size',               String(opties.size));
    if (opties.verberg_versies != null)
      params.set('verberg_versies', opties.verberg_versies ? 'true' : 'false');
    if (opties.zoek_gewijzigd_sinds)
      params.set('zoek_gewijzigd_sinds', opties.zoek_gewijzigd_sinds);

    const qs  = params.toString();
    const pad = qs ? `${PADEN.lijst}?${qs}` : PADEN.lijst;

    const data = await this._get(pad);
    return {
      items: data.beroepskwalificaties || data.items || data.results || (Array.isArray(data) ? data : []),
      meta:  data.meta || null,
    };
  }

  /**
   * Haal de volledige details op van één BK.
   *
   * @param {string} versieNrLang   Versienummer lang (bijv. "BK-0038-3")
   * @returns {Promise<object>}
   */
  async getBk(versieNrLang) {
    if (!versieNrLang) throw new Error('getBk: versieNrLang is verplicht');
    return this._get(PADEN.detail(versieNrLang));
  }

  /**
   * Haal de details op van één deelkwalificatie (DKW) binnen een BK.
   *
   * @param {string} versieNrLang   BK versienummer lang (bijv. "BK-0038-3")
   * @param {string} dkwNrLang      DKW nummer lang (bijv. "DKW-0038-3-1")
   * @returns {Promise<object>}
   */
  async getDeelkwalificatie(versieNrLang, dkwNrLang) {
    if (!versieNrLang) throw new Error('getDeelkwalificatie: versieNrLang is verplicht');
    if (!dkwNrLang)    throw new Error('getDeelkwalificatie: dkwNrLang is verplicht');
    return this._get(PADEN.deelkwalificatie(versieNrLang, dkwNrLang));
  }
}

module.exports = { BkApiClient };
