/* Landfall dashboard: renders window.RADAR (written by main.ts) with no network and no framework. */

(function () {
  'use strict';

  var DATA = window.RADAR;
  var root = document.querySelector('.shell');
  if (!DATA || !Array.isArray(DATA.rows) || !DATA.meta) {
    root.textContent = 'No radar data: run main.ts first, then open output/dashboard/index.html.';
    return;
  }

  var meta = DATA.meta;
  var rows = DATA.rows;
  var bySlug = {};
  rows.forEach(function (r) { bySlug[r.slug] = r; });
  var maxImplied = rows.reduce(function (m, r) { return Math.max(m, r.implied_value_usd); }, 0);

  var state = {
    q: '',
    category: '',
    chain: '',
    watchOnly: false,
    sort: 'implied',
    dir: -1,
    tab: 'radar',
    openSlug: null
  };

  var $ = function (id) { return document.getElementById(id); };
  var nf = new Intl.NumberFormat('en-US');

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function usd(n) {
    if (n == null) return '—';
    if (n >= 1e12) return '$' + (n / 1e12).toFixed(n >= 1e13 ? 0 : 1) + 'T';
    if (n >= 1e9) return '$' + (n / 1e9).toFixed(n >= 1e11 ? 0 : 1) + 'B';
    if (n >= 1e6) return '$' + (n / 1e6).toFixed(n >= 1e8 ? 0 : 1) + 'M';
    if (n >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return '$' + Math.round(n);
  }

  function fullUsd(n) { return n == null ? '—' : '$' + nf.format(Math.round(n)); }

  function pct(v) {
    if (v == null) return '<span class="muted">—</span>';
    var cls = v > 0 ? 'pos' : v < 0 ? 'neg' : 'muted';
    var sign = v > 0 ? '+' : '';
    return '<span class="' + cls + '">' + sign + (Math.round(v * 10) / 10).toFixed(1) + '%</span>';
  }

  function age(d) {
    if (d == null) return '<span class="muted">unknown</span>';
    if (d >= 365) return (Math.round((d / 365) * 10) / 10) + 'y';
    return d + 'd';
  }

  function chains(list) {
    if (!list || !list.length) return '<span class="muted">—</span>';
    var shown = list.slice(0, 2).map(esc).join(', ');
    var more = list.length > 2 ? ' <span class="more">+' + (list.length - 2) + '</span>' : '';
    return '<span class="chains">' + shown + more + '</span>';
  }

  // ---------------------------------------------------------------- header

  function renderSnapshot() {
    var items = [
      ['As of', meta.as_of],
      ['Universe', nf.format(meta.universe_size || 758) + ' protocols'],
      ['Floor', usd(meta.floor_usd) + ' TVL'],
      ['Model', meta.model_version]
    ];
    $('snapshot').innerHTML = items.map(function (it) {
      return '<div><dt>' + esc(it[0]) + '</dt><dd>' + esc(it[1]) + '</dd></div>';
    }).join('');
    $('foot-source').innerHTML = 'Source: ' + esc(meta.source.replace(' https', ' · https'));
  }

  function median(list) {
    if (!list.length) return 0;
    var a = list.slice().sort(function (x, y) { return x - y; });
    var mid = Math.floor(a.length / 2);
    return a.length % 2 ? a[mid] : Math.round((a[mid - 1] + a[mid]) / 2);
  }

  function renderKpis() {
    var covered = 0;
    rows.forEach(function (r) { if (r.watchlist) covered++; });
    var top = rows[0];
    var cards = [
      ['Ranked pre-token', String(meta.board_size), meta.early_count + ' below the $50M floor · ' + (meta.board_size - meta.early_count) + ' on the watchlist'],
      ['Watchlist coverage', covered + ' / ' + meta.watchlist_size, 'every watchlist protocol is on the board'],
      ['Median implied value', usd(median(rows.map(function (r) { return r.implied_value_usd; }))), 'across all ranked pre-token protocols'],
      ['Top pick', top ? top.name : '—', top ? usd(top.implied_value_usd) + ' implied · rank 1' : '']
    ];
    $('kpis').innerHTML = cards.map(function (c, i) {
      return '<div class="kpi"><div class="label">' + esc(c[0]) + '</div>' +
        '<div class="value' + (i === 3 ? ' small' : '') + '">' + esc(c[1]) + '</div>' +
        '<div class="sub">' + esc(c[2]) + '</div></div>';
    }).join('');
    $('count-radar').textContent = String(meta.board_size);
    $('count-live').textContent = String(meta.live_size);
  }

  // ---------------------------------------------------------------- filters

  function fillSelects() {
    var cat = $('category');
    cat.innerHTML = '<option value="">All categories</option>' +
      meta.categories.map(function (c) { return '<option value="' + esc(c) + '">' + esc(c) + '</option>'; }).join('');
    var chain = $('chain');
    chain.innerHTML = '<option value="">All chains</option>' +
      meta.chains.map(function (c) { return '<option value="' + esc(c) + '">' + esc(c) + '</option>'; }).join('');
  }

  function matches(r) {
    if (state.watchOnly && !r.watchlist) return false;
    if (state.category && (r.category || 'Uncategorised') !== state.category) return false;
    if (state.chain && r.chains.indexOf(state.chain) === -1) return false;
    if (state.q) {
      var q = state.q.toLowerCase();
      var hay = (r.name + ' ' + r.slug + ' ' + (r.category || '') + ' ' + r.chains.join(' ')).toLowerCase();
      if (hay.indexOf(q) === -1) return false;
    }
    return true;
  }

  function val(r, key) {
    if (key === 'rank' || key === 'implied') return r[key === 'rank' ? 'rank' : 'implied_value_usd'];
    if (key === 'tvl') return r.tvl_usd;
    if (key === 'change') return r.change_7d == null ? -1e9 : r.change_7d;
    if (key === 'age') return r.age_days == null ? -1 : r.age_days;
    if (key === 'name') return r.name.toLowerCase();
    return r.category ? r.category.toLowerCase() : '';
  }

  function filtered() {
    var out = rows.filter(matches);
    var key = state.sort;
    out.sort(function (a, b) {
      var x = val(a, key);
      var y = val(b, key);
      if (x < y) return -1 * state.dir;
      if (x > y) return 1 * state.dir;
      return a.rank - b.rank;
    });
    return out;
  }

  function renderChips() {
    var chips = [];
    if (state.q) chips.push(['search', state.q]);
    if (state.category) chips.push(['category', state.category]);
    if (state.chain) chips.push(['chain', state.chain]);
    if (state.watchOnly) chips.push(['watchlist', 'only']);
    var box = $('chips');
    if (!chips.length) { box.classList.remove('on'); box.innerHTML = ''; return; }
    box.classList.add('on');
    box.innerHTML = chips.map(function (c) {
      return '<span class="chip">' + esc(c[0]) + ': <b>' + esc(c[1]) + '</b>' +
        '<button type="button" data-clear="' + esc(c[0]) + '" aria-label="Remove ' + esc(c[0]) + ' filter">×</button></span>';
    }).join('');
  }

  // ---------------------------------------------------------------- board

  function renderSort() {
    document.querySelectorAll('#board thead th').forEach(function (th) {
      var btn = th.querySelector('button');
      if (!btn) return;
      if (btn.getAttribute('data-sort') === state.sort) {
        th.setAttribute('aria-sort', state.dir === -1 ? 'descending' : 'ascending');
      } else {
        th.removeAttribute('aria-sort');
      }
    });
  }

  function renderBoard() {
    var list = filtered();
    var body = $('rows');
    var html = list.map(function (r) {
      var share = maxImplied ? Math.max(2, (r.implied_value_usd / maxImplied) * 100) : 0;
      return '<tr tabindex="0" data-slug="' + esc(r.slug) + '"' + (r.rank <= 3 ? ' class="top"' : '') + '>' +
        '<td class="num rank">' + r.rank + '</td>' +
        '<td><span class="pname">' + esc(r.name) + '</span><span class="pslug">' + esc(r.slug) + '</span></td>' +
        '<td><span class="tag">' + esc(r.category || 'Uncategorised') + '</span></td>' +
        '<td>' + chains(r.chains) + '</td>' +
        '<td class="num amt">' + usd(r.tvl_usd) + '</td>' +
        '<td class="num amt">' + pct(r.change_7d) + '</td>' +
        '<td class="num amt">' + age(r.age_days) + '</td>' +
        '<td class="num implied"><div class="v">' + usd(r.implied_value_usd) + '</div>' +
        '<div class="bar"><span style="width:' + share.toFixed(1) + '%"></span></div></td>' +
        '</tr>';
    }).join('');
    body.innerHTML = html;
    $('empty').hidden = list.length > 0;
    var covered = rows.filter(function (r) { return r.watchlist; }).length;
    $('table-note').textContent = 'Showing ' + list.length + ' of ' + meta.board_size +
      ' ranked protocols · watchlist ' + covered + '/' + meta.watchlist_size +
      ' · implied values are this radar\'s claim, not a forecast';
    renderSort();
  }

  function setSort(key) {
    if (state.sort === key) state.dir = -state.dir;
    else { state.sort = key; state.dir = key === 'name' ? 1 : -1; }
    $('sort').value = key;
    renderBoard();
  }

  // ---------------------------------------------------------------- detail

  function openDetail(slug) {
    var r = bySlug[slug];
    if (!r) return;
    state.openSlug = slug;
    var f = r.factors;
    var base = r.tvl_usd * f.base_rate;
    var afterTilt = base * f.category_tilt;
    var afterMomentum = afterTilt * f.momentum;
    var afterMaturity = afterMomentum * f.maturity;
    var lines = [
      ['TVL', usd(r.tvl_usd), fullUsd(r.tvl_usd)],
      ['Base rate', '26%', usd(base)],
      ['Category tilt', f.category_tilt.toFixed(2) + '×', usd(afterTilt)],
      ['Momentum', f.momentum.toFixed(2) + '×', usd(afterMomentum)],
      ['Maturity', f.maturity.toFixed(2) + '×', usd(afterMaturity)],
      ['Breadth', f.breadth.toFixed(2) + '×', usd(r.implied_value_usd)]
    ];
    var calc = lines.map(function (l) {
      return '<div class="line"><span class="k">' + esc(l[0]) + '</span><span class="d">' + esc(l[1]) + '</span><span class="v">' + esc(l[2]) + '</span></div>';
    }).join('');

    var plan = r.farm_steps.map(function (step) {
      var action = step;
      var cost = '';
      var time = '';
      var ci = step.indexOf(' Cost: ');
      if (ci !== -1) {
        action = step.slice(0, ci);
        var rest = step.slice(ci + 7);
        var ti = rest.indexOf(' Time: ');
        if (ti !== -1) {
          cost = rest.slice(0, ti).replace(/\.$/, '');
          time = rest.slice(ti + 7).replace(/\.$/, '');
        } else cost = rest.replace(/\.$/, '');
      }
      return '<li><div>' + esc(action) + '</div><div class="meta">' +
        (cost ? '<span>cost · ' + esc(cost) + '</span>' : '') +
        (time ? '<span>time · ' + esc(time) + '</span>' : '') + '</div></li>';
    }).join('');

    var tags = '<span class="tag ' + (r.watchlist ? 'wl' : 'early') + '">' + (r.watchlist ? 'watchlist' : 'early · below floor') + '</span>' +
      '<span class="tag">' + esc(r.category || 'Uncategorised') + '</span>' +
      r.chains.slice(0, 4).map(function (c) { return '<span class="tag">' + esc(c) + '</span>'; }).join('') +
      (r.chains.length > 4 ? '<span class="tag">+' + (r.chains.length - 4) + ' chains</span>' : '');

    $('detail').innerHTML =
      '<div class="detail-head"><div><div class="eyebrow">Pre-token · rank ' + r.rank + '</div>' +
      '<h2 id="detail-name">' + esc(r.name) + '</h2><div class="slug">' + esc(r.slug) + '</div></div>' +
      '<button class="close" type="button" aria-label="Close detail">×</button></div>' +
      '<div class="tags">' + tags + '</div>' +
      '<div class="hero"><div class="label">Implied fully-diluted value</div>' +
      '<div class="big">' + usd(r.implied_value_usd) + '</div>' +
      '<div class="full">' + fullUsd(r.implied_value_usd) + ' · model ' + esc(meta.model_version) + '</div>' +
      '<div class="rationale">' + esc(r.rationale) + '</div></div>' +
      '<h3>How this value is built</h3><div class="calc">' + calc +
      '<div class="line total"><span class="k">Implied value</span><span class="d">product of the factors above</span><span class="v">' + usd(r.implied_value_usd) + '</span></div></div>' +
      '<h3>Farm plan · cost and time per step</h3><ol class="plan">' + plan + '</ol>' +
      '<p class="disclaimer"><strong>Read this as a launch radar, not a promise.</strong> The snapshot records no token for this protocol; that is not proof it has none. The value is derived from TVL, 7-day growth and time without a token, and every step is a position you can unwind.</p>';

    $('detail').hidden = false;
    $('scrim').hidden = false;
    document.body.style.overflow = 'hidden';
    $('detail').querySelector('.close').focus();
  }

  function closeDetail() {
    state.openSlug = null;
    $('detail').hidden = true;
    $('scrim').hidden = true;
    $('detail').innerHTML = '';
    document.body.style.overflow = '';
  }

  // ---------------------------------------------------------------- live

  function renderLive() {
    var list = DATA.live.slice().sort(function (a, b) { return (b.mcap_usd || 0) - (a.mcap_usd || 0); });
    $('live-rows').innerHTML = list.map(function (r) {
      return '<tr>' +
        '<td><span class="pname">' + esc(r.name) + '</span></td>' +
        '<td class="amt">' + esc(r.symbol || '—') + '</td>' +
        '<td><span class="tag">' + esc(r.category || 'Uncategorised') + '</span></td>' +
        '<td>' + chains(r.chains) + '</td>' +
        '<td class="num amt">' + usd(r.tvl_usd) + '</td>' +
        '<td class="num amt">' + usd(r.mcap_usd) + '</td>' +
        '<td class="num amt">' + pct(r.change_7d) + '</td></tr>';
    }).join('');
  }

  // ---------------------------------------------------------------- tabs

  function setTab(name) {
    state.tab = name;
    ['radar', 'live', 'method'].forEach(function (t) {
      var tab = $('tab-' + t);
      var panel = $(t === 'radar' ? 'board-panel' : t === 'live' ? 'live-panel' : 'method-panel');
      var on = t === name;
      tab.setAttribute('aria-selected', on ? 'true' : 'false');
      tab.setAttribute('tabindex', on ? '0' : '-1');
      panel.hidden = !on;
    });
  }

  // ---------------------------------------------------------------- events

  $('q').addEventListener('input', function (e) { state.q = e.target.value.trim(); renderChips(); renderBoard(); });
  $('category').addEventListener('change', function (e) { state.category = e.target.value; renderChips(); renderBoard(); });
  $('chain').addEventListener('change', function (e) { state.chain = e.target.value; renderChips(); renderBoard(); });
  $('watch-only').addEventListener('change', function (e) { state.watchOnly = e.target.checked; renderChips(); renderBoard(); });
  $('sort').addEventListener('change', function (e) { state.sort = e.target.value; state.dir = state.sort === 'name' ? 1 : -1; renderBoard(); });
  $('reset').addEventListener('click', function () {
    state.q = ''; state.category = ''; state.chain = ''; state.watchOnly = false;
    state.sort = 'implied'; state.dir = -1;
    $('q').value = ''; $('category').value = ''; $('chain').value = ''; $('watch-only').checked = false; $('sort').value = 'implied';
    renderChips(); renderBoard();
  });
  $('chips').addEventListener('click', function (e) {
    var b = e.target.closest('button[data-clear]');
    if (!b) return;
    var k = b.getAttribute('data-clear');
    if (k === 'search') { state.q = ''; $('q').value = ''; }
    if (k === 'category') { state.category = ''; $('category').value = ''; }
    if (k === 'chain') { state.chain = ''; $('chain').value = ''; }
    if (k === 'watchlist') { state.watchOnly = false; $('watch-only').checked = false; }
    renderChips(); renderBoard();
  });

  document.querySelectorAll('#board thead th button[data-sort]').forEach(function (b) {
    b.addEventListener('click', function () { setSort(b.getAttribute('data-sort')); });
  });

  $('rows').addEventListener('click', function (e) {
    var tr = e.target.closest('tr[data-slug]');
    if (tr) openDetail(tr.getAttribute('data-slug'));
  });
  $('rows').addEventListener('keydown', function (e) {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    var tr = e.target.closest('tr[data-slug]');
    if (tr) { e.preventDefault(); openDetail(tr.getAttribute('data-slug')); }
  });

  $('detail').addEventListener('click', function (e) {
    if (e.target.closest('.close')) closeDetail();
  });
  $('scrim').addEventListener('click', closeDetail);
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && state.openSlug) closeDetail();
    if (e.key === '/' && document.activeElement !== $('q')) { e.preventDefault(); $('q').focus(); }
  });

  ['radar', 'live', 'method'].forEach(function (t) {
    $('tab-' + t).addEventListener('click', function () { setTab(t); });
  });

  // ---------------------------------------------------------------- boot

  renderSnapshot();
  renderKpis();
  fillSelects();
  renderChips();
  renderBoard();
  renderLive();
  setTab('radar');
})();
