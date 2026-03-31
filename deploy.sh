#!/bin/bash

# Plesk Deployment Script
# Automatisch uitgevoerd na git pull via webhook
# Installeert dependencies en herstart de Passenger applicatie

set -e  # Zet script af bij eerste fout

# Configuratie
DEPLOY_PATH="/var/www/vhosts/JOUWDOMEIN/httpdocs/bk-attestering"
APP_NAME="bk-attestering"
VENV_PATH="${DEPLOY_PATH}/venv"

# Kleur codes voor output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'  # No Color

echo -e "${YELLOW}[INFO]${NC} Deploy gestart voor ${APP_NAME}"

# Naar deploy directory gaan
cd "${DEPLOY_PATH}" || {
    echo -e "${RED}[ERROR]${NC} Kon niet naar ${DEPLOY_PATH} gaan"
    exit 1
}

# Virtualenv activeren
if [ ! -d "${VENV_PATH}" ]; then
    echo -e "${YELLOW}[INFO]${NC} Virtualenv niet gevonden, aanmaken..."
    python3 -m venv "${VENV_PATH}"
fi

source "${VENV_PATH}/bin/activate"

# Dependencies installeren
echo -e "${YELLOW}[INFO]${NC} Dependencies installeren..."
pip install -r requirements.txt --quiet

# Passenger herstart (Plesk monitort tmp/restart.txt voor reload)
echo -e "${YELLOW}[INFO]${NC} Passenger herstarten..."
mkdir -p tmp
touch tmp/restart.txt

# Logs schrijven
TIMESTAMP=$(date '+%Y-%m-%d %H:%M:%S')
echo "[${TIMESTAMP}] Deploy succesvol: branch=$(git rev-parse --abbrev-ref HEAD), commit=$(git rev-parse --short HEAD)" >> deploy.log

echo -e "${GREEN}[SUCCESS]${NC} Deploy geslaagd op ${TIMESTAMP}"
