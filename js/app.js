/**
 * Hubble — Application Orchestration
 * Wires up the UI, API calls, and chart rendering.
 */

import {
  fetchUser, fetchRepos, fetchRepoLanguages, aggregateLanguages,
  formatJoinDate, formatRelative, formatCount,
  onRateLimitChange, rateLimit,
  NotFoundError, RateLimitError,
} from './api.js';

import {
  renderDonut, renderLegend, prepareSegments,
  animateCounter, getLangColor,
} from './chart.js';

/* ─── DOM Refs ────────────────────────────────────── */
const $  = id => document.getElementById(id);
const $$ = sel => document.querySelector(sel);

const searchForm  = $('search-form');
const searchInput = $('search-input');
const searchBtn   = $('search-btn');
const rateLimitEl = $('rate-limit');
const rateDotEl   = $('rate-dot');
const rateCountEl = $('rate-count');
const mainContent = $('main-content');

/* Chart elements are rendered dynamically — look them up lazily */
const getChartSvg       = () => $('donut-svg');
const getChartLegend    = () => $('chart-legend');
const getChartCenterNum = () => $('chart-center-num');
const getChartCenterLbl = () => $('chart-center-lbl');

/* Accessibility Screen Reader Announcer helper */
function announce(message) {
  const announcer = $('sr-announcer');
  if (announcer) {
    announcer.textContent = message;
  }
}

/* ─── State ───────────────────────────────────────── */
let currentUsername  = null;
let langAccumulator  = {};   // { langName: totalBytes }
let reposAnalysed    = 0;
let totalRepos       = 0;
let abortController  = null; // For cancelling in-flight requests

/* ─── Rate Limit Display ──────────────────────────── */
onRateLimitChange(({ remaining, limit, resetAt }) => {
  rateCountEl.textContent = `${remaining}/${limit}`;
  const pct = remaining / limit;

  rateDotEl.className = 'rate-dot';
  rateLimitEl.className = 'rate-limit-badge';

  if (pct < 0.1) {
    rateDotEl.classList.add('danger');
    rateLimitEl.classList.add('danger');
  } else if (pct < 0.3) {
    rateDotEl.classList.add('warn');
    rateLimitEl.classList.add('warn');
  }

  /* Show reset time tooltip */
  if (resetAt) {
    rateLimitEl.title = `Resets at ${resetAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
  }
});

/* ─── Search ──────────────────────────────────────── */
searchForm.addEventListener('submit', e => {
  e.preventDefault();
  const username = searchInput.value.trim();
  if (!username) return;
  startSearch(username);
});

/* Example tags */
document.addEventListener('click', e => {
  const tag = e.target.closest('.example-tag');
  if (tag) {
    searchInput.value = tag.dataset.user;
    startSearch(tag.dataset.user);
  }
});

async function startSearch(username) {
  /* Cancel any previous language-fetching stream */
  if (abortController) abortController.abort();
  abortController = new AbortController();

  currentUsername = username;
  searchInput.value = username;

  /* Reset state */
  langAccumulator = {};
  reposAnalysed   = 0;
  totalRepos      = 0;

  setLoading(true); // also calls clearContent()
  announce(`Loading GitHub profile for ${username}...`);

  try {
    /* ── Step 1: Profile ─────────────────────── */
    const user = await fetchUser(username);
    renderProfile(user);
    announce(`Loaded profile for ${user.name || user.login}.`);

    /* ── Step 2: Repositories ────────────────── */
    const repos = await fetchRepos(username);
    totalRepos = repos.length;
    renderRepos(repos);

    /* ── Step 3: Stream Language Data ─────────── */
    setLoading(false);
    showLiveIndicator(true);
    announce(`Loaded profile and ${repos.length} repositories for ${username}. Analysing programming languages...`);
    streamLanguages(username, repos, abortController.signal);

  } catch (err) {
    setLoading(false);
    renderError(err);
    announce(`Error loading profile: ${err.message || err}`);
  }
}



/* ─── Stream Language Analysis ────────────────────── */
async function streamLanguages(username, repos, signal) {
  /* Show initial empty chart */
  renderDonut(getChartSvg(), [], repos.length);
  getChartCenterNum().textContent = '0';
  getChartCenterLbl().textContent = 'analysed';

  // Determine a safe limit of detailed API requests based on remaining rate limit.
  // Leave at least 5 requests remaining for safety and cap at 15 for responsiveness.
  const detailedLimit = Math.max(0, Math.min(15, rateLimit.remaining - 5));

  for (let i = 0; i < repos.length; i++) {
    if (signal.aborted) break;
    const repo = repos[i];

    try {
      // Only fetch detailed language breakdown for the top N repos (sorted by stars) to conserve rate limits
      if (i < detailedLimit) {
        const map = await fetchRepoLanguages(username, repo.name);

        /* Merge into accumulator */
        if (map) {
          for (const [lang, bytes] of Object.entries(map)) {
            langAccumulator[lang] = (langAccumulator[lang] || 0) + bytes;
          }
        }
      } else {
        // Fallback: use pre-fetched primary language and estimate weight from repository size
        if (repo.language) {
          const lang = repo.language;
          const bytes = (repo.size || 1) * 1024; // size is in KB, convert to bytes
          langAccumulator[lang] = (langAccumulator[lang] || 0) + bytes;
        }
      }

      reposAnalysed++;
      updateChart();

    } catch (err) {
      if (err instanceof RateLimitError) {
        showLiveIndicator(false);
        showRateLimitWarning(err);
        break;
      }
      /* Skip individual repo errors silently */
      reposAnalysed++;
      updateChart();
    }
  }

  showLiveIndicator(false);
  const lbl = getChartCenterLbl();
  if (lbl) lbl.textContent = 'languages';
}

function updateChart() {
  const svgEl    = getChartSvg();
  const legendEl = getChartLegend();
  const numEl    = getChartCenterNum();
  const lblEl    = getChartCenterLbl();
  if (!svgEl) return; // Not yet rendered

  /* Sort and prepare segments */
  const sorted = Object.entries(langAccumulator)
    .map(([name, bytes]) => ({ name, bytes }))
    .sort((a, b) => b.bytes - a.bytes);

  const segments = prepareSegments(sorted);
  renderDonut(svgEl, segments, reposAnalysed);
  renderLegend(legendEl, segments);

  /* Update centre number */
  const langCount = sorted.length;
  if (numEl) numEl.textContent = langCount;
  if (lblEl) lblEl.textContent = langCount === 1 ? 'language' : 'languages';
}

/* ─── Render Profile ──────────────────────────────── */
function renderProfile(user) {
  const section = document.createElement('section');
  section.className = 'profile-section';
  section.innerHTML = `
    <div class="profile-card profile-card-animate">
      <div class="avatar-wrapper">
        <img class="avatar" src="${user.avatar}" alt="${user.name}" loading="eager"
             width="88" height="88">
      </div>
      <div class="user-info">
        <h1 class="user-name">${escHtml(user.name)}</h1>
        <div class="user-login">@${escHtml(user.login)}</div>
        ${user.bio ? `<p class="user-bio">${escHtml(user.bio)}</p>` : ''}
        <div class="user-meta">
          <span class="meta-item">
            ${calendarIcon()}
            Member since ${formatJoinDate(user.createdAt)}
          </span>
          ${user.location ? `
          <span class="meta-item">
            ${pinIcon()}
            ${escHtml(user.location)}
          </span>` : ''}
          ${user.blog ? `
          <span class="meta-item">
            ${linkIcon()}
            <a href="${sanitizeUrl(user.blog)}" target="_blank" rel="noopener noreferrer">
              ${escHtml(trimUrl(user.blog))}
            </a>
          </span>` : ''}
          ${user.company ? `
          <span class="meta-item">
            ${orgIcon()}
            ${escHtml(user.company)}
          </span>` : ''}
        </div>
        <a href="${user.htmlUrl}" target="_blank" rel="noopener noreferrer"
           class="github-link-btn">
          ${githubIcon()} View on GitHub
        </a>
      </div>
      <div class="stat-grid stagger">
        <div class="stat-item">
          <div class="stat-value" id="stat-repos">0</div>
          <div class="stat-label">Repos</div>
        </div>
        <div class="stat-item">
          <div class="stat-value" id="stat-followers">0</div>
          <div class="stat-label">Followers</div>
        </div>
        <div class="stat-item">
          <div class="stat-value" id="stat-following">0</div>
          <div class="stat-label">Following</div>
        </div>
      </div>
    </div>
  `;

  mainContent.appendChild(section);

  /* Animate counters after paint */
  requestAnimationFrame(() => {
    animateCounter($('stat-repos'),      user.publicRepos, 800, n => formatCount(n));
    animateCounter($('stat-followers'),  user.followers,   900, n => formatCount(n));
    animateCounter($('stat-following'),  user.following,   700, n => formatCount(n));
  });
}

/* ─── Render Repositories ─────────────────────────── */
function renderRepos(repos) {
  const section = document.createElement('section');
  section.className = 'content-grid animate-fade-up';

  /* Left: repo list */
  const repoCol = document.createElement('div');
  repoCol.innerHTML = `
    <div class="section-header">
      <h2 class="section-title">Repositories</h2>
      <span class="section-meta">${repos.length} public</span>
    </div>
    <div class="repos-scroll stagger" id="repos-list"></div>
  `;

  const repoList = repoCol.querySelector('#repos-list');

  repos.forEach(repo => {
    const card = document.createElement('article');
    card.className = 'repo-card';
    card.innerHTML = `
      <div class="repo-top">
        <a class="repo-name" href="${repo.htmlUrl}" target="_blank"
           rel="noopener noreferrer">${escHtml(repo.name)}</a>
        <div class="repo-badges">
          ${repo.isFork ? '<span class="fork-badge">Fork</span>' : ''}
        </div>
      </div>
      ${repo.description
        ? `<p class="repo-description">${escHtml(repo.description)}</p>`
        : ''}
      <div class="repo-footer">
        ${starIcon(repo.stars)}
        ${repo.language ? langBadge(repo.language) : ''}
        <span class="last-updated">${formatRelative(repo.updatedAt)}</span>
      </div>
    `;
    card.addEventListener('click', e => {
      if (!e.target.closest('a')) {
        window.open(repo.htmlUrl, '_blank', 'noopener,noreferrer');
      }
    });
    repoList.appendChild(card);
  });

  /* Right: chart panel */
  const chartCol = document.createElement('div');
  chartCol.innerHTML = `
    <div class="chart-panel animate-slide-right">
      <div class="section-header">
        <h2 class="section-title">Languages</h2>
        <span id="live-indicator" class="live-indicator" style="display:none">
          <span class="live-pulse"></span> Analysing
        </span>
      </div>
      <div class="chart-wrapper">
        <svg id="donut-svg" viewBox="0 0 260 260" xmlns="http://www.w3.org/2000/svg"
             role="img" aria-label="Programming language distribution donut chart">
          <!-- segments rendered by JS -->
        </svg>
        <div class="chart-center-text">
          <div class="ct-number" id="chart-center-num">—</div>
          <div class="ct-label"  id="chart-center-lbl">languages</div>
        </div>
      </div>
      <ul class="legend" id="chart-legend" aria-label="Programming languages breakdown">
        <li class="chart-loading-msg">Fetching language data…</li>
      </ul>
    </div>
  `;

  section.appendChild(repoCol);
  section.appendChild(chartCol);
  mainContent.appendChild(section);
}

/* ─── Error Rendering ─────────────────────────────── */
function renderError(err) {
  clearContent();
  const wrap = document.createElement('div');
  wrap.className = 'animate-fade-up';

  if (err instanceof RateLimitError) {
    wrap.appendChild(rateLimitErrorCard(err));
  } else if (err instanceof NotFoundError) {
    wrap.appendChild(notFoundCard());
  } else {
    wrap.appendChild(genericErrorCard(err));
  }

  mainContent.appendChild(wrap);
}

function showRateLimitWarning(err) {
  const warn = document.createElement('div');
  warn.className = 'animate-fade-in';
  warn.style.margin = 'var(--s-5) 0';
  const resetTime = err.resetAt
    ? err.resetAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : 'soon';
  warn.innerHTML = `
    <div class="rate-limit-card">
      <div style="font-size:1.5rem">⚡</div>
      <div>
        <h3 style="color:var(--warning);font-size:0.9375rem;margin-bottom:var(--s-1)">
          Rate Limit Reached
        </h3>
        <p style="font-size:0.875rem">
          Language analysis paused. Showing partial results.
          Limit resets at <strong>${resetTime}</strong>.
        </p>
      </div>
    </div>
  `;
  /* Insert above chart panel */
  const chartPanel = $$('.chart-panel');
  if (chartPanel) chartPanel.parentNode.insertBefore(warn, chartPanel);
}

function rateLimitErrorCard(err) {
  const resetTime = err.resetAt
    ? err.resetAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : 'soon';
  const el = document.createElement('div');
  el.className = 'rate-limit-card';
  el.innerHTML = `
    <div style="font-size:2rem; flex-shrink:0">⚡</div>
    <div>
      <h3 style="color:var(--warning);font-size:1rem;margin-bottom:var(--s-2)">
        GitHub API Rate Limit Reached
      </h3>
      <p style="font-size:0.875rem;margin-bottom:var(--s-3)">
        You've used all 60 unauthenticated requests for this hour.
        The limit will reset at <strong>${resetTime}</strong>.
      </p>
      <p style="font-size:0.8125rem;color:var(--text-3)">
        Tip: Authenticated requests have a limit of 5,000/hour. Add a personal
        access token in the source code to unlock higher limits.
      </p>
    </div>
  `;
  return el;
}

function notFoundCard() {
  const el = document.createElement('div');
  el.className = 'error-card';
  el.innerHTML = `
    <div class="error-icon">${errorIcon()}</div>
    <div class="error-content">
      <h3>User not found</h3>
      <p>No GitHub account found for "<strong>${escHtml(currentUsername)}</strong>".
         Check the username spelling and try again.</p>
    </div>
  `;
  return el;
}

function genericErrorCard(err) {
  const el = document.createElement('div');
  el.className = 'error-card';
  el.innerHTML = `
    <div class="error-icon">${errorIcon()}</div>
    <div class="error-content">
      <h3>Something went wrong</h3>
      <p>${escHtml(err.message || 'An unexpected error occurred.')}</p>
    </div>
  `;
  return el;
}

/* ─── Loading State ───────────────────────────────── */
function setLoading(on) {
  searchBtn.disabled = on;
  searchBtn.innerHTML = on
    ? `<span class="spinner"></span> Searching…`
    : `${searchIcon()} Search`;

  if (on) {
    mainContent.setAttribute('aria-busy', 'true');
    clearContent();
    const sProfile = skeletonProfile();
    sProfile.classList.add('skeleton-loading-placeholder');
    const sRepos = skeletonRepos();
    sRepos.classList.add('skeleton-loading-placeholder');
    mainContent.appendChild(sProfile);
    mainContent.appendChild(sRepos);
  } else {
    mainContent.removeAttribute('aria-busy');
    const placeholders = mainContent.querySelectorAll('.skeleton-loading-placeholder');
    placeholders.forEach(el => el.remove());
  }
}

function skeletonProfile() {
  const el = document.createElement('div');
  el.className = 'skeleton-profile profile-section';
  el.innerHTML = `
    <span class="skeleton skeleton-avatar"></span>
    <div class="skeleton-text-group">
      <span class="skeleton skeleton-h1"></span>
      <span class="skeleton skeleton-h2"></span>
      <span class="skeleton skeleton-p"></span>
      <span class="skeleton skeleton-p2"></span>
    </div>
    <div class="skeleton-text-group">
      <span class="skeleton skeleton-stat"></span>
      <span class="skeleton skeleton-stat"></span>
      <span class="skeleton skeleton-stat"></span>
    </div>
  `;
  return el;
}

function skeletonRepos() {
  const el = document.createElement('div');
  el.className = 'repos-list animate-fade-in';
  for (let i = 0; i < 6; i++) {
    const card = document.createElement('div');
    card.className = 'skeleton-repo';
    card.innerHTML = `
      <span class="skeleton" style="height:18px;width:${30 + Math.random()*40}%"></span>
      <span class="skeleton" style="height:14px;width:${50 + Math.random()*40}%"></span>
      <span class="skeleton" style="height:14px;width:${20 + Math.random()*30}%"></span>
    `;
    el.appendChild(card);
  }
  return el;
}

function showLiveIndicator(on) {
  const el = $('live-indicator');
  if (el) el.style.display = on ? 'flex' : 'none';
}

function clearContent() {
  mainContent.innerHTML = '';
}

/* ─── SVG Icon Helpers ────────────────────────────── */
function calendarIcon() {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
    <path d="M4.75 0a.75.75 0 0 1 .75.75V2h5V.75a.75.75 0 0 1 1.5 0V2h1.25c.966 0 1.75.784 1.75 1.75v10.5A1.75 1.75 0 0 1 13.25 16H2.75A1.75 1.75 0 0 1 1 14.25V3.75C1 2.784 1.784 2 2.75 2H4V.75A.75.75 0 0 1 4.75 0ZM2.5 7.5v6.75c0 .138.112.25.25.25h10.5a.25.25 0 0 0 .25-.25V7.5Z"/>
  </svg>`;
}

function pinIcon() {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
    <path d="m12.596 11.596-3.535 3.536a1.5 1.5 0 0 1-2.122 0l-3.535-3.536a6.5 6.5 0 1 1 9.192 0Zm-1.06-1.06a5 5 0 1 0-7.072 0L8 14.07l3.536-3.534ZM8 9a2 2 0 1 1-.001-3.999A2 2 0 0 1 8 9Z"/>
  </svg>`;
}

function linkIcon() {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
    <path d="m7.775 3.275 1.25-1.25a3.5 3.5 0 1 1 4.95 4.95l-2.5 2.5a3.5 3.5 0 0 1-4.95 0 .751.751 0 0 1 .018-1.042.751.751 0 0 1 1.042-.018 2 2 0 0 0 2.83 0l2.5-2.5a2.002 2.002 0 0 0-2.83-2.83l-1.25 1.25a.751.751 0 0 1-1.042-.018.751.751 0 0 1-.018-1.042Zm-4.69 9.64a2 2 0 0 1 0-2.83l2.5-2.5a2 2 0 0 1 2.83 0 .751.751 0 0 1-.018 1.042.751.751 0 0 1-1.042.018 .5.5 0 0 0-.707 0l-2.5 2.5a.5.5 0 0 0 .707.707l1.25-1.25a.751.751 0 1 1 1.06 1.06l-1.25 1.25a2 2 0 0 1-2.83 0Z"/>
  </svg>`;
}

function orgIcon() {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
    <path d="M1.5 14.25c0 .138.112.25.25.25H4v-1.25a.75.75 0 0 1 .75-.75h2.5a.75.75 0 0 1 .75.75v1.25h2.25a.25.25 0 0 0 .25-.25V1.75a.25.25 0 0 0-.25-.25h-8.5a.25.25 0 0 0-.25.25ZM0 14.25C0 15.216.784 16 1.75 16H14.25A1.75 1.75 0 0 0 16 14.25v-3.5A1.75 1.75 0 0 0 14.25 9H10.5v5.25a.25.25 0 0 1-.25.25H1.75A1.75 1.75 0 0 1 0 12.75ZM3.75 3h.5a.75.75 0 0 1 0 1.5h-.5a.75.75 0 0 1 0-1.5ZM3 7.25a.75.75 0 0 1 .75-.75h.5a.75.75 0 0 1 0 1.5h-.5A.75.75 0 0 1 3 7.25Zm4 0A.75.75 0 0 1 7.75 6.5h.5a.75.75 0 0 1 0 1.5h-.5A.75.75 0 0 1 7 7.25Zm-3.25-2.5h.5a.75.75 0 0 1 0 1.5h-.5a.75.75 0 0 1 0-1.5ZM7 4.75A.75.75 0 0 1 7.75 4h.5a.75.75 0 0 1 0 1.5h-.5A.75.75 0 0 1 7 4.75Z"/>
  </svg>`;
}

function githubIcon() {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
    <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8Z"/>
  </svg>`;
}

function searchIcon() {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
    <path d="M10.68 11.74a6 6 0 0 1-7.922-8.982 6 6 0 0 1 8.982 7.922l3.04 3.04a.749.749 0 0 1-.326 1.275.749.749 0 0 1-.734-.215ZM11.5 7a4.499 4.499 0 1 0-8.997 0A4.499 4.499 0 0 0 11.5 7Z"/>
  </svg>`;
}

function errorIcon() {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16" fill="white" aria-hidden="true">
    <path d="M4.47.22A.749.749 0 0 1 5 0h6c.199 0 .389.079.53.22l4.25 4.25c.141.14.22.331.22.53v6a.749.749 0 0 1-.22.53l-4.25 4.25A.749.749 0 0 1 11 16H5a.749.749 0 0 1-.53-.22L.22 11.53A.749.749 0 0 1 0 11V5c0-.199.079-.389.22-.53Zm.84 1.28L1.5 5.31v5.38l3.81 3.81h5.38l3.81-3.81V5.31L10.69 1.5ZM8 4a.75.75 0 0 1 .75.75v3.5a.75.75 0 0 1-1.5 0v-3.5A.75.75 0 0 1 8 4Zm0 8a1 1 0 1 1 0-2 1 1 0 0 1 0 2Z"/>
  </svg>`;
}

function starIcon(count) {
  return `<span class="star-count">
    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d="M8 .25a.75.75 0 0 1 .673.418l1.882 3.815 4.21.612a.75.75 0 0 1 .416 1.279l-3.046 2.97.719 4.192a.751.751 0 0 1-1.088.791L8 12.347l-3.766 1.98a.75.75 0 0 1-1.088-.79l.72-4.194L.818 6.374a.75.75 0 0 1 .416-1.28l4.21-.611L7.327.668A.75.75 0 0 1 8 .25Z"/>
    </svg>
    ${formatCount(count)}
  </span>`;
}

function langBadge(lang) {
  const color = getLangColor(lang);
  return `<span class="lang-badge">
    <span class="lang-dot" style="background:${color}"></span>
    ${escHtml(lang)}
  </span>`;
}

/* ─── Security Helpers ────────────────────────────── */
function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function sanitizeUrl(url) {
  try {
    const u = new URL(url.startsWith('http') ? url : `https://${url}`);
    if (u.protocol === 'https:' || u.protocol === 'http:') return u.href;
  } catch {}
  return '#';
}

function trimUrl(url) {
  return url.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '');
}

/* ─── Default Search ──────────────────────────────── */
/* The dashboard starts with the beautiful landing/hero page. */
/* Users can select from the example tags or type any username to start. */
