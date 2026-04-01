'use strict';

/**
 * LLinkid API client
 * Base URL: https://cached-api.katholiekonderwijs.vlaanderen
 * Geen externe dependencies — alleen Node.js stdlib https/http.
 *
 * Paginatie: de API geeft $$meta.next terug als er meer pagina's zijn.
 * Cache: in-memory Map per instantie, sleutels zijn URL-strings.
 * Retry: bij HTTP 503 wordt tot 3x opnieuw geprobeerd (exponential backoff).
 */

const https = require('node:https');
const http = require('node:http');
const { URL } = require('node:url');

const DEFAULT_BASE = 'https://cached-api.katholiekonderwijs.vlaanderen';

// ---------------------------------------------------------------------------
// Lage-niveau HTTP helper
// ---------------------------------------------------------------------------

/**
 * Voer een GET-request uit en geef de geparseerde JSON terug.
 * Retry bij 503, maximaal maxRetries pogingen.
 *
 * @param {string} url         Volledige URL
 * @param {number} maxRetries  Aantal pogingen (standaard 3)
 * @returns {Promise<any>}
 */
async function httpGet(url, maxRetries = 3) {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const data = await _doGet(url);
      return data;
    } catch (err) {
      if (err.statusCode === 503 && attempt < maxRetries - 1) {
        // Exponential backoff: 1s, 2s, 4s
        await _sleep(1000 * Math.pow(2, attempt));
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
 * Één HTTP GET. Gooit een Error met statusCode als de server een fout stuurt.
 */
function _doGet(url) {
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
        'Accept': 'application/json',
      },
    };

    const req = transport.request(options, (res) => {
      if (res.statusCode >= 400) {
        const err = new Error(`HTTP ${res.statusCode} voor ${url}`);
        err.statusCode = res.statusCode;
        // Drain de response zodat de socket vrijkomt
        res.resume();
        return reject(err);
      }

      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
        } catch (parseErr) {
          reject(new Error(`Ongeldige JSON van ${url}: ${parseErr.message}`));
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
// Paginatie helper
// ---------------------------------------------------------------------------

/**
 * Haal alle resultaten op van een gepagineerde API.
 * Volgt $$meta.next totdat er geen volgende pagina meer is.
 *
 * @param {string} baseUrl   Eerste URL (inclusief querystring)
 * @param {Map}    cache     In-memory cache
 * @returns {Promise<Array>}
 */
async function fetchAll(baseUrl, client) {
  let url = baseUrl;
  const allResults = [];

  while (url) {
    let page = client._cacheGet(url);
    if (!page) {
      page = await httpGet(url);
      client._cacheSet(url, page);
    }

    const results = page.results || [];
    allResults.push(...results);

    const next = page.$$meta?.next;
    if (!next) break;
    // next kan een relatief pad zijn
    url = next.startsWith('http') ? next : DEFAULT_BASE + next;
  }

  return allResults;
}

// ---------------------------------------------------------------------------
// Hulpfuncties voor node-extractie
// ---------------------------------------------------------------------------

function extractBody(item) {
  if (item['$$expanded']) return item['$$expanded'];
  if (item.body) return item.body;
  return item;
}

function normalizeText(text) {
  if (!text) return '';
  return text
    .replace(/<br\s*\/?>/gi, ' ')       // <br> en <br/> → spatie
    .replace(/<li[^>]*>/gi, '• ')        // <li> → bullet
    .replace(/<[^>]+>/g, '')             // overige HTML-tags weggooien
    .replace(/&amp;/gi, '&')             // HTML-entiteiten decoderen
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&#\d+;/g, '')             // numerieke entiteiten weggooien
    .replace(/\s+/g, ' ')
    .trim();
}

// ---------------------------------------------------------------------------
// LLinkidClient
// ---------------------------------------------------------------------------

class LLinkidClient {
  /**
   * @param {string} baseUrl  API base URL (standaard cached-api.katholiekonderwijs.vlaanderen)
   */
  constructor(baseUrl = DEFAULT_BASE) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    /** @type {Map<string, {data: any, ts: number}>} In-memory cache met TTL */
    this._cache = new Map();
    /** Cache TTL in milliseconden (standaard 1 uur) */
    this._ttl = 60 * 60 * 1000;
  }

  /**
   * Haal een waarde uit de cache, of null als verlopen/niet aanwezig.
   */
  _cacheGet(key) {
    const entry = this._cache.get(key);
    if (!entry) return null;
    if (Date.now() - entry.ts > this._ttl) {
      this._cache.delete(key);
      return null;
    }
    return entry.data;
  }

  /**
   * Bewaar een waarde in de cache met tijdstempel.
   */
  _cacheSet(key, data) {
    this._cache.set(key, { data, ts: Date.now() });
  }

  // -------------------------------------------------------------------------
  // Publieke API
  // -------------------------------------------------------------------------

  /**
   * Haal lijst van curricula op.
   * @param {string|null} zoekterm  Optioneel: filter op titel/identifier
   * @returns {Promise<Array<{uuid, titel, identifier}>>}
   */
  async getLeerplannen(zoekterm = null) {
    const url = `${this.baseUrl}/content/?type=LLINKID_CURRICULUM&limit=5000&expand=summary`;
    const items = await fetchAll(url, this);

    const resultaten = items.map(item => {
      const body = extractBody(item);
      const identifiers = body.identifiers || [];
      const ident = identifiers.join(', ');
      const key = body.key || (item.href || '').replace(/\/$/, '').split('/').pop();
      return {
        uuid: key,
        titel: normalizeText(body.title || body.description || ''),
        identifier: normalizeText(ident),
      };
    });

    if (!zoekterm) return resultaten;

    const q = zoekterm.toLowerCase();
    return resultaten.filter(r =>
      r.titel.toLowerCase().includes(q) || r.identifier.toLowerCase().includes(q)
    );
  }

  /**
   * Haal metadata op van één leerplan.
   * @param {string} uuid
   * @returns {Promise<{uuid, titel, identifier, versie, datum}>}
   */
  async getLeerplanDetail(uuid) {
    const url = `${this.baseUrl}/content/${uuid}`;

    let data = this._cacheGet(url);
    if (!data) {
      data = await httpGet(url);
      this._cacheSet(url, data);
    }

    const body = extractBody(data);
    const identifiers = body.identifiers || [];

    return {
      uuid,
      titel: normalizeText(body.title || body.description || ''),
      identifier: identifiers.join(', '),
      versie: body.version || {},
      datum: String(body.issued || '').slice(0, 10),
    };
  }

  /**
   * Haal de volledige boom op voor een curriculum (gecached).
   * @param {string} uuid
   * @returns {Promise<Array>}  Alle nodes
   */
  async _getBoom(uuid) {
    const cacheKey = `boom:${uuid}`;
    const cached = this._cacheGet(cacheKey);
    if (cached) return cached;

    const url = `${this.baseUrl}/content/?root=${uuid}&limit=5000`;
    const items = await fetchAll(url, this);
    const nodes = items.map(extractBody);
    this._cacheSet(cacheKey, nodes);
    return nodes;
  }

  /**
   * Haal hiërarchische doelen op voor een curriculum.
   *
   * Elke node heeft:
   *   - key        {string}   UUID van de node
   *   - type       {string}   'goal' | 'section'
   *   - titel      {string}   Beschrijving/titel
   *   - nr         {string}   Identifier (bv. "1", "2")
   *   - depth      {number}   Diepte in de boom (0 = root)
   *   - is_goal    {boolean}
   *   - is_section {boolean}
   *   - parentKey  {string|null}
   *
   * @param {string} uuid
   * @returns {Promise<Array<{key, type, titel, nr, depth, is_goal, is_section, parentKey}>>}
   */
  async getDoelen(uuid) {
    const nodes = await this._getBoom(uuid);

    // Bouw een map key → node voor snel opzoeken
    const keyMap = new Map();
    for (const node of nodes) {
      const key = node.key;
      if (key) keyMap.set(key, node);
    }

    // Extraheer parent-key via IS_PART_OF relatie
    function getParentKey(node) {
      for (const rel of (node.$$relationsFrom || [])) {
        const exp = rel.$$expanded || rel;
        if (exp.relationtype === 'IS_PART_OF') {
          const href = (exp.to || {}).href || '';
          if (href) return href.replace(/\/$/, '').split('/').pop();
        }
      }
      return null;
    }

    // Bereken diepte via parent-keten
    const depthMap = new Map();
    function getDepth(key) {
      if (depthMap.has(key)) return depthMap.get(key);
      const node = keyMap.get(key);
      if (!node) { depthMap.set(key, 0); return 0; }
      const parentKey = getParentKey(node);
      if (!parentKey) { depthMap.set(key, 0); return 0; }
      const d = getDepth(parentKey) + 1;
      depthMap.set(key, d);
      return d;
    }

    const GOAL_TYPES = new Set([
      'LLINKID_GOAL',
      'LLINKID_GOAL_LIST',
    ]);
    const SECTION_TYPES = new Set([
      'LLINKID_GOAL_SECTION',
      'SECTION',
    ]);

    const resultaat = [];

    for (const node of nodes) {
      const t = node.type || '';
      const isGoal = GOAL_TYPES.has(t);
      const isSection = SECTION_TYPES.has(t);

      if (!isGoal && !isSection) continue;

      const identifiers = node.identifiers || [];
      const nr = identifiers.join(', ');
      const titel = normalizeText(node.description || node.title || '');
      const key = node.key || '';
      const parentKey = getParentKey(node);
      const depth = key ? getDepth(key) : 0;

      resultaat.push({
        key,
        type: isGoal ? 'goal' : 'section',
        titel,
        nr,
        depth,
        is_goal: isGoal,
        is_section: isSection,
        parentKey,
        goalType: node.llinkidGoalType || 'REGULAR',
      });
    }

    // Sorteer: sections voor goals, dan op nr (numeriek waar mogelijk)
    resultaat.sort((a, b) => {
      // Eerst op diepte zodat de boom logisch geordend is
      if (a.depth !== b.depth) return a.depth - b.depth;
      // Dan op nr
      const nrA = parseInt(a.nr) || 0;
      const nrB = parseInt(b.nr) || 0;
      return nrA - nrB;
    });

    return resultaat;
  }

  /**
   * Shorthand: zoek leerplannen op een query-string.
   * @param {string} query
   * @returns {Promise<Array>}
   */
  async zoekLeerplannen(query) {
    return this.getLeerplannen(query);
  }
}

module.exports = { LLinkidClient };
