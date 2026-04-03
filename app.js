// =====================================================
//  WARERA HQ DASHBOARD — app.js
//  API: https://api2.warera.io/trpc  (tRPC over HTTP)
// =====================================================

// ---- CONFIG ----
const CONFIG_KEY   = 'wareraHQ_config';
const PROFIT_KEY   = 'wareraHQ_profit';
const BUILD_KEY    = 'wareraHQ_buildThresh';
const CACHE_KEY    = 'wareraHQ_cache';
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 min

const BASE = 'https://api3.warera.io/trpc';
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

// ---- STATE ----
let cfg = null;
let currentTab = 'me';
let allUserTxns = [];
let allMuTxns   = [];
let allMembers  = [];
let currentTxnFilter   = 'ALL';
let currentMuTxnFilter = 'ALL';
let buildThresh = { fight: 70, eco: 70 };

// =====================================================
//  INIT
// =====================================================
window.addEventListener('DOMContentLoaded', () => {
  loadBuildThresholds();
  cfg = loadConfig();
  if (cfg) {
    showApp();
    loadTab('me');
  } else {
    document.getElementById('configOverlay').style.display = 'flex';
    document.getElementById('mainContent').style.display  = 'none';
  }
  renderProfitList();
});

// =====================================================
//  CONFIG
// =====================================================
function loadConfig() {
  try { return JSON.parse(localStorage.getItem(CONFIG_KEY)); }
  catch { return null; }
}
function saveConfig() {
  const key    = document.getElementById('cfgApiKey').value.trim();
  const userId = document.getElementById('cfgUserId').value.trim();
  const muId   = document.getElementById('cfgMuId').value.trim();
  if (!key || !userId || !muId) {
    alert('Please fill in all fields.');
    return;
  }
  cfg = { key, userId, muId };
  localStorage.setItem(CONFIG_KEY, JSON.stringify(cfg));
  document.getElementById('configOverlay').style.display = 'none';
  showApp();
  loadTab('me');
}
function openConfig() {
  if (cfg) {
    document.getElementById('cfgApiKey').value = cfg.key  || '';
    document.getElementById('cfgUserId').value = cfg.userId || '';
    document.getElementById('cfgMuId').value   = cfg.muId  || '';
  }
  document.getElementById('configOverlay').style.display = 'flex';
}
function showApp() {
  document.getElementById('mainContent').style.display = 'block';
}

// =====================================================
//  TABS
// =====================================================
function switchTab(tab) {
  currentTab = tab;
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
  document.querySelectorAll('.tab-content').forEach(c => c.classList.toggle('active', c.id === 'tab-' + tab));
  loadTab(tab);
}
function refreshCurrentTab() {
  clearCache(currentTab);
  loadTab(currentTab);
}
function loadTab(tab) {
  if (tab === 'me') loadMyProfile();
  else              loadMuProfile();
}

// =====================================================
//  API HELPER
// =====================================================
async function trpc(procedure, input = {}) {
  // Warera API: all calls are GET, not POST
  const inputParam = encodeURIComponent(JSON.stringify({ 0: { json: input } }));
  const url = `${BASE}/${procedure}?batch=1&input=${inputParam}`;
  const headers = {};
  if (cfg && cfg.key) headers['X-API-Key'] = cfg.key;

  const res = await fetch(url, { method: 'GET', headers });
  if (!res.ok) throw new Error(`HTTP ${res.status} on ${procedure}`);
  const data = await res.json();
  if (data[0]?.error) throw new Error(data[0].error.message || 'API error');
  const result = data[0]?.result?.data;
  return result?.json !== undefined ? result.json : result;
}

async function trpcPaginated(procedure, input = {}, pages = 5) {
  let items = [];
  let cursor = null;
  for (let i = 0; i < pages; i++) {
    const inp = cursor ? { ...input, cursor } : input;
    const page = await trpc(procedure, inp);
    if (!page) break;
    // tRPC paginated responses can be shaped differently
    const batch = page.items || page.data || (Array.isArray(page) ? page : []);
    items = items.concat(batch);
    const next = page.nextCursor ?? page.next_cursor ?? null;
    if (!next) break;
    cursor = next;
  }
  return items;
}

// ---- CACHE ----
function getCached(key) {
  try {
    const raw = JSON.parse(localStorage.getItem(CACHE_KEY) || '{}');
    const entry = raw[key];
    if (entry && Date.now() - entry.ts < CACHE_TTL_MS) return entry.data;
  } catch {}
  return null;
}
function setCache(key, data) {
  try {
    const raw = JSON.parse(localStorage.getItem(CACHE_KEY) || '{}');
    raw[key] = { ts: Date.now(), data };
    localStorage.setItem(CACHE_KEY, JSON.stringify(raw));
  } catch {}
}
function clearCache(tab) {
  try {
    const raw = JSON.parse(localStorage.getItem(CACHE_KEY) || '{}');
    Object.keys(raw).filter(k => k.startsWith(tab + '_')).forEach(k => delete raw[k]);
    localStorage.setItem(CACHE_KEY, JSON.stringify(raw));
  } catch {}
}

// =====================================================
//  MY PROFILE
// =====================================================
async function loadMyProfile() {
  setStatus('loading');
  try {
    await Promise.all([
      loadUserInfo(),
      loadUserTxns(),
      loadUserCompanies(),
    ]);
    setStatus('online');
  } catch (e) {
    setStatus('error');
    console.error(e);
  }
}

async function loadUserInfo() {
  const cKey = 'me_userinfo';
  let user = getCached(cKey);
  if (!user) {
    // Correct procedure: user.getUserLite
    user = await trpc('user.getUserLite', { userId: cfg.userId });
    setCache(cKey, user);
  }
  renderUserInfo(user);
}

function renderUserInfo(u) {
  if (!u) { document.getElementById('userInfoBody').innerHTML = '<p class="error-msg">Failed to load user info.</p>'; return; }
  const fields = [
    ['Username',    u.username || u.name || '—', 'highlight'],
    ['Level',       u.level ?? '—',              'gold'],
    ['Country',     u.country?.name || u.countryName || '—'],
    ['Citizenship', u.citizenship?.name || '—'],
    ['Experience',  fmt(u.experience || u.xp) ],
    ['Strength',    fmt(u.strength) ],
    ['Work Skill',  fmt(u.workSkill || u.work_skill) ],
    ['Health',      u.health != null ? u.health + ' / ' + (u.maxHealth || 100) : '—'],
    ['Rank',        u.rank || '—'],
    ['Premium',     u.premium ? '✅ Active' : '❌ No', u.premium ? 'green' : ''],
  ];
  document.getElementById('userInfoBody').innerHTML = fields.map(([l,v,cls='']) =>
    `<div class="stat-row"><span class="stat-label">${l}</span><span class="stat-value ${cls}">${v}</span></div>`
  ).join('');

  // Wealth and damage in separate cards
  document.getElementById('wealthBody').innerHTML = [
    ['Gold',       fmt(u.gold ?? u.wealth), 'gold'],
    ['Currency',   fmt(u.currency), 'green'],
    ['Total Wealth', fmt((u.gold||0)+(u.currency||0)), 'highlight'],
  ].map(([l,v,cls='']) =>
    `<div class="stat-row"><span class="stat-label">${l}</span><span class="stat-value ${cls}">${v}</span></div>`
  ).join('');

  document.getElementById('damageBody').innerHTML = [
    ['Weekly DMG',  fmt(u.weeklyDamage || u.weekly_damage)   , 'red'],
    ['Total DMG',   fmt(u.totalDamage  || u.total_damage)    , 'red'],
    ['Fights Today',fmt(u.fightsToday  || u.fights_today)    ],
    ['Terrain',     fmt(u.terrain)                           ],
  ].map(([l,v,cls='']) =>
    `<div class="stat-row"><span class="stat-label">${l}</span><span class="stat-value ${cls}">${v}</span></div>`
  ).join('');
}

async function loadUserCompanies() {
  const cKey = 'me_companies';
  let companies = getCached(cKey);
  if (!companies) {
    try {
      // correct: company.getCompanies
      const page = await trpc('company.getCompanies', { userId: cfg.userId, limit: 50 });
      companies = page?.items || page?.data || (Array.isArray(page) ? page : []);
      setCache(cKey, companies);
    } catch { companies = []; }
  }
  const el = document.getElementById('companiesBody');
  if (!companies.length) { el.innerHTML = '<p class="empty-msg">No companies found.</p>'; return; }
  el.innerHTML = `<div class="company-grid">${companies.map(c => `
    <div class="company-item">
      <div class="company-name">${esc(c.name || 'Company')}</div>
      <div class="company-meta">
        ${c.type || c.industry || ''}
        ${c.region?.name ? ' · ' + c.region.name : ''}
        ${c.quality ? ' · Q' + c.quality : ''}
      </div>
      ${c.workers != null ? `<div class="company-meta">Workers: <span class="mono">${c.workers}</span></div>` : ''}
    </div>
  `).join('')}</div>`;
}

async function loadUserTxns() {
  const cKey = 'me_txns';
  let txns = getCached(cKey);
  if (!txns) {
    const weekAgo = Date.now() - WEEK_MS;
    // correct procedure: transaction.getPaginatedTransactions
    const raw = await trpcPaginated('transaction.getPaginatedTransactions', { userId: cfg.userId, limit: 50 }, 10);
    txns = raw.filter(t => {
      const ts = t.createdAt || t.timestamp || t.date;
      return !ts || new Date(ts).getTime() > weekAgo;
    });
    setCache(cKey, txns);
  }
  allUserTxns = txns;
  renderTxnSummary(txns, 'txnSummary');
  renderTxns(txns, 'txnBody', currentTxnFilter);
}

function filterTxn(type) {
  currentTxnFilter = type;
  document.querySelectorAll('#tab-me .filter-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.type === type));
  renderTxns(allUserTxns, 'txnBody', type);
}

function filterMuTxn(type) {
  currentMuTxnFilter = type;
  document.querySelectorAll('#tab-mu .filter-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.type === type));
  renderTxns(allMuTxns, 'muTxnBody', type);
}

function renderTxnSummary(txns, elId) {
  const el = document.getElementById(elId);
  if (!el) return;
  const totals = {};
  let inflow = 0, outflow = 0;
  txns.forEach(t => {
    const type = t.type || t.transactionType || 'OTHER';
    totals[type] = (totals[type] || 0) + 1;
    const amt = parseFloat(t.amount || t.goldAmount || t.value || 0);
    if (amt > 0) inflow += amt;
    else outflow += Math.abs(amt);
  });
  const cats = [
    ['Total Txns', txns.length, ''],
    ['Inflow 💚',  fmt(inflow),  'txn-sum-value' ],
    ['Outflow 🔴', fmt(outflow), 'txn-sum-value' ],
    ['Net',        fmtNet(inflow - outflow), '' ],
  ];
  el.innerHTML = cats.map(([l,v]) =>
    `<div class="txn-sum-item"><div class="txn-sum-label">${l}</div><div class="txn-sum-value mono">${v}</div></div>`
  ).join('');
}

function renderTxns(txns, elId, filter) {
  const el = document.getElementById(elId);
  if (!el) return;
  const OTHER_TYPES = ['APPLICATION_FEE','ARTICLE_TIP','DISMANTLE_ITEM'];
  let filtered = txns;
  if (filter !== 'ALL') {
    if (filter === 'OTHER') {
      filtered = txns.filter(t => OTHER_TYPES.includes(t.type || t.transactionType));
    } else {
      filtered = txns.filter(t => (t.type || t.transactionType) === filter);
    }
  }
  if (!filtered.length) { el.innerHTML = '<p class="empty-msg">No transactions found for this filter.</p>'; return; }

  el.innerHTML = `<div style="overflow-x:auto">
    <table class="txn-table">
      <thead><tr>
        <th>Type</th><th>Amount</th><th>Item</th><th>From / To</th><th>Date</th>
      </tr></thead>
      <tbody>${filtered.slice(0, 200).map(t => {
        const type   = t.type || t.transactionType || 'OTHER';
        const amt    = parseFloat(t.amount || t.goldAmount || t.value || 0);
        const amtCls = amt > 0 ? 'txn-amount-pos' : amt < 0 ? 'txn-amount-neg' : 'txn-amount-neu';
        const item   = t.itemCode || t.item?.name || t.item_name || t.itemName || '—';
        const party  = t.fromUser?.username || t.toUser?.username || t.counterparty || t.party || '—';
        const date   = fmtDate(t.createdAt || t.timestamp || t.date);
        return `<tr>
          <td><span class="txn-badge badge-${type}">${type.replace(/_/g,' ')}</span></td>
          <td class="${amtCls}">${amt > 0 ? '+' : ''}${fmt(amt)}</td>
          <td>${esc(item)}</td>
          <td style="color:var(--text-muted)">${esc(party)}</td>
          <td style="color:var(--text-muted);font-family:var(--font-mono);font-size:0.78rem">${date}</td>
        </tr>`;
      }).join('')}</tbody>
    </table>
  </div>`;
}

// =====================================================
//  MU PROFILE
// =====================================================
async function loadMuProfile() {
  setStatus('loading');
  try {
    await Promise.all([
      loadMuInfo(),
      loadMuTxns(),
      loadMuMembers(),
    ]);
    setStatus('online');
  } catch (e) {
    setStatus('error');
    console.error(e);
  }
}

async function loadMuInfo() {
  const cKey = 'mu_info';
  let mu = getCached(cKey);
  if (!mu) {
    // correct: mu.getById with muId
    mu = await trpc('mu.getById', { muId: cfg.muId });
    setCache(cKey, mu);
  }
  renderMuInfo(mu);
}

function renderMuInfo(mu) {
  if (!mu) { document.getElementById('muInfoBody').innerHTML = '<p class="error-msg">Failed to load MU info.</p>'; return; }

  document.getElementById('muInfoBody').innerHTML = [
    ['Name',     mu.name || '2nd Para SF',      'highlight'],
    ['Members',  mu.membersCount ?? mu.members?.length ?? '—'],
    ['Country',  mu.country?.name || mu.countryName || '—'],
    ['Location', mu.region?.name || '—'],
    ['Created',  fmtDate(mu.createdAt)],
    ['HQ Level', mu.hqLevel ?? '—',             'gold'],
    ['Dormitory',mu.dormitoriesLevel ?? '—'],
  ].map(([l,v,cls='']) =>
    `<div class="stat-row"><span class="stat-label">${l}</span><span class="stat-value ${cls}">${v}</span></div>`
  ).join('');

  document.getElementById('muWealthBody').innerHTML = [
    ['Gold',     fmt(mu.gold ?? mu.wealth),           'gold'],
    ['Currency', fmt(mu.currency),                    'green'],
    ['Oil',      fmt(mu.oil ?? mu.inventory?.oil),    ''],
  ].map(([l,v,cls='']) =>
    `<div class="stat-row"><span class="stat-label">${l}</span><span class="stat-value ${cls}">${v}</span></div>`
  ).join('');

  document.getElementById('muDmgBody').innerHTML = [
    ['Weekly DMG', fmt(mu.weeklyDamage || mu.weekly_damage), 'red'],
    ['Total DMG',  fmt(mu.totalDamage  || mu.total_damage),  'red'],
    ['Terrain',    fmt(mu.terrain),                          ''],
    ['HQ Active',  mu.hqActive ? '✅ Yes' : '❌ No',          mu.hqActive ? 'green' : ''],
  ].map(([l,v,cls='']) =>
    `<div class="stat-row"><span class="stat-label">${l}</span><span class="stat-value ${cls}">${v}</span></div>`
  ).join('');
}

async function loadMuTxns() {
  const cKey = 'mu_txns';
  let txns = getCached(cKey);
  if (!txns) {
    const weekAgo = Date.now() - WEEK_MS;
    const raw = await trpcPaginated('transaction.getPaginatedTransactions', { muId: cfg.muId, limit: 50 }, 10);
    txns = raw.filter(t => {
      const ts = t.createdAt || t.timestamp || t.date;
      return !ts || new Date(ts).getTime() > weekAgo;
    });
    setCache(cKey, txns);
  }
  allMuTxns = txns;
  renderTxns(txns, 'muTxnBody', currentMuTxnFilter);
}

async function loadMuMembers() {
  const cKey = 'mu_members';
  let members = getCached(cKey);
  if (!members) {
    // Use mu.getManyPaginated with member_id filter to get MU members as users
    try {
      members = await trpcPaginated('mu.getManyPaginated', { memberId: cfg.muId, limit: 50 }, 10);
    } catch { members = []; }

    // If that didn't work, get MU info and fetch members individually
    if (!members.length) {
      const mu = await trpc('mu.getById', { muId: cfg.muId });
      const memberIds = mu?.memberIds || mu?.members?.map(m => m.userId || m.id) || [];
      members = [];
      for (const uid of memberIds) {
        try {
          const u = await trpc('user.getUserById', { userId: uid });
          if (u) members.push(u);
        } catch {}
      }
    }
    setCache(cKey, members);
  }
  allMembers = members;
  renderMembers(members);
  renderBuildDist(members);
}

function renderMembers(members) {
  const el = document.getElementById('membersBody');
  if (!members.length) { el.innerHTML = '<p class="empty-msg">No member data found.</p>'; return; }

  el.innerHTML = `<div style="overflow-x:auto">
    <table class="members-table">
      <thead><tr>
        <th>#</th><th>Username</th><th>Level</th>
        <th>Strength</th><th>Work Skill</th>
        <th>Weekly DMG</th><th>Build</th>
      </tr></thead>
      <tbody>${members.map((m, i) => {
        const str  = m.strength   || 0;
        const work = m.workSkill  || m.work_skill || 0;
        const total = str + work || 1;
        const strPct  = Math.round(str  / total * 100);
        const workPct = Math.round(work / total * 100);
        const build = classifyBuild(strPct, workPct);
        return `<tr>
          <td style="color:var(--text-muted)">${i+1}</td>
          <td><strong>${esc(m.username || m.name || '—')}</strong></td>
          <td><span class="tag-level">${m.level ?? '—'}</span></td>
          <td>
            <div class="skill-bar-wrap">
              <div class="skill-bar"><div class="skill-bar-fill str" style="width:${strPct}%"></div></div>
              <span class="skill-bar-label">${fmt(str)}</span>
            </div>
          </td>
          <td>
            <div class="skill-bar-wrap">
              <div class="skill-bar"><div class="skill-bar-fill work" style="width:${workPct}%"></div></div>
              <span class="skill-bar-label">${fmt(work)}</span>
            </div>
          </td>
          <td class="mono" style="color:var(--fight-color)">${fmt(m.weeklyDamage || m.weekly_damage)}</td>
          <td>${buildTag(build)}</td>
        </tr>`;
      }).join('')}</tbody>
    </table>
  </div>`;
}

function renderBuildDist(members) {
  const el = document.getElementById('buildsBody');
  const counts = { fight: 0, hybrid: 0, economy: 0 };
  members.forEach(m => {
    const str  = m.strength || 0;
    const work = m.workSkill || m.work_skill || 0;
    const total = str + work || 1;
    const strPct  = Math.round(str  / total * 100);
    const workPct = Math.round(work / total * 100);
    counts[classifyBuild(strPct, workPct)]++;
  });
  const total = members.length || 1;
  el.innerHTML = `
    <div style="margin-bottom:0.75rem;display:flex;justify-content:flex-end">
      <button class="btn-small" onclick="document.getElementById('buildModal').style.display='flex'">⚙️ Set Thresholds</button>
    </div>
    <div class="build-dist">
      <div class="build-dist-item">
        <div class="build-dist-icon">⚔️</div>
        <div class="build-dist-count" style="color:var(--fight-color)">${counts.fight}</div>
        <div class="build-dist-label">Fight Build</div>
        <div class="build-dist-pct" style="color:var(--fight-color)">${Math.round(counts.fight/total*100)}%</div>
      </div>
      <div class="build-dist-item">
        <div class="build-dist-icon">🔀</div>
        <div class="build-dist-count" style="color:var(--hybrid-color)">${counts.hybrid}</div>
        <div class="build-dist-label">Hybrid</div>
        <div class="build-dist-pct" style="color:var(--hybrid-color)">${Math.round(counts.hybrid/total*100)}%</div>
      </div>
      <div class="build-dist-item">
        <div class="build-dist-icon">🏭</div>
        <div class="build-dist-count" style="color:var(--eco-color)">${counts.economy}</div>
        <div class="build-dist-label">Economy</div>
        <div class="build-dist-pct" style="color:var(--eco-color)">${Math.round(counts.economy/total*100)}%</div>
      </div>
    </div>`;
}

function classifyBuild(strPct, workPct) {
  if (strPct  >= buildThresh.fight) return 'fight';
  if (workPct >= buildThresh.eco)   return 'economy';
  return 'hybrid';
}
function buildTag(build) {
  const map = {
    fight:   ['⚔️ Fight',   'build-fight'],
    hybrid:  ['🔀 Hybrid',  'build-hybrid'],
    economy: ['🏭 Economy', 'build-economy'],
  };
  const [label, cls] = map[build] || ['—',''];
  return `<span class="build-tag ${cls}">${label}</span>`;
}

function sortMembers(key) {
  const sorted = [...allMembers].sort((a, b) => {
    if (key === 'level')     return (b.level || 0) - (a.level || 0);
    if (key === 'strength')  return (b.strength || 0) - (a.strength || 0);
    if (key === 'workSkill') return (b.workSkill || b.work_skill || 0) - (a.workSkill || a.work_skill || 0);
    if (key === 'build') {
      const order = { fight: 0, hybrid: 1, economy: 2 };
      const bA = classifyBuild(...getBuildPcts(a));
      const bB = classifyBuild(...getBuildPcts(b));
      return order[bA] - order[bB];
    }
    return 0;
  });
  renderMembers(sorted);
}
function getBuildPcts(m) {
  const str  = m.strength || 0;
  const work = m.workSkill || m.work_skill || 0;
  const total = str + work || 1;
  return [Math.round(str/total*100), Math.round(work/total*100)];
}

// =====================================================
//  BUILD THRESHOLDS
// =====================================================
function loadBuildThresholds() {
  try {
    const saved = JSON.parse(localStorage.getItem(BUILD_KEY));
    if (saved) buildThresh = saved;
  } catch {}
  document.getElementById('fightThresh').value = buildThresh.fight;
  document.getElementById('ecoThresh').value   = buildThresh.eco;
  document.getElementById('fightVal').textContent = buildThresh.fight;
  document.getElementById('ecoVal').textContent   = buildThresh.eco;
}
function saveBuildThresholds() {
  buildThresh.fight = parseInt(document.getElementById('fightThresh').value);
  buildThresh.eco   = parseInt(document.getElementById('ecoThresh').value);
  localStorage.setItem(BUILD_KEY, JSON.stringify(buildThresh));
  document.getElementById('buildModal').style.display = 'none';
  if (allMembers.length) { renderMembers(allMembers); renderBuildDist(allMembers); }
}

// =====================================================
//  PROFIT TRACKER
// =====================================================
function loadProfit() {
  try { return JSON.parse(localStorage.getItem(PROFIT_KEY)) || []; }
  catch { return []; }
}
function saveProfit(list) {
  localStorage.setItem(PROFIT_KEY, JSON.stringify(list));
}

function addProfitEntry() {
  document.getElementById('ptItem').value  = '';
  document.getElementById('ptBuy').value   = '';
  document.getElementById('ptSell').value  = '';
  document.getElementById('ptQty').value   = '1';
  document.getElementById('ptNotes').value = '';
  document.getElementById('profitModal').style.display = 'flex';
}
function closeProfitModal() {
  document.getElementById('profitModal').style.display = 'none';
}
function saveProfitEntry() {
  const item  = document.getElementById('ptItem').value.trim() || 'Unknown Item';
  const buy   = parseFloat(document.getElementById('ptBuy').value)  || 0;
  const sell  = parseFloat(document.getElementById('ptSell').value) || 0;
  const qty   = parseInt(document.getElementById('ptQty').value)    || 1;
  const notes = document.getElementById('ptNotes').value.trim();
  const profit = (sell - buy) * qty;
  const list = loadProfit();
  list.unshift({ id: Date.now(), item, buy, sell, qty, notes, profit, date: new Date().toISOString() });
  saveProfit(list);
  closeProfitModal();
  renderProfitList();
}
function deleteProfitEntry(id) {
  const list = loadProfit().filter(e => e.id !== id);
  saveProfit(list);
  renderProfitList();
}
function renderProfitList() {
  const list = loadProfit();
  const el = document.getElementById('profitList');
  if (!el) return;
  if (!list.length) {
    el.innerHTML = '<p class="empty-msg" style="text-align:left">No trades marked yet. Hit "+ Mark Trade" to start tracking.</p>';
    return;
  }
  el.innerHTML = list.map(e => `
    <div class="profit-entry">
      <div>
        <div class="pe-name">${esc(e.item)}</div>
        <div class="pe-detail">${fmtDate(e.date)}${e.notes ? ' · ' + esc(e.notes) : ''}</div>
      </div>
      <div class="pe-detail">Buy: <strong>${fmt(e.buy)}</strong></div>
      <div class="pe-detail">Sell: <strong>${fmt(e.sell)}</strong></div>
      <div class="pe-detail">Qty: <strong>${e.qty}</strong></div>
      <div class="pe-profit ${e.profit >= 0 ? 'pos' : 'neg'}">${e.profit >= 0 ? '+' : ''}${fmt(e.profit)}</div>
      <span class="pe-delete" onclick="deleteProfitEntry(${e.id})" title="Delete">🗑</span>
    </div>
  `).join('');
}

// =====================================================
//  STATUS
// =====================================================
function setStatus(state) {
  const dot  = document.querySelector('.status-dot');
  const text = document.querySelector('.status-text');
  if (state === 'online')  { dot.className='status-dot online'; text.textContent='Live'; }
  if (state === 'loading') { dot.className='status-dot';        text.textContent='Loading…'; }
  if (state === 'error')   { dot.className='status-dot error';  text.textContent='Error'; }
}

// =====================================================
//  UTILS
// =====================================================
function fmt(n) {
  if (n == null || n === '' || n === undefined) return '—';
  const num = parseFloat(n);
  if (isNaN(num)) return String(n);
  if (Math.abs(num) >= 1_000_000) return (num/1_000_000).toFixed(2) + 'M';
  if (Math.abs(num) >= 1_000)     return (num/1_000).toFixed(1)     + 'K';
  return num.toLocaleString(undefined, { maximumFractionDigits: 2 });
}
function fmtNet(n) {
  if (n == null) return '—';
  const s = fmt(Math.abs(n));
  return n >= 0 ? `<span style="color:var(--eco-color)">+${s}</span>` : `<span style="color:var(--fight-color)">-${s}</span>`;
}
function fmtDate(d) {
  if (!d) return '—';
  try {
    const dt = new Date(d);
    return dt.toLocaleDateString('en-IN', { day:'2-digit', month:'short' })
           + ' ' + dt.toLocaleTimeString('en-IN', { hour:'2-digit', minute:'2-digit', hour12:true });
  } catch { return String(d); }
}
function esc(s) {
  if (!s) return '';
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
function chunkArray(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}
