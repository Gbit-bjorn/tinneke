"""
Attestering routes voor de BK/DPK/LPD web app.

Endpoints:
    GET  /attestering/<leerling_id>          — overzichtspagina
    POST /attestering/<leerling_id>/toggle   — toggle één LPD (AJAX/JSON)
    POST /attestering/<leerling_id>/opslaan  — bulk opslaan
    GET  /attestering/<leerling_id>/status   — JSON stats BK/DPK/LPD
"""

import os

from flask import abort, jsonify, redirect, render_template, request, session, url_for

from blueprints.attestering import attestering_bp
from blueprints.llinkid.api_client import LLinkidClient
from database import Database

_DB_PATH = os.environ.get("DATABASE_PATH", "bk_dpk_lpd_web.db")
_LLINKID_BASE = os.environ.get("LLINKID_BASE_URL", "https://cached-api.katholiekonderwijs.vlaanderen")


def _get_db() -> Database:
    return Database(_DB_PATH)


def _login_vereist():
    """Stuur niet-ingelogde gebruikers naar de loginpagina."""
    if not session.get("logged_in"):
        abort(401)


# ── Helpers ────────────────────────────────────────────────────────────────────

def _bereken_stats(doelen: list[dict], resultaten: dict[str, bool]) -> dict:
    """
    Berekent BK/DPK/LPD statistieken op basis van de LLinkid doelenstructuur
    en de opgeslagen resultaten van de leerling.

    De doelenlijst uit LLinkidClient.get_doelen() is een platte lijst met
    depth-veld. Secties (is_section=True) fungeren als BK/DPK-niveau,
    doelen (is_goal=True) als LPD-niveau.

    Returns een dict:
    {
        "bks": [
            {
                "key": str,
                "titel": str,
                "totaal": int,
                "behaald": int,
                "percentage": float,
                "dpks": [
                    {
                        "key": str,
                        "titel": str,
                        "totaal": int,
                        "behaald": int,
                        "percentage": float,
                        "lpds": [
                            {"key": str, "nr": str, "titel": str, "behaald": bool}
                        ]
                    }
                ]
            }
        ],
        "totaal": int,
        "behaald": int,
        "percentage": float,
    }
    """
    # Bouw hiërarchie op vanuit de platte lijst.
    # Strategie: depth 0 = root (curriculum zelf, overslaan),
    # depth 1 = BK-sectie, depth 2 = DPK-sectie, rest = doelen.
    # Als er geen secties zijn (alles is doel), tonen we één "BK" met alle doelen.

    bks: list[dict] = []
    huidige_bk: dict | None = None
    huidige_dpk: dict | None = None

    def _nieuw_bk(node: dict) -> dict:
        return {
            "key": node["key"],
            "titel": node["titel"] or node["nr"] or node["key"],
            "nr": node["nr"],
            "dpks": [],
        }

    def _nieuw_dpk(node: dict) -> dict:
        return {
            "key": node["key"],
            "titel": node["titel"] or node["nr"] or node["key"],
            "nr": node["nr"],
            "lpds": [],
        }

    def _nieuw_lpd(node: dict) -> dict:
        return {
            "key": node["key"],
            "nr": node["nr"],
            "titel": node["titel"],
            "behaald": resultaten.get(node["key"], False),
        }

    # Maak een standaard BK/DPK aan als de structuur geen secties heeft
    fallback_bk = {"key": "_root", "titel": "Leerplandoelstellingen", "nr": "", "dpks": []}
    fallback_dpk = {"key": "_dpk", "titel": "Doelen", "nr": "", "lpds": []}
    heeft_secties = any(d["is_section"] for d in doelen)

    if not heeft_secties:
        fallback_bk["dpks"].append(fallback_dpk)
        bks.append(fallback_bk)
        huidige_bk = fallback_bk
        huidige_dpk = fallback_dpk

    for node in doelen:
        if node["is_section"]:
            if node["depth"] <= 1:
                # BK-niveau
                huidige_bk = _nieuw_bk(node)
                bks.append(huidige_bk)
                huidige_dpk = None
            else:
                # DPK-niveau (of dieper)
                huidige_dpk = _nieuw_dpk(node)
                if huidige_bk is not None:
                    huidige_bk["dpks"].append(huidige_dpk)

        elif node["is_goal"]:
            lpd = _nieuw_lpd(node)

            if huidige_dpk is not None:
                huidige_dpk["lpds"].append(lpd)
            elif huidige_bk is not None:
                # Geen DPK-sectie: maak een impliciete DPK aan
                if not huidige_bk["dpks"]:
                    impl_dpk = {"key": f"_dpk_{huidige_bk['key']}", "titel": huidige_bk["titel"],
                                "nr": "", "lpds": []}
                    huidige_bk["dpks"].append(impl_dpk)
                huidige_bk["dpks"][-1]["lpds"].append(lpd)

    # Bereken statistieken per DPK en BK
    totaal_globaal = 0
    behaald_globaal = 0

    for bk in bks:
        bk_totaal = 0
        bk_behaald = 0
        for dpk in bk["dpks"]:
            dpk_totaal = len(dpk["lpds"])
            dpk_behaald = sum(1 for l in dpk["lpds"] if l["behaald"])
            dpk["totaal"] = dpk_totaal
            dpk["behaald"] = dpk_behaald
            dpk["percentage"] = round(dpk_behaald / dpk_totaal * 100, 1) if dpk_totaal > 0 else 0.0
            bk_totaal += dpk_totaal
            bk_behaald += dpk_behaald
        bk["totaal"] = bk_totaal
        bk["behaald"] = bk_behaald
        bk["percentage"] = round(bk_behaald / bk_totaal * 100, 1) if bk_totaal > 0 else 0.0
        totaal_globaal += bk_totaal
        behaald_globaal += bk_behaald

    return {
        "bks": bks,
        "totaal": totaal_globaal,
        "behaald": behaald_globaal,
        "percentage": round(behaald_globaal / totaal_globaal * 100, 1) if totaal_globaal > 0 else 0.0,
    }


def _stats_compact(stats: dict) -> dict:
    """Versie van stats zonder de volledige LPD-titels (voor JSON responses)."""
    return {
        "totaal": stats["totaal"],
        "behaald": stats["behaald"],
        "percentage": stats["percentage"],
        "bks": [
            {
                "key": bk["key"],
                "titel": bk["titel"],
                "totaal": bk["totaal"],
                "behaald": bk["behaald"],
                "percentage": bk["percentage"],
                "dpks": [
                    {
                        "key": dpk["key"],
                        "titel": dpk["titel"],
                        "totaal": dpk["totaal"],
                        "behaald": dpk["behaald"],
                        "percentage": dpk["percentage"],
                    }
                    for dpk in bk["dpks"]
                ],
            }
            for bk in stats["bks"]
        ],
    }


def _haal_leerplan_doelen(leerplan_uuid: str) -> list[dict]:
    """Haalt doelen op via LLinkid API. Geeft lege lijst bij fout."""
    try:
        client = LLinkidClient(_LLINKID_BASE)
        return client.get_doelen(leerplan_uuid)
    except Exception:
        return []


# ── Routes ─────────────────────────────────────────────────────────────────────

@attestering_bp.get("/<int:leerling_id>")
def detail(leerling_id: int):
    """Attestering overzichtspagina voor één leerling."""
    _login_vereist()

    with _get_db() as db:
        leerling = db.get_leerling(leerling_id)
        if leerling is None:
            abort(404)

        klas = db.get_klas(leerling["klas_id"])
        leerplan_uuid = db.get_klas_leerplan(leerling["klas_id"])
        resultaten = db.get_lpd_resultaten(leerling_id)

    doelen = _haal_leerplan_doelen(leerplan_uuid) if leerplan_uuid else []
    stats = _bereken_stats(doelen, resultaten)

    return render_template(
        "attestering/detail.html",
        leerling=leerling,
        klas=klas,
        leerplan_uuid=leerplan_uuid,
        stats=stats,
        heeft_leerplan=bool(leerplan_uuid and doelen),
    )


@attestering_bp.post("/<int:leerling_id>/toggle")
def toggle(leerling_id: int):
    """
    Toggle één LPD voor een leerling (AJAX JSON endpoint).

    Input JSON:  {"lpd_uuid": "...", "behaald": true/false}
    Output JSON: {"success": true, "bk_stats": {...}, "dpk_stats": {...}}
    """
    _login_vereist()

    data = request.get_json(silent=True)
    if not data or "lpd_uuid" not in data or "behaald" not in data:
        return jsonify({"success": False, "fout": "Ongeldige invoer"}), 400

    lpd_uuid = str(data["lpd_uuid"])
    behaald = bool(data["behaald"])

    with _get_db() as db:
        leerling = db.get_leerling(leerling_id)
        if leerling is None:
            return jsonify({"success": False, "fout": "Leerling niet gevonden"}), 404

        db.toggle_lpd(leerling_id, lpd_uuid, behaald)

        leerplan_uuid = db.get_klas_leerplan(leerling["klas_id"])
        resultaten = db.get_lpd_resultaten(leerling_id)

    doelen = _haal_leerplan_doelen(leerplan_uuid) if leerplan_uuid else []
    stats = _bereken_stats(doelen, resultaten)

    return jsonify({
        "success": True,
        "stats": _stats_compact(stats),
    })


@attestering_bp.post("/<int:leerling_id>/opslaan")
def opslaan(leerling_id: int):
    """
    Sla alle LPD-wijzigingen in bulk op voor een leerling.

    Input JSON: {"resultaten": {"<lpd_uuid>": true/false, ...}}
    Redirect naar detail bij form submit, JSON bij AJAX.
    """
    _login_vereist()

    with _get_db() as db:
        leerling = db.get_leerling(leerling_id)
        if leerling is None:
            abort(404)

        if request.is_json:
            data = request.get_json(silent=True) or {}
            resultaten_raw = data.get("resultaten", {})
        else:
            # Form-gebaseerde submit: checkboxes sturen alleen aangevinkte waarden
            resultaten_raw = {}
            for key, val in request.form.items():
                if key.startswith("lpd_"):
                    lpd_uuid = key[4:]  # strip "lpd_" prefix
                    resultaten_raw[lpd_uuid] = (val.lower() in ("1", "true", "on"))

        resultaten = {k: bool(v) for k, v in resultaten_raw.items()}
        db.bulk_save_lpd(leerling_id, resultaten)

    if request.is_json:
        return jsonify({"success": True})

    return redirect(url_for("attestering.detail", leerling_id=leerling_id))


@attestering_bp.get("/<int:leerling_id>/status")
def status(leerling_id: int):
    """
    Geeft JSON met de huidige BK/DPK/LPD statistieken voor een leerling.

    Output JSON:
    {
        "totaal": int,
        "behaald": int,
        "percentage": float,
        "bks": [{"key", "titel", "totaal", "behaald", "percentage", "dpks": [...]}]
    }
    """
    _login_vereist()

    with _get_db() as db:
        leerling = db.get_leerling(leerling_id)
        if leerling is None:
            return jsonify({"fout": "Leerling niet gevonden"}), 404

        leerplan_uuid = db.get_klas_leerplan(leerling["klas_id"])
        resultaten = db.get_lpd_resultaten(leerling_id)

    doelen = _haal_leerplan_doelen(leerplan_uuid) if leerplan_uuid else []
    stats = _bereken_stats(doelen, resultaten)

    return jsonify(_stats_compact(stats))
