"""
Export routes voor BK/DPK/LPD Attestatiesysteem.

Routes:
  GET /export/<leerling_id>/html   → download HTML attestering rapport
  GET /export/<leerling_id>/excel  → download Excel rapport (openpyxl)
  GET /export/klas/<klas_id>/excel → klasoverzicht Excel
"""

import os
from flask import (
    send_file, redirect, url_for, session, jsonify,
    request
)
from functools import wraps
from datetime import datetime
from io import BytesIO

from blueprints.export import export_bp
from blueprints.export.generators import (
    genereer_html_attestering,
    genereer_excel_attestering,
    genereer_excel_klasoverzicht
)


def _require_login(f):
    """Decorator for login check. Redirects to auth.login if not logged in."""
    @wraps(f)
    def decorated(*args, **kwargs):
        if not session.get("logged_in"):
            return redirect(url_for("auth.login", next=request.url))
        return f(*args, **kwargs)
    return decorated


def _get_database():
    """Instantiate Database from config."""
    from web.database import Database
    db_path = os.environ.get('DATABASE_PATH', 'bk_dpk_lpd.db')
    return Database(db_path)


def _get_llinkid_client():
    """Instantiate LLinkidClient."""
    from blueprints.llinkid.api_client import LLinkidClient
    base_url = "https://api.katholiekonderwijs.vlaanderen"
    return LLinkidClient(base_url)


@export_bp.route("/<int:leerling_id>/html", methods=["GET"])
@_require_login
def export_html(leerling_id: int):
    """
    Download HTML attestering rapport voor een leerling.

    GET /export/<leerling_id>/html
    """
    try:
        db = _get_database()
        client = _get_llinkid_client()

        # Fetch leerling
        leerling = db.get_leerling(leerling_id)
        if not leerling:
            return jsonify({"error": "Leerling niet gevonden"}), 404

        # Fetch klas en leerplan
        klas = db.get_klas(leerling['klas_id'])
        leerplan_uuid = db.get_klas_leerplan(leerling['klas_id'])

        if not leerplan_uuid:
            return jsonify({"error": "Geen leerplan gekoppeld aan deze klas"}), 400

        # Fetch doelen van LLinkid
        try:
            doelen = client.get_doelen(leerplan_uuid)
        except Exception as e:
            # Fallback: use dummy doelen
            doelen = []

        # Fetch resultaten (get_lpd_resultaten returns dict directly)
        resultaten_dict = db.get_lpd_resultaten(leerling_id)

        # Genereer HTML
        html = genereer_html_attestering(leerling, doelen, resultaten_dict)

        # Return als download
        naam = f"{leerling['voornaam']}_{leerling['naam']}".replace(" ", "_")
        return send_file(
            BytesIO(html.encode('utf-8')),
            mimetype='text/html; charset=utf-8',
            as_attachment=True,
            download_name=f"attestering_{naam}.html"
        )

    except Exception as e:
        return jsonify({"error": str(e)}), 500


@export_bp.route("/<int:leerling_id>/excel", methods=["GET"])
@_require_login
def export_excel(leerling_id: int):
    """
    Download Excel attestering rapport voor een leerling.

    GET /export/<leerling_id>/excel
    """
    try:
        db = _get_database()
        client = _get_llinkid_client()

        # Fetch leerling
        leerling = db.get_leerling(leerling_id)
        if not leerling:
            return jsonify({"error": "Leerling niet gevonden"}), 404

        # Fetch klas en leerplan
        klas = db.get_klas(leerling['klas_id'])
        leerplan_uuid = db.get_klas_leerplan(leerling['klas_id'])

        if not leerplan_uuid:
            return jsonify({"error": "Geen leerplan gekoppeld aan deze klas"}), 400

        # Fetch doelen van LLinkid
        try:
            doelen = client.get_doelen(leerplan_uuid)
        except Exception as e:
            doelen = []

        # Fetch resultaten (get_lpd_resultaten returns dict directly)
        resultaten_dict = db.get_lpd_resultaten(leerling_id)

        # Genereer Excel
        excel_bytes = genereer_excel_attestering(leerling, doelen, resultaten_dict)

        # Return als download
        naam = f"{leerling['voornaam']}_{leerling['naam']}".replace(" ", "_")
        return send_file(
            BytesIO(excel_bytes),
            mimetype='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            as_attachment=True,
            download_name=f"attestering_{naam}.xlsx"
        )

    except Exception as e:
        return jsonify({"error": str(e)}), 500


@export_bp.route("/klas/<int:klas_id>/excel", methods=["GET"])
@_require_login
def export_klas_excel(klas_id: int):
    """
    Download Excel klasoverzicht met percentages per leerling × BK.

    GET /export/klas/<klas_id>/excel
    """
    try:
        db = _get_database()

        # Fetch klas
        klas = db.get_klas(klas_id)
        if not klas:
            return jsonify({"error": "Klas niet gevonden"}), 404

        # Fetch leerlingen
        leerlingen = db.get_leerlingen(klas_id)
        if not leerlingen:
            return jsonify({"error": "Geen leerlingen in deze klas"}), 400

        # Bereken stats per leerling
        stats = []
        for leerling in leerlingen:
            # Get all results for this student (returns dict {lpd_uuid: behaald})
            resultaten_dict = db.get_lpd_resultaten(leerling['id'])
            behaald_count = sum(1 for behaald in resultaten_dict.values() if behaald)
            totaal_count = len(resultaten_dict)
            totaal_pct = (behaald_count / totaal_count * 100) if totaal_count > 0 else 0

            stat = {
                'bk_percentages': {},
                'totaal_percentage': totaal_pct
            }
            stats.append(stat)

        # Genereer Excel
        excel_bytes = genereer_excel_klasoverzicht(klas, leerlingen, stats)

        # Return als download
        klas_naam = klas.get('naam', f"klas_{klas_id}").replace(" ", "_")
        return send_file(
            BytesIO(excel_bytes),
            mimetype='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            as_attachment=True,
            download_name=f"klasoverzicht_{klas_naam}.xlsx"
        )

    except Exception as e:
        return jsonify({"error": str(e)}), 500
