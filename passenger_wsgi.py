"""
Plesk WSGI entry point voor Flask applicatie.
Passenger web server zal dit bestand gebruiken als applicatie entry point.
"""
import sys
import os

# Virtualenv activeren
venv_path = os.path.join(os.path.dirname(__file__), 'venv')
if os.path.exists(venv_path):
    activate_this = os.path.join(venv_path, 'bin', 'activate_this.py')
    if os.path.exists(activate_this):
        with open(activate_this) as f:
            exec(f.read(), {'__file__': activate_this})

# Project directory toevoegen aan Python path
sys.path.insert(0, os.path.dirname(__file__))

# Flask app importeren en gebruiken
from app import create_app

# Plesk/Passenger expects een 'application' object
application = create_app()
