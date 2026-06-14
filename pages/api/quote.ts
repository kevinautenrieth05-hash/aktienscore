// ============================================================================
// SERVER-TEIL: holt die Kurse EINER Aktie von Twelve Data und berechnet die
// Scores. Laeuft auf dem Server -> dein API-Key bleibt geheim, keine
// Browser-Blockade (CORS).
//
// Aufruf vom Browser:  POST /api/quote   Body: { "symbol": "AAPL" }
//
// WICHTIG: keine Finanzberatung, nur eine einfache technische Einschaetzung.
// ============================================================================

import type { NextApiRequest, NextApiResponse } from "next";

// ---------------------------------------------------------------------------
// Typen
// ---------------------------------------------------------------------------
interface Candle {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}
type DataStatus = "full" | "preliminary" | "insufficient" | "no_data";

// ---------------------------------------------------------------------------
// Kleine Mathe-Helfer
// ---------------------------------------------------------------------------
function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}
function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}
function sma(closes: number[], period: number): number | null {
  if (closes.length < period) return null;
  return average(closes.slice(closes.length - period));
}
function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

// ---------------------------------------------------------------------------
// 1) TREND (max 100): +35 Kurs>SMA20, +35 Kurs>SMA50, +30 SMA20>SMA50
// ---------------------------------------------------------------------------
function trendScore(closes: number[]): number {
  const last = closes[closes.length - 1];
  const s20 = sma(closes, 20);
  const s50 = sma(closes, 50);
  let score = 0;
  if (s20 !== null && last > s20) score += 35;
  if (s50 !== null && last > s50) score += 35;
  if (s20 !== null && s50 !== null && s20 > s50) score += 30;
  return clamp(score, 0, 100);
}

// ---------------------------------------------------------------------------
// 2) MOMENTUM (0..100): Schnitt der Performance ueber 5/20/60 Tage.
//    0 % -> 50 Punkte; +1 % -> +2.5; -1 % -> -2.5. clamp(0,100).
// ---------------------------------------------------------------------------
function perfPct(closes: number[], lookback: number): number | null {
  if (closes.length <= lookback) return null;
  const now = closes[closes.length - 1];
  const past = closes[closes.length - 1 - lookback];
  if (past === 0) return null;
  return ((now - past) / past) * 100;
}
function momentumScore(closes: number[]): number {
  const returns: number[] = [];
  for (const h of [5, 20, 60]) {
    const r = perfPct(closes, h);
    if (r !== null) returns.push(r);
  }
  if (returns.length === 0) return 50;
  return clamp(50 + average(returns) * 2.5, 0, 100);
}

// ---------------------------------------------------------------------------
// 3) RISK (0..100): Volatilitaet der Tagesrenditen (letzte 30 Tage).
//    Niedrige Vola -> hoch. Score = 100 - Vola% * 25. clamp(0,100).
// ---------------------------------------------------------------------------
function stdev(values: number[]): number {
  if (values.length < 2) return 0;
  const m = average(values);
  return Math.sqrt(average(values.map((v) => (v - m) ** 2)));
}
function riskScore(closes: number[]): number {
  const rets: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    if (closes[i - 1] !== 0)
      rets.push(((closes[i] - closes[i - 1]) / closes[i - 1]) * 100);
  }
  const recent = rets.slice(Math.max(0, rets.length - 30));
  if (recent.length < 2) return 50;
  return clamp(100 - stdev(recent) * 25, 0, 100);
}

// ---------------------------------------------------------------------------
// 4) VOLUME (0..100): aktuelles Volumen vs. 20-Tage-Schnitt + Kursrichtung.
//    hoch+viel Volumen -> 80; runter+viel Volumen -> 20; sonst 50.
// ---------------------------------------------------------------------------
function volumeScore(candles: Candle[]): number {
  if (candles.length < 2) return 50;
  const last = candles[candles.length - 1];
  const prev = candles[candles.length - 2];
  const avgVol = average(
    candles.slice(Math.max(0, candles.length - 20)).map((c) => c.volume)
  );
  if (avgVol === 0) return 50;
  const up = last.close > prev.close;
  const aboveAvg = last.volume > avgVol;
  if (aboveAvg && up) return 80;
  if (aboveAvg && !up) return 20;
  return 50;
}

// ---------------------------------------------------------------------------
// Gesamt-Score + Datenmengen-Pruefung
//   <20 Tage -> insufficient | 20..59 -> preliminary | >=60 -> full
// ---------------------------------------------------------------------------
function calcScores(candles: Candle[]) {
  const n = candles.length;
  if (n === 0) {
    return {
      status: "no_data" as DataStatus,
      closePrice: null,
      lastDate: null,
      dataPoints: 0,
      totalScore: null,
      trendScore: null,
      momentumScore: null,
      riskScore: null,
      volumeScore: null,
    };
  }
  const lastDate = candles[n - 1].date;
  const closePrice = candles[n - 1].close;
  if (n < 20) {
    return {
      status: "insufficient" as DataStatus,
      closePrice,
      lastDate,
      dataPoints: n,
      totalScore: null,
      trendScore: null,
      momentumScore: null,
      riskScore: null,
      volumeScore: null,
    };
  }
  const closes = candles.map((c) => c.close);
  const t = trendScore(closes);
  const m = momentumScore(closes);
  const r = riskScore(closes);
  const v = volumeScore(candles);
  const total = t * 0.35 + m * 0.3 + r * 0.2 + v * 0.15;
  return {
    status: (n >= 60 ? "full" : "preliminary") as DataStatus,
    closePrice,
    lastDate,
    dataPoints: n,
    totalScore: round1(total),
    trendScore: round1(t),
    momentumScore: round1(m),
    riskScore: round1(r),
    volumeScore: round1(v),
  };
}

// ---------------------------------------------------------------------------
// Text-Einschaetzung
// ---------------------------------------------------------------------------
function assessment(score: number | null, status: DataStatus): string {
  if (status === "no_data") return "Keine Daten";
  if (status === "insufficient") return "Zu wenige Daten";
  if (score === null) return "Kein Score";
  let label: string;
  if (score < 30) label = "sehr schwach";
  else if (score < 50) label = "schwach";
  else if (score < 65) label = "neutral";
  else if (score < 80) label = "interessant";
  else label = "sehr stark";
  return status === "preliminary" ? `${label} (vorlaeufig)` : label;
}

// ---------------------------------------------------------------------------
// Twelve-Data-Abruf (eine Aktie)
// ---------------------------------------------------------------------------
interface TDValue {
  datetime: string;
  open: string;
  high: string;
  low: string;
  close: string;
  volume: string;
}
interface TDResponse {
  status?: "ok" | "error";
  code?: number;
  message?: string;
  values?: TDValue[];
}

async function fetchCandles(
  symbol: string,
  outputSize: number,
  apiKey: string
): Promise<{ candles?: Candle[]; error?: string; code?: string }> {
  const url =
    `https://api.twelvedata.com/time_series?symbol=${encodeURIComponent(symbol)}` +
    `&interval=1day&outputsize=${outputSize}&format=JSON&apikey=${encodeURIComponent(apiKey)}`;

  let resp: Response;
  try {
    resp = await fetch(url, { cache: "no-store" });
  } catch {
    return { error: `Netzwerkfehler beim Abruf von ${symbol}.`, code: "NETWORK" };
  }

  let data: TDResponse;
  try {
    data = (await resp.json()) as TDResponse;
  } catch {
    return { error: `Antwort fuer ${symbol} war ungueltig.`, code: "UNKNOWN" };
  }

  if (data.status === "error" || (!resp.ok && !data.values)) {
    const msg = data.message ?? "Unbekannter Fehler von Twelve Data.";
    const code = data.code;
    if (code === 401 || /api key/i.test(msg))
      return { error: `API-Key ungueltig (${symbol}).`, code: "MISSING_API_KEY" };
    if (code === 429 || /limit/i.test(msg))
      return { error: `API-Limit erreicht (${symbol}).`, code: "RATE_LIMIT" };
    if (code === 404 || /not found|invalid|symbol/i.test(msg))
      return { error: `Ticker "${symbol}" nicht gefunden/ungueltig.`, code: "INVALID_SYMBOL" };
    return { error: `${symbol}: ${msg}`, code: "UNKNOWN" };
  }

  if (!data.values || data.values.length === 0) {
    return { error: `Keine Kursdaten fuer ${symbol} gefunden.`, code: "NO_DATA" };
  }

  // Twelve Data liefert neueste zuerst -> drehen auf alt -> neu.
  const candles: Candle[] = data.values
    .map((v) => ({
      date: v.datetime,
      open: Number(v.open),
      high: Number(v.high),
      low: Number(v.low),
      close: Number(v.close),
      volume: Number(v.volume),
    }))
    .reverse();

  return { candles };
}

// ---------------------------------------------------------------------------
// Der eigentliche API-Handler
// ---------------------------------------------------------------------------
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Nur POST erlaubt.", code: "METHOD" });
  }

  const symbol = (req.body?.symbol ?? "").toString().trim().toUpperCase();
  if (!symbol || !/^[A-Z0-9.\-]{1,10}$/.test(symbol)) {
    return res
      .status(400)
      .json({ ok: false, symbol, error: "Ungueltiges Symbol.", code: "INVALID_SYMBOL" });
  }

  const apiKey = process.env.TWELVE_DATA_API_KEY;
  if (!apiKey || apiKey.trim() === "" || apiKey === "hier_deinen_key_eintragen") {
    return res.status(200).json({
      ok: false,
      symbol,
      error: "Kein API-Key gesetzt (TWELVE_DATA_API_KEY in Vercel eintragen).",
      code: "MISSING_API_KEY",
    });
  }

  const historyDays = Number(process.env.PRICE_HISTORY_DAYS ?? 120);
  const { candles, error, code } = await fetchCandles(symbol, historyDays, apiKey.trim());

  if (error || !candles) {
    return res.status(200).json({ ok: false, symbol, error, code });
  }

  const result = calcScores(candles);
  return res
    .status(200)
    .json({ ok: true, symbol, ...result, assessment: assessment(result.totalScore, result.status) });
}
