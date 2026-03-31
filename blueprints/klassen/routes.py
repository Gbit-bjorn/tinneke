from flask import render_template, request, session, redirect, url_for, flash
from blueprints.klassen import klassen_bp
from database import Database
import os

db = Database(os.environ.get("DATABASE_PATH", "bk_dpk_lpd_web.db"))


def login_required_redirect():
    """Hulpfunctie: geef redirect terug als niet ingelogd, anders None."""
    if not session.get("logged_in"):
        return redirect(url_for("auth.login", next=request.url))
    return None


# ── Dashboard (lijst van klassen) ──────────────────────────────────────────

@klassen_bp.route("/", endpoint="dashboard")
def dashboard():
    check = login_required_redirect()
    if check:
        return check

    klassen = db.get_all_klassen()
    return render_template("dashboard.html", klassen=klassen)


# Alias: /klassen/ → dashboard
@klassen_bp.route("")
def index_redirect():
    return redirect(url_for("klassen.dashboard"))


# ── Klas detail ────────────────────────────────────────────────────────────

@klassen_bp.route("/<int:klas_id>", endpoint="detail")
def detail(klas_id):
    check = login_required_redirect()
    if check:
        return check

    klas = db.get_klas(klas_id)
    if not klas:
        flash("Klas niet gevonden.", "error")
        return redirect(url_for("klassen.dashboard"))

    leerlingen = db.get_leerlingen(klas_id)
    return render_template("klassen/detail.html", klas=klas, leerlingen=leerlingen)


# ── Attesteer leerling ─────────────────────────────────────────────────────

@klassen_bp.route("/<int:klas_id>/leerling/<int:leerling_id>/attesteer", endpoint="attesteer")
def attesteer(klas_id, leerling_id):
    check = login_required_redirect()
    if check:
        return check

    # Placeholder – uitgewerkt wanneer attest-logica beschikbaar is
    flash("Attest-functie is nog in ontwikkeling.", "info")
    return redirect(url_for("klassen.detail", klas_id=klas_id))


# ── Nieuwe klas aanmaken ───────────────────────────────────────────────────

@klassen_bp.route("/nieuw", methods=["GET", "POST"], endpoint="nieuw")
def nieuw():
    check = login_required_redirect()
    if check:
        return check

    if request.method == "POST":
        naam      = request.form.get("naam", "").strip()
        richting  = request.form.get("richting", "").strip()
        schooljaar = request.form.get("schooljaar", "").strip()

        if not naam:
            flash("Geef een klasnaam op.", "error")
            return render_template("klassen/nieuw.html")

        klas_id = db.create_klas(naam=naam, richting=richting, schooljaar=schooljaar)
        flash(f"Klas '{naam}' aangemaakt.", "success")
        return redirect(url_for("klassen.detail", klas_id=klas_id))

    return render_template("klassen/nieuw.html")


# ── CSV importeren ─────────────────────────────────────────────────────────

@klassen_bp.route("/<int:klas_id>/importeer", methods=["GET", "POST"], endpoint="importeer")
def importeer(klas_id):
    check = login_required_redirect()
    if check:
        return check

    klas = db.get_klas(klas_id)
    if not klas:
        flash("Klas niet gevonden.", "error")
        return redirect(url_for("klassen.dashboard"))

    if request.method == "POST":
        overschrijven = request.form.get("overschrijven") == "1"
        skip_header   = request.form.get("skip_header") == "1"

        # Bepaal de CSV-inhoud: bestand of geplakte tekst
        csv_inhoud = ""
        bestand = request.files.get("csv_bestand")
        if bestand and bestand.filename:
            csv_inhoud = bestand.read().decode("utf-8-sig", errors="replace")
        else:
            csv_inhoud = request.form.get("csv_tekst", "").strip()

        if not csv_inhoud:
            flash("Geen CSV-inhoud ontvangen. Upload een bestand of plak de tekst.", "warning")
            return render_template("klassen/import_csv.html", klas=klas)

        # Verwerk de regels
        regels = csv_inhoud.splitlines()
        if skip_header and regels:
            regels = regels[1:]

        leerlingen = []
        fouten = []
        for i, rij in enumerate(regels, start=1):
            rij = rij.strip()
            if not rij:
                continue
            delen = rij.split(";")
            if len(delen) < 2:
                fouten.append(f"Rij {i}: '{rij}' — verwacht naam;voornaam")
                continue
            leerlingen.append({
                "naam":     delen[0].strip(),
                "voornaam": delen[1].strip(),
            })

        if fouten:
            for fout in fouten[:5]:   # toon max 5 fouten
                flash(fout, "warning")

        if not leerlingen:
            flash("Geen geldige leerlingenrijen gevonden.", "error")
            return render_template("klassen/import_csv.html", klas=klas)

        # Sla op in database
        if overschrijven:
            db.delete_leerlingen(klas_id)

        db.bulk_insert_leerlingen(klas_id, leerlingen)
        flash(f"{len(leerlingen)} leerlingen succesvol geïmporteerd.", "success")
        return redirect(url_for("klassen.detail", klas_id=klas_id))

    return render_template("klassen/import_csv.html", klas=klas)
