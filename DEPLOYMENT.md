# Deployment na Render.com

Návod na nasazení Intercom Canvas aplikace na Render.com.

## Příprava před deploymentem

1. Ujistěte se, že máte účet na [Render.com](https://render.com)
2. Pushněte váš kód do Git repozitáře (GitHub, GitLab, nebo Bitbucket)
3. Připravte si hodnoty pro environment proměnné

## Krok za krokem deployment

### 1. Vytvořte nový Web Service

1. Přihlaste se na [Render Dashboard](https://dashboard.render.com)
2. Klikněte na **"New +"** → **"Web Service"**
3. Připojte váš Git repozitář:
   - Vyberte GitHub/GitLab/Bitbucket
   - Autorizujte Render k přístupu
   - Vyberte repozitář `IntercomKosarAI`

### 2. Konfigurace Web Service

Vyplňte následující údaje:

**Základní nastavení:**
- **Name**: `intercom-kosar-ai` (nebo libovolný název)
- **Region**: Vyberte region nejblíže vašim uživatelům (např. Frankfurt)
- **Branch**: `main` (nebo váš hlavní branch)
- **Root Directory**: nechte prázdné (pokud je projekt v rootu)

**Build & Deploy nastavení:**
- **Runtime**: `Node`
- **Build Command**: `npm install`
- **Start Command**: `npm start`

**Instance Type:**
- **Free** - pro testování
- **Starter ($7/měsíc)** - pro produkci s lepším výkonem

### 3. Nastavení Environment proměnných

V sekci **Environment** přidejte následující proměnné:

```
PORT=3000
API_BASE_URL=https://your-api-endpoint.com
API_TOKEN=your-secret-token-here
NODE_ENV=production
```

Klikněte na **"Add Environment Variable"** pro každou proměnnou.

### 4. Deploy

1. Zkontrolujte všechna nastavení
2. Klikněte na **"Create Web Service"**
3. Render začne buildovat a deployovat vaši aplikaci
4. Sledujte logy v reálném čase

### 5. Ověření deploymentu

Po úspěšném deployu:

1. Render vám poskytne URL: `https://intercom-kosar-ai.onrender.com`
2. Otestujte health endpoint:
```bash
curl https://intercom-kosar-ai.onrender.com/health
```

3. Měli byste dostat odpověď:
```json
{
  "status": "ok",
  "timestamp": "2024-01-01T12:00:00.000Z"
}
```

## Konfigurace v Intercomu

### 1. Nastavení Canvas App v Intercomu

1. V Intercom Dashboard jděte do **Settings** → **App Store**
2. Klikněte na **"Build your own app"**
3. Vyberte **"Canvas Kit"**
4. Vyplňte detaily:
   - **App name**: Váš název
   - **Canvas URL**: `https://intercom-kosar-ai.onrender.com/initialize`
   - **Submit URL** (optional): `https://intercom-kosar-ai.onrender.com/submit`

### 2. Testování v Intercomu

1. Otevřete libovolnou konverzaci v Intercomu
2. Canvas by se měl zobrazit s daty uživatele
3. Zkontrolujte Render logy pro případné errory

## Automatický re-deploy

Render automaticky re-deployuje aplikaci při každém push do hlavního branche:

```bash
git add .
git commit -m "Update feature"
git push origin main
```

Render detekuje změnu a spustí nový build.

## Monitoring & Logs

### Zobrazení logů

1. V Render Dashboard otevřete váš web service
2. Klikněte na **"Logs"** tab
3. Zde vidíte real-time logy

### Metrics

V **"Metrics"** tabu můžete sledovat:
- CPU usage
- Memory usage
- Request count
- Response times

## Custom Domain (volitelné)

Pokud chcete použít vlastní doménu:

1. V Render Dashboard otevřete váš web service
2. Klikněte na **"Settings"** → **"Custom Domain"**
3. Přidejte vaši doménu: `canvas.vasedomena.cz`
4. Nastavte DNS záznamy dle instrukcí Render:
   - Typ: `CNAME`
   - Host: `canvas` (nebo `@` pro root)
   - Value: `intercom-kosar-ai.onrender.com`

## Environment proměnné - Update

Pro update environment proměnných:

1. V Render Dashboard → váš service → **"Environment"**
2. Upravte hodnoty
3. Klikněte **"Save Changes"**
4. Render automaticky restartuje service

## Troubleshooting

### Build selhává

**Chyba:** `Module not found`
- Zkontrolujte `package.json` dependencies
- Ujistěte se, že `npm install` projde lokálně

**Chyba:** `Start command failed`
- Zkontrolujte Start Command: `npm start`
- Ověřte, že `package.json` obsahuje správný script

### Service běží, ale nefunguje

1. Zkontrolujte logy v Render Dashboard
2. Ověřte environment proměnné:
```bash
curl https://your-app.onrender.com/health
```

3. Zkontrolujte API_TOKEN a API_BASE_URL

### Canvas se nezobrazuje v Intercomu

1. Ověřte Canvas URL v Intercom nastavení
2. Zkontrolujte, že endpoint vrací správný Canvas JSON formát
3. Otestujte endpoint pomocí curl:
```bash
curl -X POST https://your-app.onrender.com/initialize \
  -H "Content-Type: application/json" \
  -d '{"context":{"customer":{"email":"test@example.com"}}}'
```

### Pomalé cold start (Free tier)

Free tier na Render.com:
- Usíná po 15 minutách neaktivity
- První request po probuzení trvá 30-60 sekund

**Řešení:**
- Upgrade na Starter plan ($7/měsíc)
- Nebo použijte cron job pro keep-alive ping

## Keep-alive pro Free tier (volitelné)

Pokud používáte Free tier a chcete minimalizovat cold starts:

### Použití externího cron service

1. Registrujte se na [cron-job.org](https://cron-job.org)
2. Vytvořte nový cron job:
   - URL: `https://your-app.onrender.com/health`
   - Interval: každých 10 minut
   - Method: GET

### Nebo použijte UptimeRobot

1. Registrujte se na [UptimeRobot](https://uptimerobot.com)
2. Přidejte nový monitor:
   - Type: HTTP(S)
   - URL: `https://your-app.onrender.com/health`
   - Interval: 5 minut

**Poznámka:** Render Free tier má limit 750 hodin/měsíc. Keep-alive může tento limit vyčerpat.

## Scaling (Paid plans)

Pro větší provoz:

1. V Render Dashboard → **"Settings"** → **"Scaling"**
2. Zvyšte počet instancí (horizontal scaling)
3. Nebo zvolte vyšší instance type (vertical scaling)

## Backup & Recovery

### Database (pokud budete mít)

Render nabízí automatické backupy pro Postgres:
- Free tier: žádné backupy
- Starter plan: denní backupy, 7 dní retention

### Code

Váš kód je v Git repozitáři, takže je automaticky zálohován.

## Ceny Render.com (2024)

- **Free**: $0/měsíc
  - 750 hodin/měsíc
  - Usíná po 15 min neaktivity
  - Sdílené CPU/RAM

- **Starter**: $7/měsíc
  - Vždy aktivní
  - 0.5 CPU, 512 MB RAM
  - Vhodné pro produkci s nízkým/středním provozem

- **Standard**: $25/měsíc
  - 1 CPU, 2 GB RAM
  - Vhodné pro vyšší provoz

## Kontakty & Podpora

- **Render Docs**: https://render.com/docs
- **Intercom Canvas Docs**: https://developers.intercom.com/canvas-kit/
- **Status Page**: https://status.render.com

## Checklist před Go-Live

- [ ] Environment proměnné jsou správně nastavené
- [ ] Health endpoint funguje
- [ ] Intercom Canvas URL je nakonfigurovaná
- [ ] Testováno s reálnými daty
- [ ] Logy jsou čisté bez errorů
- [ ] API token je bezpečný (ne v kódu!)
- [ ] Custom domain nakonfigurována (volitelné)
- [ ] Monitoring je aktivní
- [ ] Team má přístup k Render Dashboard

## Next Steps

Po úspěšném deployu zvažte:

1. Přidat monitoring (Sentry, Datadog)
2. Implementovat rate limiting
3. Přidat caching pro API responses
4. Nastavit alerting pro downtime
5. Pravidelně kontrolovat logy a metriky