(function(){
  let records = [];
  let tournaments = []; // [{full, short}]
  let shortByFull = new Map();

  const DATA_ENDPOINT = '/api/stats';
  const AUTO_REFRESH_MS = 5 * 60 * 1000; // re-poll every 5 minutes; set to 0 to disable

  const state = {
    tab: 'ALL', // 'ALL' or a competition full name
    mode: 'bat', // 'bat' | 'bowl'
    search: '',
    sortKey: null,
    sortDir: 'desc',
    barMetric: null,
    barN: 15,
    scatterMode: 'bat'
  };

  // ---------- helpers ----------
  const fmt = v => (v === null || v === undefined || Number.isNaN(v)) ? '\u2013' : v;
  const fmt2 = v => (v === null || v === undefined || Number.isNaN(v)) ? '\u2013' : v.toFixed(2);
  const fmt1 = v => (v === null || v === undefined || Number.isNaN(v)) ? '\u2013' : v.toFixed(1);

  function round(v, nd){
    if (v === null || v === undefined || Number.isNaN(v)) return null;
    const m = Math.pow(10, nd);
    return Math.round(v * m) / m;
  }

  // ---------- build per-tab dataset ----------
  function rowsForTab(tab){
    if (tab === 'ALL') return aggregateAll();
    return records.filter(r => r.comp === tab);
  }

  let aggCache = null;
  function aggregateAll(){
    if (aggCache) return aggCache;
    const byPlayer = new Map();
    for (const r of records){
      let a = byPlayer.get(r.player);
      if (!a){
        a = {
          player: r.player, teams: new Set(), hand: r.hand, tech: r.tech, age: r.age,
          inns:0, no:0, runs:0, bf:0,
          binns:0, balls:0, brs:0, wkts:0,
          nTourn:0, comps: new Set()
        };
        byPlayer.set(r.player, a);
      }
      if (r.team) a.teams.add(r.team);
      if (r.comp) a.comps.add(shortByFull.get(r.comp) || r.comp);
      if (!a.hand && r.hand) a.hand = r.hand;
      if (!a.tech && r.tech) a.tech = r.tech;
      if (r.age) a.age = r.age;
      a.inns += r.inns; a.no += r.no; a.runs += r.runs; a.bf += r.bf;
      a.binns += r.binns; a.balls += r.balls; a.brs += r.brs; a.wkts += r.wkts;
      a.nTourn += 1;
    }
    const out = [];
    for (const a of byPlayer.values()){
      const dismissals = a.inns - a.no;
      const ave = dismissals > 0 ? round(a.runs / dismissals, 0) : null;
      const sr = a.bf > 0 ? round((a.runs / a.bf) * 100, 0) : null;
      const bave = a.wkts > 0 ? round(a.brs / a.wkts, 0) : null;
      const econ = a.balls > 0 ? round((a.brs / a.balls) * 6, 2) : null;
      const bsr = a.wkts > 0 ? round(a.balls / a.wkts, 1) : null;
      const teamsArr = Array.from(a.teams);
      const compsArr = Array.from(a.comps);
      out.push({
        player: a.player,
        team: teamsArr.length === 0 ? null : (teamsArr.length === 1 ? teamsArr[0] : teamsArr.length + ' teams'),
        teamTitle: teamsArr.join(', '),
        hand: a.hand, tech: a.tech, age: a.age,
        inns: a.inns, no: a.no, runs: a.runs, bf: a.bf, ave, sr,
        binns: a.binns, balls: a.balls, brs: a.brs, wkts: a.wkts, bave, econ, bsr,
        nTourn: a.nTourn, tourn: compsArr.join(', '), tournTitle: compsArr.join(', ')
      });
    }
    aggCache = out;
    return out;
  }

  // ---------- column defs ----------
  const BAT_COLS = [
    {key:'player', label:'Batter', align:'left'},
    {key:'team', label:'Team', align:'left'},
    {key:'hand', label:'Bat Hand', align:'left', fmt: v => v ? cap(v) : '\u2013'},
    {key:'age', label:'Age', fmt: v=>fmt(v)},
    {key:'inns', label:'Inns', fmt: v=>fmt(v)},
    {key:'runs', label:'Runs', fmt: v=>fmt(v), strong:true},
    {key:'ave', label:'Average', fmt: v=>fmt(v)},
    {key:'sr', label:'Strike Rate', fmt: v=>fmt(v)}
  ];
  const BAT_COLS_TOURN = BAT_COLS; // same, "age" applies per tournament snapshot too

  const BOWL_COLS = [
    {key:'player', label:'Bowler', align:'left'},
    {key:'team', label:'Team', align:'left'},
    {key:'tech', label:'Technique', align:'left', fmt: v=> v? cap(v) : '\u2013'},
    {key:'age', label:'Age', fmt: v=>fmt(v)},
    {key:'balls', label:'Balls', fmt: v=>fmt(v)},
    {key:'wkts', label:'Wickets', fmt: v=>fmt(v), strong:true},
    {key:'econ', label:'Economy', fmt: v=>fmt2(v)},
    {key:'bsr', label:'Strike Rate', fmt: v=>fmt1(v)},
    {key:'bave', label:'Average', fmt: v=>fmt(v)}
  ];

  function cap(s){ return s.charAt(0).toUpperCase() + s.slice(1); }

  function getCols(){
    const base = (state.mode === 'bat' ? BAT_COLS : BOWL_COLS).slice();
    if (state.tab === 'ALL'){
      const teamIdx = base.findIndex(c => c.key === 'team');
      if (teamIdx !== -1) base.splice(teamIdx, 1);
      base.splice(1, 0, {key:'tourn', label:'Tournaments', align:'left', fmt: v => v || '\u2013'});
    }
    return base;
  }

  const BAT_METRICS = [
    {key:'runs', label:'Runs', lowerBetter:false, filter: r=>r.runs>0},
    {key:'ave', label:'Average', lowerBetter:false, filter: r=>r.ave!==null && r.inns>=3},
    {key:'sr', label:'Strike Rate', lowerBetter:false, filter: r=>r.sr!==null && r.inns>=3},
    {key:'inns', label:'Innings', lowerBetter:false, filter: r=>r.inns>0}
  ];
  const BOWL_METRICS = [
    {key:'wkts', label:'Wickets', lowerBetter:false, filter: r=>r.balls>0},
    {key:'econ', label:'Economy Rate', lowerBetter:true, filter: r=>r.econ!==null && r.balls>=24},
    {key:'bsr', label:'Strike Rate', lowerBetter:true, filter: r=>r.bsr!==null && r.balls>=24},
    {key:'bave', label:'Average', lowerBetter:true, filter: r=>r.bave!==null && r.balls>=24},
    {key:'balls', label:'Balls Bowled', lowerBetter:false, filter: r=>r.balls>0}
  ];

  // ---------- SVG chart helpers ----------
  function escapeXML(s){
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }
  function truncateLabel(s, n){
    s = String(s);
    return s.length > n ? s.slice(0, n-1) + '\u2026' : s;
  }
  function niceTicks(min, max, count){
    if (min === max){ min -= 1; max += 1; }
    const out = [];
    for (let i = 0; i < count; i++){
      out.push(min + (max - min) * (i / (count - 1)));
    }
    return out;
  }

  function renderBarSVG(container, rows, metric){
    const color = state.mode === 'bat' ? '#f5a623' : '#c1443c';
    if (!rows.length){
      container.innerHTML = '<svg viewBox="0 0 640 160" width="100%" height="160"><text x="320" y="80" text-anchor="middle" class="svg-empty">No qualifying players for this metric.</text></svg>';
      return;
    }
    const W = 640, barH = 20, gap = 9, leftPad = 148, rightPad = 58, topPad = 8;
    const n = rows.length;
    const H = topPad*2 + n*(barH+gap) - gap;
    const maxV = Math.max(...rows.map(r => r[metric.key]));
    const scaleMax = maxV > 0 ? maxV * 1.12 : 1;
    const plotW = W - leftPad - rightPad;

    let bars = '';
    rows.forEach((r, i) => {
      const val = r[metric.key];
      const y = topPad + i * (barH + gap);
      const w = Math.max(2, (val / scaleMax) * plotW);
      const label = escapeXML(truncateLabel(r.player, 22));
      const valStr = metric.key === 'econ' ? val.toFixed(2) : (metric.key === 'bsr' ? val.toFixed(1) : val);
      bars += `<text x="${leftPad-8}" y="${y+barH*0.7}" text-anchor="end" class="svg-bar-label">${label}</text>`;
      bars += `<rect x="${leftPad}" y="${y}" width="${w.toFixed(1)}" height="${barH}" rx="2" fill="${color}">`
            +  `<title>${escapeXML(r.player)} \u2014 ${metric.label}: ${valStr}</title></rect>`;
      bars += `<text x="${(leftPad+w+6).toFixed(1)}" y="${y+barH*0.7}" class="svg-bar-value">${valStr}</text>`;
    });

    container.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}" preserveAspectRatio="xMinYMin meet" xmlns="http://www.w3.org/2000/svg">${bars}</svg>`;
  }

  function renderScatterSVG(container, points, xLabel, yLabel, sizeLabel){
    const color = state.scatterMode === 'bat' ? '#f5a623' : '#c1443c';
    if (!points.length){
      container.innerHTML = '<svg viewBox="0 0 640 340" width="100%" height="340"><text x="320" y="170" text-anchor="middle" class="svg-empty">Not enough qualifying players to plot.</text></svg>';
      return;
    }
    const W = 640, H = 360, padL = 60, padR = 16, padT = 14, padB = 42;
    const xs = points.map(p=>p.x), ys = points.map(p=>p.y);
    let xMin = Math.min(...xs), xMax = Math.max(...xs);
    let yMin = Math.min(...ys), yMax = Math.max(...ys);
    const xPad = (xMax - xMin) * 0.1 || Math.max(1, xMax*0.1) || 1;
    const yPad = (yMax - yMin) * 0.1 || Math.max(1, yMax*0.1) || 1;
    xMin -= xPad; xMax += xPad; yMin -= yPad; yMax += yPad;
    if (xMin < 0 && xs.every(v=>v>=0)) xMin = 0;
    if (yMin < 0 && ys.every(v=>v>=0)) yMin = 0;

    const sx = v => padL + ((v - xMin) / (xMax - xMin)) * (W - padL - padR);
    const sy = v => (H - padB) - ((v - yMin) / (yMax - yMin)) * (H - padB - padT);

    const xTicks = niceTicks(xMin, xMax, 5);
    const yTicks = niceTicks(yMin, yMax, 5);

    let grid = '';
    xTicks.forEach(t => {
      const px = sx(t);
      grid += `<line x1="${px.toFixed(1)}" y1="${padT}" x2="${px.toFixed(1)}" y2="${H-padB}" class="svg-grid"/>`;
      grid += `<text x="${px.toFixed(1)}" y="${H-padB+16}" text-anchor="middle" class="svg-axis-tick">${t.toFixed(1)}</text>`;
    });
    yTicks.forEach(t => {
      const py = sy(t);
      grid += `<line x1="${padL}" y1="${py.toFixed(1)}" x2="${W-padR}" y2="${py.toFixed(1)}" class="svg-grid"/>`;
      grid += `<text x="${padL-8}" y="${(py+3.5).toFixed(1)}" text-anchor="end" class="svg-axis-tick">${t.toFixed(1)}</text>`;
    });

    const axes = `<line x1="${padL}" y1="${H-padB}" x2="${W-padR}" y2="${H-padB}" class="svg-axis-line"/>`
               + `<line x1="${padL}" y1="${padT}" x2="${padL}" y2="${H-padB}" class="svg-axis-line"/>`;

    const axisLabels = `<text x="${(padL+(W-padR))/2}" y="${H-6}" text-anchor="middle" class="svg-axis-title">${escapeXML(xLabel)}</text>`
                      + `<text x="14" y="${(padT+(H-padB))/2}" text-anchor="middle" class="svg-axis-title" transform="rotate(-90 14 ${(padT+(H-padB))/2})">${escapeXML(yLabel)}</text>`;

    let circles = '';
    points.forEach((p, i) => {
      const cx = sx(p.x).toFixed(1), cy = sy(p.y).toFixed(1);
      circles += `<circle cx="${cx}" cy="${cy}" r="${p.r.toFixed(1)}" fill="${color}" fill-opacity="0.5" stroke="${color}" stroke-width="1.2" `
               + `data-idx="${i}" class="svg-point"></circle>`;
    });

    container.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}" preserveAspectRatio="xMinYMin meet" xmlns="http://www.w3.org/2000/svg">${grid}${axes}${circles}${axisLabels}</svg>`;

    // custom tooltip (shows player name + stats on hover)
    const tooltip = document.createElement('div');
    tooltip.className = 'svg-tooltip' + (state.scatterMode === 'bowl' ? ' bowl' : '');
    container.appendChild(tooltip);

    container.querySelectorAll('circle.svg-point').forEach(c => {
      const p = points[parseInt(c.getAttribute('data-idx'), 10)];
      c.addEventListener('mouseenter', () => {
        tooltip.innerHTML = `<strong>${escapeXML(p.player)}</strong>`
          + `<span>${escapeXML(xLabel)}: ${p.x}</span>`
          + `<span>${escapeXML(yLabel)}: ${p.y}</span>`
          + `<span>${escapeXML(sizeLabel)}: ${p.extra}</span>`;
        tooltip.classList.add('visible');
        c.setAttribute('stroke-width', '2.2');
      });
      c.addEventListener('mousemove', (e) => {
        const rect = container.getBoundingClientRect();
        let left = e.clientX - rect.left;
        let top = e.clientY - rect.top;
        tooltip.style.left = left + 'px';
        tooltip.style.top = top + 'px';
      });
      c.addEventListener('mouseleave', () => {
        tooltip.classList.remove('visible');
        c.setAttribute('stroke-width', '1.2');
      });
    });
  }

  // ---------- DOM refs ----------
  const el = {
    tabs: document.getElementById('tabs'),
    segBat: document.getElementById('seg-bat'),
    segBowl: document.getElementById('seg-bowl'),
    compTitle: document.getElementById('comp-title'),
    compCount: document.getElementById('comp-count'),
    search: document.getElementById('search-input'),
    thead: document.getElementById('thead'),
    tbody: document.getElementById('tbody'),
    barMetric: document.getElementById('bar-metric'),
    barN: document.getElementById('bar-n'),
    barSub: document.getElementById('bar-sub'),
    scatterBat: document.getElementById('scatter-bat'),
    scatterBowl: document.getElementById('scatter-bowl'),
    scatterSub: document.getElementById('scatter-sub'),
    leaderRuns: document.getElementById('leader-runs'),
    leaderRunsMeta: document.getElementById('leader-runs-meta'),
    leaderWkts: document.getElementById('leader-wkts'),
    leaderWktsMeta: document.getElementById('leader-wkts-meta'),
    loading: document.getElementById('loading-state'),
    errorBox: document.getElementById('error-state'),
    errorMsg: document.getElementById('error-msg'),
    retryBtn: document.getElementById('retry-btn'),
    refreshBtn: document.getElementById('refresh-btn'),
    lastUpdated: document.getElementById('last-updated'),
  };


  // ---------- build tabs ----------
  function buildTabs(){
    const frag = document.createDocumentFragment();
    const allBtn = document.createElement('button');
    allBtn.className = 'tab-btn all active';
    allBtn.textContent = 'All Tournaments';
    allBtn.dataset.tab = 'ALL';
    frag.appendChild(allBtn);
    for (const t of tournaments){
      const b = document.createElement('button');
      b.className = 'tab-btn';
      b.textContent = t.short;
      b.dataset.tab = t.full;
      b.title = t.full;
      frag.appendChild(b);
    }
    el.tabs.appendChild(frag);
    el.tabs.addEventListener('click', e => {
      const btn = e.target.closest('.tab-btn');
      if (!btn) return;
      state.tab = btn.dataset.tab;
      [...el.tabs.children].forEach(c => c.classList.toggle('active', c === btn));
      state.sortKey = null; state.search=''; el.search.value='';
      render();
    });
  }

  function setMode(mode){
    state.mode = mode;
    el.segBat.classList.toggle('active', mode==='bat');
    el.segBowl.classList.toggle('active', mode==='bowl');
    el.segBat.classList.toggle('bat', mode==='bat');
    el.segBowl.classList.toggle('bowl', mode==='bowl');
    state.sortKey = null;
    state.barMetric = null;
    render();
  }

  el.segBat.addEventListener('click', () => setMode('bat'));
  el.segBowl.addEventListener('click', () => setMode('bowl'));
  el.search.addEventListener('input', () => { state.search = el.search.value.trim().toLowerCase(); renderTable(currentRows()); });

  // ---------- filtering / sorting ----------
  function currentRows(){
    let rows = rowsForTab(state.tab);
    if (state.mode === 'bat'){
      rows = rows.filter(r => r.inns > 0);
    } else {
      rows = rows.filter(r => r.balls > 0);
    }
    if (state.search){
      rows = rows.filter(r => (r.player||'').toLowerCase().includes(state.search) || (r.team||'').toLowerCase().includes(state.search));
    }
    const key = state.sortKey || (state.mode==='bat' ? 'runs' : 'wkts');
    const dir = state.sortDir === 'asc' ? 1 : -1;
    rows = rows.slice().sort((a,b) => {
      let av = a[key], bv = b[key];
      if (av === null || av === undefined) av = -Infinity;
      if (bv === null || bv === undefined) bv = -Infinity;
      if (typeof av === 'string') return dir * av.localeCompare(bv);
      return dir * (av - bv);
    });
    return rows;
  }

  // ---------- render table ----------
  function renderTable(rows){
    const cols = getCols();
    el.thead.innerHTML = '';
    const trh = document.createElement('tr');
    const rankTh = document.createElement('th');
    rankTh.textContent = '#';
    rankTh.className = 'rank-cell';
    trh.appendChild(rankTh);
    for (const c of cols){
      const th = document.createElement('th');
      th.textContent = c.label;
      th.dataset.key = c.key;
      const activeKey = state.sortKey || (state.mode==='bat'?'runs':'wkts');
      if (c.key === activeKey){
        th.classList.add('sorted');
        th.innerHTML = c.label + '<span class="arrow">' + (state.sortDir==='asc' ? '\u2191' : '\u2193') + '</span>';
      }
      if (c.key === 'tourn'){ th.style.textAlign = 'left'; }
      trh.appendChild(th);
    }
    el.thead.appendChild(trh);
    el.thead.querySelectorAll('th[data-key]').forEach(th => {
      th.addEventListener('click', () => {
        const k = th.dataset.key;
        if (state.sortKey === k){ state.sortDir = state.sortDir === 'asc' ? 'desc' : 'asc'; }
        else { state.sortKey = k; state.sortDir = 'desc'; }
        render();
      });
    });

    el.tbody.innerHTML = '';
    if (rows.length === 0){
      const tr = document.createElement('tr');
      tr.className = 'empty-row';
      const td = document.createElement('td');
      td.colSpan = cols.length + 1;
      td.textContent = 'No players match this filter.';
      tr.appendChild(td);
      el.tbody.appendChild(tr);
    } else {
      const frag = document.createDocumentFragment();
      rows.forEach((r, i) => {
        const tr = document.createElement('tr');
        const rankTd = document.createElement('td');
        rankTd.className = 'rank-cell';
        rankTd.textContent = i+1;
        tr.appendChild(rankTd);
        for (const c of cols){
          const td = document.createElement('td');
          let val = r[c.key];
          if (c.key === 'team' && r.teamTitle) td.title = r.teamTitle;
          if (c.key === 'tourn' && r.tournTitle) td.title = r.tournTitle;
          td.textContent = c.fmt ? c.fmt(val) : (val === null || val===undefined ? '\u2013' : val);
          if (c.key === 'tourn'){ td.style.maxWidth = '420px'; td.style.overflow='hidden'; td.style.textOverflow='ellipsis'; td.style.whiteSpace='nowrap'; td.style.textAlign='left'; td.style.fontFamily="'Inter',sans-serif"; td.style.fontSize='11.5px'; td.style.color='var(--text-dim)'; }
          if (c.strong) td.style.color = 'var(--amber)';
          tr.appendChild(td);
        }
        frag.appendChild(tr);
      });
      el.tbody.appendChild(frag);
    }

    el.compCount.textContent = rows.length + (state.mode==='bat' ? ' batters shown' : ' bowlers shown') + (state.search ? ' (filtered)' : '');
  }

  // ---------- bar chart ----------
  function metricsForMode(){ return state.mode==='bat' ? BAT_METRICS : BOWL_METRICS; }

  function buildBarControls(){
    const metrics = metricsForMode();
    if (!state.barMetric || !metrics.find(m=>m.key===state.barMetric)){
      state.barMetric = metrics[0].key;
    }
    el.barMetric.innerHTML = metrics.map(m => `<option value="${m.key}">${m.label}</option>`).join('');
    el.barMetric.value = state.barMetric;
    el.barN.value = String(state.barN);
  }
  el.barMetric.addEventListener('change', () => { state.barMetric = el.barMetric.value; renderBar(); });
  el.barN.addEventListener('change', () => { state.barN = parseInt(el.barN.value,10); renderBar(); });

  function renderBar(){
    const metrics = metricsForMode();
    const metric = metrics.find(m => m.key === state.barMetric) || metrics[0];
    let rows = rowsForTab(state.tab);
    rows = rows.filter(r => metric.filter(r));
    rows = rows.slice().sort((a,b) => (metric.lowerBetter ? (a[metric.key]-b[metric.key]) : (b[metric.key]-a[metric.key])));
    rows = rows.slice(0, state.barN);

    el.barSub.textContent = (metric.lowerBetter ? 'Lower is better \u2014 ' : '') + 'Top ' + rows.length + ' by ' + metric.label;

    renderBarSVG(document.getElementById('bar-canvas'), rows, metric);
  }

  // ---------- scatter chart ----------
  el.scatterBat.addEventListener('click', () => { state.scatterMode='bat'; el.scatterBat.classList.add('active','bat'); el.scatterBowl.classList.remove('active','bowl'); renderScatter(); });
  el.scatterBowl.addEventListener('click', () => { state.scatterMode='bowl'; el.scatterBowl.classList.add('active','bowl'); el.scatterBat.classList.remove('active','bat'); renderScatter(); });

  function renderScatter(){
    let rows = rowsForTab(state.tab);
    let points, xLabel, yLabel, sizeLabel, thresholdNote;
    const MIN_RUNS = 100, MIN_WKTS = 8;
    if (state.scatterMode === 'bat'){
      rows = rows.filter(r => r.ave !== null && r.sr !== null && r.runs >= MIN_RUNS);
      const maxRuns = Math.max(1, ...rows.map(r=>r.runs));
      points = rows.map(r => ({ x:r.ave, y:r.sr, r: 4 + 15*Math.sqrt(r.runs/maxRuns), player:r.player, extra:r.runs }));
      xLabel = 'Batting Average'; yLabel = 'Batting Strike Rate'; sizeLabel='Runs';
      thresholdNote = 'min ' + MIN_RUNS + ' runs';
    } else {
      rows = rows.filter(r => r.econ !== null && r.bsr !== null && r.wkts >= MIN_WKTS);
      const maxW = Math.max(1, ...rows.map(r=>r.wkts));
      points = rows.map(r => ({ x:r.econ, y:r.bsr, r: 4 + 15*Math.sqrt(r.wkts/maxW), player:r.player, extra:r.wkts }));
      xLabel = 'Economy Rate'; yLabel = 'Bowling Strike Rate'; sizeLabel='Wickets';
      thresholdNote = 'min ' + MIN_WKTS + ' wickets';
    }
    el.scatterSub.textContent = 'Bubble size = ' + sizeLabel + ' \u00b7 ' + thresholdNote + ' \u2014 ' + points.length + ' players';
    renderScatterSVG(document.getElementById('scatter-canvas'), points, xLabel, yLabel, sizeLabel);
  }

  // ---------- leaders (signature scoreboard) ----------
  function renderLeaders(){
    const all = aggregateAll();
    const totalPlayers = all.length;
    const batters = all.filter(r => r.inns > 0).length;
    const bowlers = all.filter(r => r.balls > 0).length;

    el.leaderRuns.textContent = totalPlayers.toLocaleString();
    el.leaderRunsMeta.textContent = batters.toLocaleString() + ' batters \u00b7 ' + bowlers.toLocaleString() + ' bowlers';

    el.leaderWkts.textContent = tournaments.length.toLocaleString();
    el.leaderWktsMeta.textContent = records.length.toLocaleString() + ' player-league records';
  }

  // ---------- master render ----------
  function render(){
    const tName = state.tab === 'ALL' ? 'All Tournaments (combined)' : (tournaments.find(t=>t.full===state.tab)||{}).short;
    el.compTitle.textContent = tName;
    buildBarControls();
    const rows = currentRows();
    renderTable(rows);
    renderBar();
    renderScatter();
  }

  // ---------- data loading (live fetch) ----------
  function setTabsEnabled(enabled){
    el.tabs.style.pointerEvents = enabled ? '' : 'none';
    el.tabs.style.opacity = enabled ? '' : '0.4';
  }

  function showLoading(){
    el.loading.style.display = 'flex';
    el.errorBox.style.display = 'none';
    setTabsEnabled(false);
  }
  function hideLoading(){
    el.loading.style.display = 'none';
    setTabsEnabled(true);
  }
  function showError(message){
    el.loading.style.display = 'none';
    el.errorBox.style.display = 'flex';
    el.errorMsg.textContent = message;
    setTabsEnabled(false);
  }

  async function loadData(isRefresh){
    if (!isRefresh) showLoading();
    else el.refreshBtn.classList.add('spinning');
    try {
      const resp = await fetch(DATA_ENDPOINT, { cache: 'no-store' });
      if (!resp.ok){
        let detail = '';
        try { detail = (await resp.json()).error || ''; } catch(e){}
        throw new Error('Request failed (' + resp.status + ')' + (detail ? ': ' + detail : ''));
      }
      const json = await resp.json();
      if (!json || !Array.isArray(json.records) || !Array.isArray(json.tournaments)){
        throw new Error('Unexpected response shape from ' + DATA_ENDPOINT);
      }
      records = json.records;
      tournaments = json.tournaments;
      shortByFull = new Map(tournaments.map(t => [t.full, t.short]));
      aggCache = null; // force recompute of the combined view

      if (!isRefresh){
        el.tabs.innerHTML = '';
        buildTabs();
      }
      renderLeaders();
      render();
      hideLoading();
      el.lastUpdated.textContent = 'Updated ' + new Date().toLocaleTimeString();
    } catch (err) {
      console.error(err);
      if (!isRefresh) showError(err.message || String(err));
      else el.lastUpdated.textContent = 'Refresh failed \u2014 showing last loaded data';
    } finally {
      el.refreshBtn.classList.remove('spinning');
    }
  }

  el.retryBtn.addEventListener('click', () => loadData(false));
  el.refreshBtn.addEventListener('click', () => loadData(true));

  loadData(false);
  if (AUTO_REFRESH_MS > 0){
    setInterval(() => loadData(true), AUTO_REFRESH_MS);
  }
})();
