from flask import Flask, session, redirect, url_for
from functools import wraps
from dotenv import load_dotenv
import os

load_dotenv()


def login_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        if not session.get("logged_in"):
            return redirect(url_for("auth.login"))
        return f(*args, **kwargs)
    return decorated


def create_app():
    app = Flask(
        __name__,
        static_folder="static",
        template_folder="templates",
    )

    app.secret_key = os.environ["SECRET_KEY"]

    from blueprints.auth import auth_bp
    app.register_blueprint(auth_bp)

    from blueprints.klassen import klassen_bp
    app.register_blueprint(klassen_bp)

    # Root → dashboard of login
    @app.route("/")
    def index():
        if session.get("logged_in"):
            return redirect(url_for("klassen.dashboard"))
        return redirect(url_for("auth.login"))

    from blueprints.llinkid import llinkid_bp
    app.register_blueprint(llinkid_bp)

    from blueprints.export import export_bp
    app.register_blueprint(export_bp)

    from blueprints.attestering import attestering_bp
    app.register_blueprint(attestering_bp)

    return app


if __name__ == "__main__":
    app = create_app()
    app.run(debug=True)
