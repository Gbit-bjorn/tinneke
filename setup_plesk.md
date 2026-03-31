# Plesk Deployment Handleiding - BK Attestering

Deze handleiding beschrijft hoe je de Flask applicatie "BK Attestering" op een Plesk server (Linux) implementeert met automatische deployment via GitHub webhooks.

## Vereisten

- Plesk panel toegang (administrator)
- GitHub account met repository toegang
- Basis shell/terminal kennis
- Domain/subdomain beschikbaar (bv. attestering.jouwdomein.be)

## Stap 1: Subdomain aanmaken in Plesk

1. **Log in** op je Plesk panel
2. Ga naar **Domeinen** of **Websites**
3. Klik op je **hoofddomein** (bv. jouwdomein.be)
4. Selecteer **Subdomein toevoegen** (of **Add domain**)
5. Vul in:
   - **Subdomein naam**: `attestering` (wordt `attestering.jouwdomein.be`)
   - Laat andere instellingen op standaard
6. Klik **OK** → Plesk maakt de documentroot aan (bijv. `/var/www/vhosts/jouwdomein.be/subdomains/attestering`)

## Stap 2: Python applicatie configureren in Plesk

1. **Ga terug** naar Plesk dashboard
2. Klik op je **nieuwe subdomain** (`attestering.jouwdomein.be`)
3. Zoek sectie **Applicatieserver** of **Python**
4. Zorg dat **Python is ingeschakeld** (versie 3.11 of hoger)
5. Stel in:
   - **Application startup file**: `passenger_wsgi.py` (of het volledige pad: `/var/www/vhosts/.../httpdocs/passenger_wsgi.py`)
   - **Document root**: de `httpdocs/` map van je subdomain
6. Klik **OK** of **Apply**

## Stap 3: Git repository aanmaken in Plesk

### 3a. Repository clonen via SSH/Plesk Interface

**Via Plesk Git Extension** (makkelijkste):
1. Ga naar je subdomain in Plesk
2. Zoek sectie **Git**
3. Klik **Git-Repository initialiseren** (of **Initialize**) → Dit maakt een leeg repo
4. Selecteer **Remote repository toevoegen** of **Add remote**
5. Vul in:
   - **URL**: `https://github.com/jouwusername/bk-dk-lpd.git` (je GitHub URL)
   - **Branch**: `main`
   - Klik **OK**

### 3b. Handmatig (via SSH)

Via een terminal/SSH client:
```bash
ssh user@jouwdomein.be
cd /var/www/vhosts/jouwdomein.be/subdomains/attestering/httpdocs

# Git clonen (vervang door je eigen URL)
git clone https://github.com/jouwusername/bk-dk-lpd.git .

# Of als de directory al inhoud heeft:
# git init
# git remote add origin https://github.com/jouwusername/bk-dk-lpd.git
# git pull origin main
```

## Stap 4: Virtualenv en dependencies

Voer dit uit via **SSH/Terminal**:

```bash
# SSH in je server (contact je hostingprovider voor SSH details)
ssh user@jouwdomein.be

# Ga naar je applicatie directory
cd /var/www/vhosts/jouwdomein.be/subdomains/attestering/httpdocs

# Maak Python virtualenv
python3 -m venv venv

# Activeer virtualenv
source venv/bin/activate

# Installeer dependencies uit requirements.txt
pip install -r requirements.txt

# Maak tmp folder aan (voor Passenger herstart)
mkdir -p tmp
```

**Controle**: Je ziet nu `(venv)` in je terminal prompt.

## Stap 5: Environment variabelen (.env)

1. **Lokaal** (`web/.env.example` kopie aanmaken):
   ```bash
   cd /var/www/vhosts/jouwdomein.be/subdomains/attestering/httpdocs
   cp .env.example .env
   ```

2. **Edit `.env` bestand**:
   ```bash
   nano .env
   # of
   vi .env
   ```

3. **Vul relevante waarden in**, bijv.:
   ```
   FLASK_ENV=production
   WISA_API_KEY=jouw_api_key_hier
   WISA_API_URL=https://api.wisa.be/...
   # andere configuratie...
   ```

4. **Zorg dat `.env` NIET in Git staat**:
   - Check dat `.gitignore` `.env` bevat (dit is al gedaan)
   - Voer uit: `git status` → `.env` mag NIET listed worden

## Stap 6: Passenger/Plesk permissions

Zorg dat Passenger schrijftoegang heeft:

```bash
# Als nobody/passenger user:
sudo chown -R nobody:nobody /var/www/vhosts/jouwdomein.be/subdomains/attestering/httpdocs

# Of met Plesk account:
sudo chown -R $(whoami):$(whoami) /var/www/vhosts/jouwdomein.be/subdomains/attestering/httpdocs

# Zorg voor juiste permissions:
chmod 755 /var/www/vhosts/jouwdomein.be/subdomains/attestering/httpdocs
chmod 755 /var/www/vhosts/jouwdomein.be/subdomains/attestering/httpdocs/tmp
```

## Stap 7: GitHub Webhook configureren

### 7a. Deploy key aanmaken (SSH authentication)

**Op de Plesk server** (via SSH):
```bash
# SSH key pair aanmaken
ssh-keygen -t ed25519 -f /var/www/vhosts/jouwdomein.be/subdomains/attestering/.ssh/github_deploy_key -C "plesk@jouwdomein"

# Bekijk public key
cat /var/www/vhosts/jouwdomein.be/subdomains/attestering/.ssh/github_deploy_key.pub
```

### 7b. Deploy key toevoegen aan GitHub

1. **Ga naar GitHub**:
   - Repository → Settings → Deploy keys
   - Click **Add deploy key**

2. **Vul in**:
   - **Title**: `Plesk deployment key`
   - **Key**: Plak de **public key** content (uit vorige stap)
   - Check **Allow write access** (als je deployment logs wilt schrijven)
   - Click **Add key**

### 7c. Webhook in GitHub instellen

1. **Repository settings**:
   - Settings → Webhooks → **Add webhook**

2. **Vul in**:
   - **Payload URL**: Vraag dit op in Plesk!
     - Plesk → je subdomain → Git → (koppelinformation)
     - Meestal iets als: `https://jouwdomein.be/api/git-webhook` of wat Plesk aangeeft
   - **Content type**: `application/json`
   - **Events**: Select **Just the push event**
   - **Active**: ✓ Check

3. **Webhook testen**:
   - GitHub → Webhooks → Recent Deliveries
   - Kijk of groene vinkjes verschijnen

## Stap 8: Deploy script instellen

Plesk voert automatisch `deploy.sh` uit na een git pull. **Eenmalig setup**:

1. **Controleer permissions**:
   ```bash
   chmod +x /var/www/vhosts/jouwdomein.be/subdomains/attestering/httpdocs/deploy.sh
   ```

2. **In Plesk** (Git sectie):
   - Zoek **Deploy action** of **Post-deploy script**
   - Vul in: `bash deploy.sh`
   - Klik **OK**

## Stap 9: Eerste deployment testen

### Test via GitHub:

1. **Git wijziging** (lokaal):
   ```bash
   git add .
   git commit -m "Test deployment"
   git push origin main
   ```

2. **Controleer in Plesk**:
   - Plesk → je subdomain → Git → Git log
   - Kijk voor de nieuwe commit en deployment status

3. **Controleer in browser**:
   - Ga naar `https://attestering.jouwdomein.be`
   - Controleer dat pagina laadt

### Troubleshooting:

- **Webhook failed**: Check GitHub Webhooks → Recent Deliveries → error details
- **Deploy script error**: Check `deploy.log` in de app directory:
  ```bash
  tail -f /var/www/vhosts/.../httpdocs/deploy.log
  ```
- **Python import errors**: Check of alle dependencies geïnstalleerd:
  ```bash
  source venv/bin/activate
  python -c "import flask; print(flask.__version__)"
  ```
- **Passenger niet herstart**: Zorg dat `touch tmp/restart.txt` werkt (permissions)

## Stap 10: Monitoren en onderhouden

### Logs bekijken:

```bash
# Plesk/Passenger logs:
tail -f /var/log/plesk/apache2/domains/attestering.jouwdomein.be.error.log
tail -f /var/log/plesk/apache2/domains/attestering.jouwdomein.be.access.log

# Python applicatie logs (als je logging configureert):
tail -f /var/www/vhosts/.../httpdocs/app.log
```

### Database backups:

```bash
# SQLite database backuppen:
cp /var/www/vhosts/.../httpdocs/*.db /backup/location/

# Of automatisch (cron):
0 2 * * * cp /var/www/.../httpdocs/app.db /backup/$(date +\%Y\%m\%d).db
```

### Updates installeren:

```bash
cd /var/www/vhosts/jouwdomein.be/subdomains/attestering/httpdocs
source venv/bin/activate
pip install --upgrade -r requirements.txt
touch tmp/restart.txt
```

## Checklist na setup

- [ ] Subdomain aangemaakt in Plesk
- [ ] Python applicatie ingeschakeld met `passenger_wsgi.py`
- [ ] Git repository gekoppeld aan GitHub
- [ ] Virtualenv aangemaakt en dependencies geïnstalleerd
- [ ] `.env` bestand aangemaakt met configuratie
- [ ] Deploy key en GitHub webhook ingesteld
- [ ] `deploy.sh` script executable
- [ ] Eerste commit/push succesvol gedeployd
- [ ] Website bereikbaar op `https://attestering.jouwdomein.be`
- [ ] Logs controleren op errors

## Contact & Support

Bij vragen:
- Controleer Plesk documentatie: https://docs.plesk.com/
- GitHub webhook debugging: https://docs.github.com/en/developers/webhooks-and-events/webhooks/testing-webhooks
- Flask deployment: https://flask.palletsprojects.com/deployment/

---

**Versie**: 1.0
**Laatste update**: 2026-03-31
