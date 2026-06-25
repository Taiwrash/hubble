/**
 * Hubble — GitHub REST API Layer
 * Handles all communication with api.github.com
 * Tracks rate limits and exposes structured data objects.
 */

const API_BASE = 'https://api.github.com';

/** Shared rate-limit state */
export const rateLimit = {
  remaining: 60,
  limit: 60,
  resetAt: null,
};

/** Notify registered listeners when rate limit updates */
const rateLimitListeners = [];
export function onRateLimitChange(fn) { rateLimitListeners.push(fn); }
function emitRateLimit() { rateLimitListeners.forEach(fn => fn({ ...rateLimit })); }

/**
 * Core fetch wrapper — reads headers, handles errors.
 * @param {string} url
 * @param {RequestInit} [options]
 * @returns {Promise<any>}
 */
async function ghFetch(url, options = {}) {
  const res = await fetch(url, {
    headers: {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
    ...options,
  });

  /* Update rate limit from every response */
  const remaining = res.headers.get('X-RateLimit-Remaining');
  const limit     = res.headers.get('X-RateLimit-Limit');
  const reset     = res.headers.get('X-RateLimit-Reset');

  if (remaining !== null) {
    rateLimit.remaining = parseInt(remaining, 10);
    rateLimit.limit     = parseInt(limit, 10);
    rateLimit.resetAt   = reset ? new Date(parseInt(reset, 10) * 1000) : null;
    emitRateLimit();
  }

  if (res.status === 403 || res.status === 429) {
    const body = await res.json().catch(() => ({}));
    const resetTime = rateLimit.resetAt
      ? rateLimit.resetAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      : 'soon';
    throw new RateLimitError(
      body.message || `Rate limited. Resets at ${resetTime}.`,
      rateLimit.resetAt
    );
  }

  if (res.status === 404) {
    throw new NotFoundError(`User not found. Check the username and try again.`);
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(body.message || `GitHub API error: ${res.status}`, res.status);
  }

  return res.json();
}

/* ─── Custom Errors ───────────────────────────────── */

export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

export class NotFoundError extends ApiError {
  constructor(message) {
    super(message, 404);
    this.name = 'NotFoundError';
  }
}

export class RateLimitError extends ApiError {
  constructor(message, resetAt) {
    super(message, 429);
    this.name = 'RateLimitError';
    this.resetAt = resetAt;
  }
}

/* ─── API Methods ─────────────────────────────────── */

/**
 * Fetch a user's profile.
 * @param {string} username
 * @returns {Promise<GithubUser>}
 */
export async function fetchUser(username) {
  const data = await ghFetch(`${API_BASE}/users/${encodeURIComponent(username)}`);
  return normaliseUser(data);
}

/**
 * Fetch ALL public repositories for a user (handles pagination).
 * @param {string} username
 * @returns {Promise<GithubRepo[]>}
 */
export async function fetchRepos(username) {
  const repos = [];
  let page = 1;
  const perPage = 100;

  while (true) {
    const url = `${API_BASE}/users/${encodeURIComponent(username)}/repos`
      + `?per_page=${perPage}&page=${page}&sort=pushed&direction=desc`;
    const batch = await ghFetch(url);
    repos.push(...batch.map(normaliseRepo));
    if (batch.length < perPage) break;
    page++;
  }

  /* Sort by stars descending */
  return repos.sort((a, b) => b.stars - a.stars);
}

/**
 * Fetch language byte breakdown for a single repo.
 * Returns null if rate limited to allow graceful partial rendering.
 * @param {string} owner
 * @param {string} repo
 * @returns {Promise<Record<string, number> | null>}
 */
export async function fetchRepoLanguages(owner, repo) {
  try {
    return await ghFetch(
      `${API_BASE}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/languages`
    );
  } catch (err) {
    if (err instanceof RateLimitError) throw err; // Bubble up rate limit
    return null; // Ignore individual repo errors
  }
}

/* ─── Normalisation ───────────────────────────────── */

function normaliseUser(raw) {
  return {
    login:       raw.login,
    name:        raw.name || raw.login,
    avatar:      raw.avatar_url,
    bio:         raw.bio || '',
    location:    raw.location || '',
    company:     raw.company || '',
    blog:        raw.blog || '',
    email:       raw.email || '',
    followers:   raw.followers ?? 0,
    following:   raw.following ?? 0,
    publicRepos: raw.public_repos ?? 0,
    createdAt:   new Date(raw.created_at),
    htmlUrl:     raw.html_url,
    twitterUser: raw.twitter_username || '',
  };
}

function normaliseRepo(raw) {
  return {
    id:          raw.id,
    name:        raw.name,
    fullName:    raw.full_name,
    description: raw.description || '',
    language:    raw.language || '',
    stars:       raw.stargazers_count ?? 0,
    forks:       raw.forks_count ?? 0,
    isFork:      raw.fork,
    updatedAt:   new Date(raw.updated_at),
    htmlUrl:     raw.html_url,
    topics:      raw.topics || [],
    size:        raw.size ?? 0,
  };
}

/* ─── Helpers ─────────────────────────────────────── */

/**
 * Aggregate language maps from multiple repos.
 * @param {Record<string, number>[]} languageMaps
 * @returns {{ name: string; bytes: number }[]} sorted desc
 */
export function aggregateLanguages(languageMaps) {
  const totals = {};
  for (const map of languageMaps) {
    if (!map) continue;
    for (const [lang, bytes] of Object.entries(map)) {
      totals[lang] = (totals[lang] || 0) + bytes;
    }
  }
  return Object.entries(totals)
    .map(([name, bytes]) => ({ name, bytes }))
    .sort((a, b) => b.bytes - a.bytes);
}

/**
 * Format a date as "Member since Month YYYY".
 * @param {Date} date
 */
export function formatJoinDate(date) {
  return date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

/**
 * Format a date relative to now.
 * @param {Date} date
 */
export function formatRelative(date) {
  const now = Date.now();
  const diff = now - date.getTime();
  const secs = diff / 1000;
  const mins = secs / 60;
  const hrs  = mins / 60;
  const days = hrs / 24;

  if (days < 1)   return `${Math.floor(hrs)}h ago`;
  if (days < 30)  return `${Math.floor(days)}d ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}

/**
 * Format a large number with k/m suffix.
 * @param {number} n
 */
export function formatCount(n) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}m`;
  if (n >= 1_000)     return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}
