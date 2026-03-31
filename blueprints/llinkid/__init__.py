from flask import Blueprint

llinkid_bp = Blueprint(
    "llinkid",
    __name__,
    url_prefix="/llinkid",
    template_folder="../../templates/llinkid",
)

from blueprints.llinkid import routes  # noqa: E402, F401
