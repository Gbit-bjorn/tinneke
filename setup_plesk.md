# Plesk Deployment Handleiding — Node.js Express App

Deze handleiding beschrijft hoe je de Tinneke-app op een Linux-server met Plesk deployt.

## 1. Node.js App Aanmaken in Plesk

1. Log in op Plesk
2. Klik op **Websites & Domains**
3. Selecteer je domein
4. Klik op **Node.js** (onder *Applications*)
5. Vul in:
   - **Enable Node.js:** Aanvinken
   - **Node.js version:** Selecteer 18 LTS of hoger
   - **Document root:** Wijzig naar `web/` (of het pad waar je app staat)
   - **Application startup file:** `server.js`
6. Klik **OK**

Plesk zal nu de Node.js omgeving instellen en Passenger configureren.

## 2. Environment File Aanmaken

1. Verbind met de server via SSH (of gebruik Plesk File Manager)
2. Navigeer naar je app-folder: `/var/www/vhosts/your-domain.com/web/`
3. Maak een `.env` bestand aan met deze inhoud:

```
SECRET_KEY=jouw_willekeurige_sleutel_hier
APP_USERNAME=admin
APP_PASSWORD=jouw_wachtwoord_hier
DATABASE_PATH=/var/www/vhosts/your-domain.com/data/tinneke.db
```

**Let op:**
- `PORT` **niet** instellen — Passenger injecteert die automatisch
- Zorg ervoor dat de database-map `/data/` bestaat en schrijfbaar is
- Maak de `.env` bestand **niet** in een openbare map (dit gebeurt automatisch bij gebruik van `web/`)

## 3. Dependencies Installeren

### Via SSH:
```bash
cd /var/www/vhosts/your-domain.com/web/
npm install --production
```

### Via Plesk File Manager:
1. Ga naar **Files** → je domein → `web/`
2. Selecteer de folder
3. Zoek naar een "Terminal" of "SSH" optie (sommige Plesk-versies)
4. Voer het commando hierboven uit

**Waarschuwing:** Als je `better-sqlite3` gebruikt, kan `npm install` falen zonder build tools. Zorg dat gcc/g++ geïnstalleerd is:
```bash
sudo apt-get install build-essential python3
```

## 4. GitHub Webhook Instellen

### Stap 1: Git Repository in Plesk Koppelen

1. In Plesk, klik op **Extensions** (of **Git**)
2. Klik op **Git Repository**
3. Klik **Add Repository**
4. Vul in:
   - **Repository URL:** `git@github.com:Gbit-bjorn/tinneke.git`
   - **Path:** `/var/www/vhosts/your-domain.com/web/`
   - **Deploy script:** `bash deploy.sh`
   - **Branch:** `main` (of je default branch)
5. Klik **OK**

Plesk toont je nu de **webhook URL** — kopieer deze!

### Stap 2: GitHub Webhook Toevoegen

1. Ga naar je GitHub repository
2. **Settings** → **Webhooks** → **Add webhook**
3. Vul in:
   - **Payload URL:** (plak de URL van Plesk)
   - **Content type:** `application/json`
   - **Events:** Selecteer alleen "push events"
   - **Active:** Aanvinken
4. Klik **Add webhook**

GitHub zal nu elke keer dat je pushed een webhook sturen naar Plesk, waarna `deploy.sh` wordt uitgevoerd.

## 5. App Starten

1. In Plesk, ga terug naar **Node.js**
2. Klik op **Restart app** (of **Graceful restart**)
3. Controleer of de app start door naar je domein te gaan in je browser

Als er fouten zijn:
- Klik op **Show logs** in de Node.js sectie
- Check het **Error log** onder **/var/www/vhosts/..../logs/**

## 6. Troubleshooting

### App start niet
- **Logs controleren:** Plesk → Logs → Apache error log en Node.js-logs
- **Port-probleem:** Zorg dat `PORT` **niet** in `.env` staat — Passenger voegt deze in
- **Build-tools:** `npm install` mislukt? Installeer `build-essential`:
  ```bash
  sudo apt-get install build-essential python3
  ```

### Database niet gevonden
- Zorg dat het pad in `.env` klopt
- Check rechten: `ls -la /var/www/vhosts/your-domain.com/data/`
- Database moet leesbaar en schrijfbaar zijn voor de www-data user

### Webhook triggert niet
- Controleer de webhook logs in GitHub → repo → Settings → Webhooks → je webhook
- Zorg dat de Plesk webhook URL correct is
- Test via GitHub: klik op de webhook → "Recent Deliveries" → "Redeliver"

### Crash na deploy
- `deploy.sh` voert `npm install --production` uit
- Controleer dat alle node_modules correct geïnstalleerd zijn
- Check logs: `tail -f /var/www/vhosts/.../logs/error_log`

## 7. Verdere Stappen (Optioneel)

### SSL/HTTPS Activeren
- Plesk → Websites & Domains → je domein → SSL/TLS Certificates
- Let's Encrypt gratis certificaat is beschikbaar

### PM2 of Forever (voor extra stabiliteit)
Als je app vaker crasht, kun je PM2 gebruiken in plaats van Passenger:
```bash
npm install -g pm2
pm2 start server.js --name tinneke
pm2 startup
pm2 save
```

Update dan je `deploy.sh`:
```bash
#!/bin/bash
set -e
cd "$(dirname "$0")"
npm install --production --quiet
pm2 restart tinneke --update-env
echo "[$(date)] Deploy succesvol"
```

---

**Vragen?** Check het Plesk Help Center of je hosting provider's documentatie.
