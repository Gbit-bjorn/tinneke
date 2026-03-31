from flask import render_template, request, session, redirect, url_for, flash
from blueprints.auth import auth_bp
from config import Config


@auth_bp.route("/login", methods=["GET", "POST"])
def login():
    if session.get("logged_in"):
        return redirect(url_for("index"))

    error = None
    if request.method == "POST":
        username = request.form.get("username", "").strip()
        password = request.form.get("password", "")

        if username == Config.APP_USERNAME and password == Config.APP_PASSWORD:
            session["logged_in"] = True
            session["username"] = username
            next_url = request.args.get("next")
            return redirect(next_url or url_for("index"))

        error = "Ongeldige gebruikersnaam of wachtwoord."

    return render_template("auth/login.html", error=error)


@auth_bp.route("/logout")
def logout():
    session.clear()
    return redirect(url_for("auth.login"))
