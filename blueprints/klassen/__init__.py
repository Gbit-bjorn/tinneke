from flask import Blueprint

klassen_bp = Blueprint("klassen", __name__, url_prefix="/klassen")

from blueprints.klassen import routes  # noqa: E402, F401
