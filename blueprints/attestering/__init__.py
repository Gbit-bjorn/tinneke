from flask import Blueprint

attestering_bp = Blueprint(
    "attestering",
    __name__,
    url_prefix="/attestering",
    template_folder="../../templates/attestering",
)

from blueprints.attestering import routes  # noqa: E402, F401
