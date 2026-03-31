from flask import render_template, request, session, redirect, url_for, jsonify, flash
from blueprints.llinkid import llinkid_bp
from blueprints.llinkid.api_client import LLinkidClient
import urllib.error

_client = LLinkidClient()


def _login_required():
    if not session.get("logged_in"):
        return redirect(url_for("auth.login"))
    return None


@llinkid_bp.route("/")
def index():
    redir = _login_required()
    if redir:
        return redir

    zoekterm = request.args.get("q", "").strip()
    fout = None
    leerplannen = []

    try:
        leerplannen = _client.get_leerplannen(zoekterm=zoekterm or None)
    except (urllib.error.URLError, OSError) as e:
        fout = f"API niet bereikbaar: {e}"
    except Exception as e:
        fout = f"Onverwachte fout: {e}"

    return render_template(
        "llinkid/index.html",
        leerplannen=leerplannen,
        zoekterm=zoekterm,
        fout=fout,
    )


@llinkid_bp.route("/<uuid>")
def detail(uuid):
    redir = _login_required()
    if redir:
        return redir

    fout = None
    leerplan = None

    try:
        leerplan = _client.get_leerplan_detail(uuid)
    except urllib.error.HTTPError as e:
        if e.code == 404:
            fout = "Leerplan niet gevonden."
        else:
            fout = f"API-fout: {e.code}"
    except (urllib.error.URLError, OSError) as e:
        fout = f"API niet bereikbaar: {e}"
    except Exception as e:
        fout = f"Onverwachte fout: {e}"

    return render_template("llinkid/detail.html", leerplan=leerplan, fout=fout, uuid=uuid)


@llinkid_bp.route("/<uuid>/doelen")
def doelen(uuid):
    redir = _login_required()
    if redir:
        return redir

    fout = None
    doelen_boom = []
    leerplan = None

    try:
        leerplan = _client.get_leerplan_detail(uuid)
        doelen_boom = _client.get_doelen(uuid)
    except urllib.error.HTTPError as e:
        fout = f"API-fout: {e.code}"
    except (urllib.error.URLError, OSError) as e:
        fout = f"API niet bereikbaar: {e}"
    except Exception as e:
        fout = f"Onverwachte fout: {e}"

    return render_template(
        "llinkid/detail.html",
        leerplan=leerplan,
        doelen=doelen_boom,
        fout=fout,
        uuid=uuid,
        toon_doelen=True,
    )


@llinkid_bp.route("/<uuid>/koppel", methods=["POST"])
def koppel(uuid):
    redir = _login_required()
    if redir:
        return redir

    klas_id = request.form.get("klas_id", "").strip()
    if not klas_id:
        flash("Selecteer een klas.", "error")
        return redirect(url_for("llinkid.detail", uuid=uuid))

    flash(f"Leerplan gekoppeld aan klas {klas_id}.", "success")
    return redirect(url_for("llinkid.detail", uuid=uuid))


@llinkid_bp.route("/api/doelen/<uuid>")
def api_doelen(uuid):
    redir = _login_required()
    if redir:
        return jsonify({"fout": "Niet ingelogd"}), 401

    try:
        doelen_boom = _client.get_doelen(uuid)
        return jsonify(doelen_boom)
    except urllib.error.HTTPError as e:
        return jsonify({"fout": f"API-fout: {e.code}"}), e.code
    except (urllib.error.URLError, OSError) as e:
        return jsonify({"fout": f"API niet bereikbaar: {e}"}), 503
    except Exception as e:
        return jsonify({"fout": str(e)}), 500
