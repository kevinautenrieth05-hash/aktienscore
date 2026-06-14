# Aktien-Score Dashboard

Eine kleine Web-App: Link öffnen, auf **„Daten aktualisieren"** drücken, und für jede Aktie deiner Watchlist erscheint ein **Score von 0 bis 100** (einfache, regelbasierte technische Einschätzung).

> **Kein Finanzrat.** Lern- und Analyseprojekt. Keine Finanzberatung, keine Kaufempfehlung. Die Scores können falsch sein.

## Online stellen (Kurzfassung)

1. Kostenlosen API-Key bei **twelvedata.com** holen (keine Kreditkarte nötig).
2. Diese Dateien zu **GitHub** hochladen.
3. Bei **Vercel** importieren und den Key als Umgebungsvariable `TWELVE_DATA_API_KEY` eintragen.
4. Vercel-Link öffnen und benutzen.

Die ausführliche Klick-für-Klick-Anleitung bekommst du im Chat.

## Wie der Score funktioniert

```
GesamtScore = Trend × 0,35 + Momentum × 0,30 + Risk × 0,20 + Volume × 0,15
```

- **Trend** (max 100): +35 Kurs über SMA20, +35 Kurs über SMA50, +30 SMA20 über SMA50.
- **Momentum** (0–100): Schnitt der Performance über 5/20/60 Tage. 0 % = 50 Punkte; ±1 % = ±2,5 Punkte.
- **Risk** (0–100): Schwankung (Volatilität) der letzten 30 Tage. Ruhig = hoher Score.
- **Volume** (0–100): Kurs hoch + viel Volumen = 80; runter + viel Volumen = 20; sonst 50.

Einschätzung: 0–29 sehr schwach, 30–49 schwach, 50–64 neutral, 65–79 interessant, 80–100 sehr stark.
Ab 60 Handelstagen voller Score, bei 20–59 vorläufig, unter 20 „zu wenige Daten".

## Lokal testen (optional)

Node.js 18.18+ installieren, dann im Ordner:

```
npm install
```

`.env`-Datei mit `TWELVE_DATA_API_KEY=dein_key` anlegen, dann:

```
npm run dev
```

und http://localhost:3000 öffnen.

## Dateien

```
aktienscore/
├─ package.json
├─ tsconfig.json
├─ next.config.js
└─ pages/
   ├─ index.tsx       # die ganze Oberfläche
   └─ api/quote.ts    # holt Kurse + berechnet Score (Server)
```

Privates Lernprojekt. Nutzung auf eigene Verantwortung. Keine Finanzberatung.
