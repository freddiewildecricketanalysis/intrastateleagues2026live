// Netlify serverless function.
// Runs on Netlify's servers, NEVER in the browser — so the API token below
// stays private. It fetches your live CricViz stats and hands back JSON in
// the shape the dashboard expects, at the URL /api/stats (see netlify.toml
// for that rewrite).
//
// Set these two values in Netlify: Site settings -> Environment variables
//   STATS_API_URL    your CricViz query URL
//   STATS_API_TOKEN  the full Authorization header value, e.g. "Basic xxxxx..."
//
// Never put either value directly in this file or anywhere in the repo.

exports.handler = async function (event, context) {
  const API_URL = process.env.STATS_API_URL;
  const API_TOKEN = process.env.STATS_API_TOKEN;

  if (!API_URL || !API_TOKEN) {
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        error: 'Server is missing STATS_API_URL or STATS_API_TOKEN. Set them in Netlify: Site settings -> Environment variables, then redeploy.'
      })
    };
  }

  try {
    const upstream = await fetch(API_URL, {
      headers: {
        Authorization: API_TOKEN,
        Accept: 'application/json'
      }
    });

    if (!upstream.ok) {
      const text = await upstream.text().catch(() => '');
      return {
        statusCode: upstream.status,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: `Upstream API returned ${upstream.status}`, detail: text.slice(0, 500) })
      };
    }

    const raw = await upstream.json();
    const mapped = mapCricvizToDashboard(raw);

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        // cache at the CDN edge for 5 minutes so we're not hammering CricViz
        'Cache-Control': 'public, max-age=300'
      },
      body: JSON.stringify(mapped)
    };
  } catch (err) {
    return {
      statusCode: 502,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Failed to reach upstream API', detail: String(err) })
    };
  }
};

// ---- CricViz -> dashboard field mapping ----
// CricViz returns { rows, found_rows, columns, result: [ {...} ] } with every
// value as a string.
//
// Per-tournament ave/sr/bave/econ/bsr come straight from CricViz's own
// pre-computed columns (trustworthy, matches what CricViz itself reports).
// Raw counts (runs, balls_faced, wickets, balls, conceded, innings) are also
// included so the dashboard can total them correctly across tournaments in
// the "All Tournaments" combined view. CricViz's "notouts" field can be
// fractional for players grouped across multiple batting-hand/bowling-
// technique splits, so it's carried through as-is but not relied on for the
// authoritative per-tournament average.

function mapCricvizToDashboard(apiData) {
  const rows = Array.isArray(apiData.result) ? apiData.result : [];
  const compMap = new Map(); // full name -> short name

  const records = rows.map(r => {
    const compFull = r.comp || null;
    if (compFull && !compMap.has(compFull)) {
      compMap.set(compFull, compFull.replace(/,\s*\d{4}$/, ''));
    }

    const runsVal = num(r.runs);
    const innsVal = num(r.innings);
    const battingAvgRaw = parseFloat(r.batting_average);

    // CricViz's own "notouts" can be fractional and doesn't always reconcile
    // with their own batting_average (an artifact of how they split stats
    // across batting-hand/bowling-technique groupings). To keep the combined
    // "All Tournaments" view consistent with each single-tournament view, we
    // back-derive not-outs from CricViz's own average instead of trusting
    // their raw notouts value: dismissals = runs / average.
    let noAdjusted = num(r.notouts);
    if (!Number.isNaN(battingAvgRaw) && battingAvgRaw > 0 && runsVal > 0) {
      const dismissals = runsVal / battingAvgRaw;
      noAdjusted = innsVal - dismissals;
    }

    return {
      player: r.player_known_as,
      team: r.team || null,
      comp: compFull,
      hand: r.batting_hand || null,
      tech: r.bowling_technique || null,
      age: parseStartAge(r.start_age),

      // raw counts, used for combined-view totals across tournaments
      inns: innsVal,
      no: noAdjusted,
      runs: runsVal,
      bf: num(r.balls_faced),
      binns: num(r.innings_bowled),
      balls: num(r.balls),
      brs: num(r.conceded),
      wkts: num(r.wickets),

      // CricViz's own pre-computed stats, used directly for single-tournament views
      ave: roundOrNull(r.batting_average, 0),
      sr: roundOrNull(r.batting_strike_rate, 0),
      bave: roundOrNull(r.bowling_average, 0),
      econ: roundOrNull(r.economy_rate, 2),
      bsr: roundOrNull(r.bowling_strike_rate, 1)
    };
  });

  const tournaments = Array.from(compMap.entries()).map(([full, short]) => ({ full, short }));

  return { tournaments, records };
}

function num(v) {
  if (v === null || v === undefined || v === '-') return 0;
  const n = parseFloat(v);
  return Number.isNaN(n) ? 0 : n;
}

function roundOrNull(v, decimals) {
  if (v === null || v === undefined || v === '-') return null;
  const n = parseFloat(v);
  if (Number.isNaN(n)) return null;
  const m = Math.pow(10, decimals);
  return Math.round(n * m) / m;
}

function parseStartAge(s) {
  if (typeof s !== 'string') return null;
  const m = s.match(/(\d+)y/);
  return m ? parseInt(m[1], 10) : null;
}
