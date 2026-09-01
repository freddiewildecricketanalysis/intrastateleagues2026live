// Netlify serverless function.
// Runs on Netlify's servers, NEVER in the browser — so the API token below
// stays private. It fetches your live stats API and hands the JSON back to
// the dashboard at the URL /api/stats (see netlify.toml for that rewrite).
//
// Set these two values in Netlify: Site settings -> Environment variables
//   STATS_API_URL    e.g. https://your-api.example.com/v1/stats
//   STATS_API_TOKEN  your secret Bearer token
//
// Never put the token directly in this file or anywhere in the repo.

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
        Authorization: `Bearer ${API_TOKEN}`,
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

    const data = await upstream.json();

    // ---- Optional: map your API's field names to the dashboard's shape ----
    // The dashboard expects: { tournaments: [{full, short}], records: [ {...} ] }
    // with each record having: player, team, comp, hand, tech, age,
    // inns, no, runs, bf, ave, sr, binns, balls, brs, wkts, bave, econ, bsr
    // If your API already returns exactly this shape, just pass it through.
    // If not, transform it here before returning, e.g.:
    //
    // const mapped = {
    //   tournaments: data.tournaments,
    //   records: data.records.map(r => ({
    //     player: r.playerName,
    //     team: r.teamName,
    //     comp: r.leagueName,
    //     ...
    //   }))
    // };
    // return { statusCode: 200, body: JSON.stringify(mapped), headers: {...} };

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        // cache at the CDN edge for 5 minutes so you're not hammering your API
        'Cache-Control': 'public, max-age=300'
      },
      body: JSON.stringify(data)
    };
  } catch (err) {
    return {
      statusCode: 502,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Failed to reach upstream API', detail: String(err) })
    };
  }
};
