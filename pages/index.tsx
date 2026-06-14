// ============================================================================
// DIE GANZE OBERFLAECHE (eine Datei).
// - Watchlist wird im Browser gespeichert (localStorage), keine Datenbank.
// - Button "Daten aktualisieren": fragt die Aktien NACHEINANDER ab (mit kurzer
//   Pause wegen API-Limit) und ruft dafuer /api/quote auf.
// - Styling steht unten im <style>-Block.
// ============================================================================

import { useEffect, useRef, useState } from "react";

// Wartezeit zwischen zwei Aktien (8 s -> sicher unter 8 Abfragen/Minute).
const DELAY_MS = 8000;
const LS_WATCHLIST = "aktienscore_watchlist";
const LS_RESULTS = "aktienscore_results";

// Start-Watchlist (18 Aktien).
const DEFAULT_WATCHLIST: { symbol: string; name: string }[] = [
  { symbol: "AAPL", name: "Apple" },
  { symbol: "MSFT", name: "Microsoft" },
  { symbol: "NVDA", name: "NVIDIA" },
  { symbol: "GOOGL", name: "Alphabet" },
  { symbol: "AMZN", name: "Amazon" },
  { symbol: "META", name: "Meta Platforms" },
  { symbol: "TSLA", name: "Tesla" },
  { symbol: "AMD", name: "AMD" },
  { symbol: "ASML", name: "ASML" },
  { symbol: "SAP", name: "SAP" },
  { symbol: "NFLX", name: "Netflix" },
  { symbol: "AVGO", name: "Broadcom" },
  { symbol: "COST", name: "Costco" },
  { symbol: "LLY", name: "Eli Lilly" },
  { symbol: "JPM", name: "JPMorgan" },
  { symbol: "V", name: "Visa" },
  { symbol: "MA", name: "Mastercard" },
  { symbol: "UNH", name: "UnitedHealth" },
];

// Ergebnis einer Aktie (vom Server). Wir halten es bewusst locker (any-frei,
// aber simpel) als optionale Felder.
interface QuoteResult {
  ok: boolean;
  symbol: string;
  error?: string;
  code?: string;
  status?: string;
  dataPoints?: number;
  closePrice?: number | null;
  lastDate?: string | null;
  totalScore?: number | null;
  trendScore?: number | null;
  momentumScore?: number | null;
  riskScore?: number | null;
  volumeScore?: number | null;
  assessment?: string;
}

interface Row {
  symbol: string;
  name: string;
  loading: boolean;
  result: QuoteResult | null;
}

function scoreColor(score: number | null | undefined): string {
  if (score === null || score === undefined) return "#475569";
  if (score < 30) return "#ef4444";
  if (score < 50) return "#f97316";
  if (score < 65) return "#eab308";
  if (score < 80) return "#84cc16";
  return "#22c55e";
}
function fmt(v: number | null | undefined): string {
  return v === null || v === undefined ? "-" : v.toFixed(1);
}
function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export default function Home() {
  const [rows, setRows] = useState<Row[]>([]);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [message, setMessage] = useState<{ type: string; text: string } | null>(null);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [newSymbol, setNewSymbol] = useState("");
  const cancelRef = useRef(false);

  // Beim Start aus dem Browser-Speicher laden.
  useEffect(() => {
    let watchlist = DEFAULT_WATCHLIST;
    try {
      const saved = localStorage.getItem(LS_WATCHLIST);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) watchlist = parsed;
      }
    } catch {}
    let stored: { updatedAt?: string; bySymbol?: Record<string, QuoteResult> } = {};
    try {
      const r = localStorage.getItem(LS_RESULTS);
      if (r) stored = JSON.parse(r);
    } catch {}
    setRows(
      watchlist.map((w) => ({
        symbol: w.symbol,
        name: w.name,
        loading: false,
        result: stored.bySymbol?.[w.symbol] ?? null,
      }))
    );
    if (stored.updatedAt) setUpdatedAt(stored.updatedAt);
  }, []);

  function saveWatchlist(items: Row[]) {
    try {
      localStorage.setItem(
        LS_WATCHLIST,
        JSON.stringify(items.map((r) => ({ symbol: r.symbol, name: r.name })))
      );
    } catch {}
  }
  function saveResults(items: Row[], when: string) {
    const bySymbol: Record<string, QuoteResult> = {};
    for (const r of items) if (r.result && r.result.ok) bySymbol[r.symbol] = r.result;
    try {
      localStorage.setItem(LS_RESULTS, JSON.stringify({ updatedAt: when, bySymbol }));
    } catch {}
  }

  function addStock(e: React.FormEvent) {
    e.preventDefault();
    const symbol = newSymbol.trim().toUpperCase();
    if (!symbol || !/^[A-Z0-9.\-]{1,10}$/.test(symbol)) {
      setMessage({ type: "error", text: "Bitte ein gueltiges Ticker-Symbol eingeben (z. B. AAPL)." });
      return;
    }
    if (rows.some((r) => r.symbol === symbol)) {
      setMessage({ type: "error", text: `"${symbol}" ist bereits in der Liste.` });
      return;
    }
    const next = [...rows, { symbol, name: symbol, loading: false, result: null }].sort((a, b) =>
      a.symbol.localeCompare(b.symbol)
    );
    setRows(next);
    saveWatchlist(next);
    setNewSymbol("");
    setMessage({ type: "success", text: `"${symbol}" hinzugefuegt. Jetzt "Daten aktualisieren" klicken.` });
  }

  function removeStock(symbol: string) {
    if (!confirm(`"${symbol}" aus der Liste entfernen?`)) return;
    const next = rows.filter((r) => r.symbol !== symbol);
    setRows(next);
    saveWatchlist(next);
    saveResults(next, updatedAt ?? new Date().toISOString());
  }

  async function updateData() {
    if (rows.length === 0) {
      setMessage({ type: "error", text: "Keine Aktien in der Liste." });
      return;
    }
    cancelRef.current = false;
    setRunning(true);
    setProgress({ done: 0, total: rows.length });
    const estMin = Math.ceil((rows.length * DELAY_MS) / 60000);
    setMessage({
      type: "info",
      text: `Kursdaten werden geladen (ca. ${estMin} Min wegen API-Limit). Fenster offen lassen.`,
    });

    let working = [...rows];
    let rateLimited = false;
    let errorCount = 0;

    for (let i = 0; i < working.length; i++) {
      if (cancelRef.current) break;
      const symbol = working[i].symbol;
      working = working.map((r) => (r.symbol === symbol ? { ...r, loading: true } : r));
      setRows([...working]);

      try {
        const res = await fetch("/api/quote", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ symbol }),
        });
        const data = (await res.json()) as QuoteResult;
        working = working.map((r) => (r.symbol === symbol ? { ...r, loading: false, result: data } : r));
        setRows([...working]);
        if (!data.ok) {
          errorCount++;
          if (data.code === "RATE_LIMIT") { rateLimited = true; break; }
          if (data.code === "MISSING_API_KEY") { setMessage({ type: "error", text: data.error || "API-Key fehlt." }); break; }
        }
      } catch {
        errorCount++;
        working = working.map((r) =>
          r.symbol === symbol
            ? { ...r, loading: false, result: { ok: false, symbol, error: "Netzwerkfehler.", code: "NETWORK" } }
            : r
        );
        setRows([...working]);
      }

      setProgress({ done: i + 1, total: working.length });
      const isLast = i === working.length - 1;
      if (!isLast && !cancelRef.current) await sleep(DELAY_MS);
    }

    const when = new Date().toISOString();
    setUpdatedAt(when);
    saveResults(working, when);
    setRunning(false);

    if (cancelRef.current) setMessage({ type: "info", text: "Abruf abgebrochen." });
    else if (rateLimited)
      setMessage({ type: "error", text: "API-Limit erreicht. 1-2 Minuten warten und erneut klicken." });
    else if (errorCount > 0)
      setMessage({ type: "error", text: `Fertig - ${errorCount} Aktie(n) mit Fehler (siehe Tabelle).` });
    else setMessage({ type: "success", text: "Alle Kursdaten aktualisiert und Scores berechnet." });
  }

  const pct = progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0;

  return (
    <main className="container">
      <header>
        <h1>Aktien-Score Dashboard</h1>
        <p>Watchlist, Kursdaten und technischer Score (0-100).</p>
      </header>

      <div className="disclaimer">
        Privates Lern- und Analyseprojekt. <strong>Keine Finanzberatung</strong>,{" "}
        <strong>keine Kaufempfehlung</strong>. Die Scores koennen falsch sein.
      </div>

      <div className="toolbar">
        <button className="btn btn-primary" onClick={updateData} disabled={running}>
          {running && <span className="spinner" />}
          Daten aktualisieren
        </button>
        {running && (
          <button className="btn" onClick={() => (cancelRef.current = true)}>
            Abbrechen
          </button>
        )}
        {updatedAt && !running && (
          <span className="muted small">
            Zuletzt: {new Date(updatedAt).toLocaleString("de-DE")}
          </span>
        )}
      </div>

      {running && (
        <div className="progress-wrap">
          <div className="progress-bar">
            <div className="progress-fill" style={{ width: `${pct}%` }} />
          </div>
          <div className="muted small">{progress.done} / {progress.total} Aktien abgefragt</div>
        </div>
      )}

      <form className="add-form" onSubmit={addStock}>
        <input
          className="symbol"
          placeholder="Ticker (z. B. AAPL)"
          value={newSymbol}
          onChange={(e) => setNewSymbol(e.target.value)}
          maxLength={10}
          disabled={running}
        />
        <button className="btn" type="submit" disabled={running}>Aktie hinzufuegen</button>
      </form>

      {message && <div className={`message ${message.type}`}>{message.text}</div>}

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th className="left">Symbol</th>
              <th>Kurs</th>
              <th>Gesamt</th>
              <th>Trend</th>
              <th>Mom.</th>
              <th>Risk</th>
              <th>Vol.</th>
              <th>Datenstand</th>
              <th className="left">Einschaetzung</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td colSpan={10} className="left muted pad">Keine Aktien. Oben einen Ticker hinzufuegen.</td></tr>
            )}
            {rows.map((row) => {
              const r = row.result;
              const ok = r && r.ok;
              const dp = ok ? r!.dataPoints ?? 0 : 0;
              const tooFew = ok && dp < 20;
              const notFull = ok && dp >= 20 && dp < 60;
              return (
                <tr key={row.symbol}>
                  <td className="left">
                    <div className="sym">{row.symbol}</div>
                    {row.name && row.name !== row.symbol && <div className="nm">{row.name}</div>}
                  </td>
                  {row.loading ? (
                    <td colSpan={7} className="left"><span className="spinner" /> <span className="muted small">lade...</span></td>
                  ) : !r ? (
                    <td colSpan={7} className="left muted">Noch keine Daten.</td>
                  ) : !r.ok ? (
                    <td colSpan={7} className="left err">Fehler: {r.error}</td>
                  ) : (
                    <>
                      <td>{r.closePrice != null ? r.closePrice.toFixed(2) : "-"}</td>
                      <td>
                        {r.totalScore != null ? (
                          <span className="badge" style={{ background: scoreColor(r.totalScore) }}>
                            {r.totalScore.toFixed(0)}
                          </span>
                        ) : (<span className="muted">-</span>)}
                      </td>
                      <td>{fmt(r.trendScore)}</td>
                      <td>{fmt(r.momentumScore)}</td>
                      <td>{fmt(r.riskScore)}</td>
                      <td>{fmt(r.volumeScore)}</td>
                      <td className="muted">{r.lastDate ?? "-"}</td>
                    </>
                  )}
                  {!row.loading && r && r.ok ? (
                    <td className="left">
                      <div>{r.assessment}</div>
                      {tooFew && <div className="warn">Zu wenige Daten ({dp} Tage)</div>}
                      {notFull && <div className="warn">Noch kein voller Score ({dp}/60)</div>}
                    </td>
                  ) : (
                    <td className="left muted">-</td>
                  )}
                  <td>
                    <button className="del" title="Loeschen" onClick={() => removeStock(row.symbol)} disabled={running}>&times;</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="muted small foot">
        Skala: 0-29 sehr schwach, 30-49 schwach, 50-64 neutral, 65-79 interessant, 80-100 sehr stark.
        Deine Liste wird nur in diesem Browser gespeichert.
      </p>

      {/* ----------------------------- STYLING ----------------------------- */}
      <style jsx global>{`
        :root {
          --bg: #0f172a; --panel: #1e293b; --panel2: #273549; --border: #334155;
          --text: #e2e8f0; --muted: #94a3b8; --accent: #38bdf8; --accent2: #0ea5e9;
          --danger: #f87171; --dangerbg: #3f1d1d; --ok: #4ade80; --warn: #fbbf24;
        }
        * { box-sizing: border-box; }
        html, body { margin: 0; padding: 0; background: var(--bg); color: var(--text);
          font-family: system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif; font-size: 15px; }
        .container { max-width: 1080px; margin: 0 auto; padding: 24px 16px 60px; }
        header h1 { margin: 0 0 4px; font-size: 22px; }
        header p { margin: 0; color: var(--muted); font-size: 14px; }
        .small { font-size: 12px; }
        .muted { color: var(--muted); }
        .pad { padding: 20px; }
        .foot { margin-top: 18px; }
        .disclaimer { margin: 16px 0 18px; padding: 10px 14px; background: var(--panel2);
          border: 1px solid var(--border); border-left: 3px solid var(--warn); border-radius: 8px;
          color: var(--muted); font-size: 13px; }
        .toolbar { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; margin-bottom: 14px; }
        .btn { background: var(--panel); color: var(--text); border: 1px solid var(--border);
          padding: 10px 16px; border-radius: 8px; font-size: 14px; cursor: pointer; }
        .btn:hover:not(:disabled) { background: var(--panel2); border-color: var(--accent); }
        .btn:disabled { opacity: .5; cursor: not-allowed; }
        .btn-primary { background: var(--accent2); border-color: var(--accent2); color: #04293a; font-weight: 700; }
        .add-form { display: flex; gap: 8px; margin-bottom: 14px; flex-wrap: wrap; }
        .add-form input { background: var(--panel); border: 1px solid var(--border); color: var(--text);
          padding: 10px 12px; border-radius: 8px; font-size: 14px; }
        .add-form .symbol { width: 160px; text-transform: uppercase; }
        .progress-wrap { margin: 6px 0 14px; }
        .progress-bar { height: 8px; background: var(--panel2); border: 1px solid var(--border);
          border-radius: 999px; overflow: hidden; }
        .progress-fill { height: 100%; background: var(--accent2); transition: width .3s; }
        .message { padding: 10px 14px; border-radius: 8px; margin-bottom: 14px; font-size: 14px;
          border: 1px solid var(--border); }
        .message.error { background: var(--dangerbg); border-color: var(--danger); color: #fecaca; }
        .message.success { background: #14331f; border-color: var(--ok); color: #bbf7d0; }
        .message.info { background: var(--panel2); color: var(--muted); }
        .table-wrap { overflow-x: auto; border: 1px solid var(--border); border-radius: 10px; }
        table { width: 100%; border-collapse: collapse; font-size: 14px; min-width: 760px; }
        thead th { text-align: right; padding: 11px 12px; background: var(--panel2); color: var(--muted);
          font-weight: 600; border-bottom: 1px solid var(--border); white-space: nowrap; }
        thead th.left, tbody td.left { text-align: left; }
        tbody td { text-align: right; padding: 10px 12px; border-bottom: 1px solid var(--border); white-space: nowrap; }
        tbody tr:last-child td { border-bottom: none; }
        tbody tr:hover { background: var(--panel); }
        .sym { font-weight: 700; }
        .nm { color: var(--muted); font-size: 12px; }
        .badge { display: inline-block; min-width: 42px; text-align: center; padding: 3px 8px;
          border-radius: 999px; font-weight: 700; color: #04201a; }
        .warn { color: var(--warn); font-size: 12px; }
        .err { color: var(--danger); }
        .del { background: transparent; border: none; color: var(--danger); cursor: pointer;
          font-size: 18px; line-height: 1; padding: 2px 6px; border-radius: 6px; }
        .del:hover { background: var(--dangerbg); }
        .spinner { display: inline-block; width: 14px; height: 14px; border: 2px solid var(--muted);
          border-top-color: transparent; border-radius: 50%; animation: spin .7s linear infinite;
          vertical-align: -2px; margin-right: 4px; }
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>
    </main>
  );
}
