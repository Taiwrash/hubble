# Hubble — User Manual

> **Explore the universe of open source.**

Hubble is a GitHub profile analytics dashboard that lets you search any GitHub username and instantly see their profile details, top repositories, and a live programming language breakdown.

---

## Table of Contents

1. [Getting Started](#getting-started)
2. [How to Use Hubble](#how-to-use-hubble)
3. [Features](#features)
4. [Understanding the Language Chart](#understanding-the-language-chart)
5. [Rate Limiting](#rate-limiting)
6. [Troubleshooting](#troubleshooting)
7. [Technical Notes](#technical-notes)

---

## Getting Started

Hubble is a static web application — no server required.

### Option A: Open Directly (Recommended)

```
open index.html
```

Or double-click `index.html` in your file manager. Hubble works with any modern browser (Chrome, Firefox, Safari, Edge).

> ⚠️ **Note:** Some browsers block `fetch()` requests from `file://` URLs due to CORS policies. If you see a network error, use Option B.

### Option B: Local Server

```bash
# Python 3
python3 -m http.server 8080

# Node.js (npx)
npx serve .
```

Then open [http://localhost:8080](http://localhost:8080) in your browser.

---

## How to Use Hubble

### 1. Search a Username

Type any valid GitHub username into the search bar at the top of the page and press **Enter** or click **Search**.

**Example usernames to try:**
- `torvalds` — Linus Torvalds (Linux creator)
- `gaearon` — Dan Abramov (React core team)
- `sindresorhus` — prolific open-source author
- `DHH` — David Heinemeier Hansson (Rails creator)

### 2. View the Profile Card

Once results load, you'll see:

| Field | Description |
|-------|-------------|
| **Avatar** | Profile photo from GitHub |
| **Name & Username** | Display name and `@handle` |
| **Bio** | Short description from GitHub profile |
| **Member Since** | Account creation date |
| **Location** | City/country if set |
| **Website** | Personal blog or portfolio link |
| **Company** | Organisation affiliation |
| **Repos / Followers / Following** | Animated live counters |
| **View on GitHub** | Direct link to their profile |

### 3. Browse Repositories

Repositories are sorted by **⭐ stars (descending)** — highest impact first.

Each card shows:
- **Repository name** (clickable, opens GitHub)
- **Description** (if available)
- **Language badge** with colour-coded dot
- **Star count**
- **Last updated** (relative time, e.g., "3mo ago")
- **Fork badge** if the repo is a fork

Click anywhere on a card (or the repo name) to open it on GitHub.

### 4. Watch the Language Chart

The **donut chart** in the right panel updates **live** as Hubble fetches language data from each repository. You'll see:

- The chart segments grow as more repos are analysed
- The centre counter shows how many languages have been found
- A **"Analysing"** live indicator pulses while fetching

---

## Features

### Profile Summary Card
Complete profile information including all required fields: name, username, join date, location, bio, follower count, public repo count, and a direct link to GitHub.

### Repository Explorer
All public repositories fetched via pagination (up to 100 per request), sorted by star count. Each repository displays language, description, stars, and relative update time.

### Live Language Chart
- **SVG donut chart** drawn natively — no external libraries
- Language data fetched per-repo from the GitHub Languages API
- Aggregated by **byte count** (not file count) — accurately reflects codebase weight
- Top 8 languages shown individually; remaining grouped as "Other"
- Uses **GitHub's official language colour palette**

### Rate Limit Monitor
- Persistent counter in the header: `XX/60 req`
- Turns **yellow** when below 30% remaining
- Turns **red** when below 10% remaining
- Hover over the badge to see the reset time
- If the limit is exhausted mid-analysis, partial results are shown with a clear message

---

## Understanding the Language Chart

### How bytes are counted

GitHub measures language distribution by **byte count of source files**, not by number of files. This means:

- A 10,000-byte Python file contributes more than ten 100-byte JavaScript files
- Minified production builds can skew results (GitHub typically excludes these via Linguist)
- Vendor/library files are usually excluded by GitHub's Linguist tool

### "Other" category

When more than 8 distinct languages are detected, the smallest ones are grouped into **"Other"** to keep the chart readable.

### Why some repos have no language

Some repositories (documentation, configuration, or empty repos) report no language. These are counted in the total repo count but do not affect the language chart.

---

## Rate Limiting

The GitHub REST API allows **60 unauthenticated requests per hour** per IP address.

Hubble makes:
- 1 request to fetch the user profile
- 1–N requests to fetch repositories (1 per 100 repos)
- 1 request per repository to fetch language data

For a user with 50 repos, this uses approximately **52 requests**.

### What happens when the limit is reached?

1. A **warning banner** appears above the chart panel
2. The language chart shows partial results (repos analysed so far)
3. The profile card and repo list remain fully visible
4. The header badge shows the exact reset time

### Increasing the limit (optional)

To increase to **5,000 requests/hour**, add a GitHub Personal Access Token:

1. Go to [GitHub Settings → Developer settings → Tokens](https://github.com/settings/tokens)
2. Generate a new token (no special scopes needed for public data)
3. In `js/api.js`, add the header:

```javascript
headers: {
  'Authorization': 'Bearer YOUR_TOKEN_HERE',
  'Accept': 'application/vnd.github+json',
  ...
}
```

⚠️ Never commit your token to version control.

---

## Troubleshooting

| Problem | Solution |
|---------|----------|
| "User not found" error | Check the username spelling. GitHub usernames are case-insensitive but must exist. |
| Network error on `file://` | Run via a local server (`python3 -m http.server 8080`). |
| Chart doesn't update | Rate limit may have been reached. Check the badge in the header. |
| Very slow loading | Users with 1000+ repos take longer. The chart will still update live. |
| "Something went wrong" | Check your internet connection. GitHub API may be having an outage. |

---

## Technical Notes

### Project Structure

```
gh-analyser/
├── index.html         — App shell, semantic HTML, SEO meta
├── slides.html        — 6-slide presentation deck
├── README.md          — This user manual
├── css/
│   ├── style.css      — Design system (Dieter Rams palette, components)
│   └── animations.css — Motion library (keyframes, stagger, transitions)
└── js/
    ├── api.js         — GitHub REST API layer (fetch, pagination, errors)
    ├── chart.js       — SVG donut chart engine (path arcs, legend, colours)
    └── app.js         — Application orchestration (search, render, stream)
```

### Technologies

| Layer | Technology |
|-------|-----------|
| Markup | HTML5 (semantic elements, ARIA roles) |
| Styles | Vanilla CSS (custom properties, grid, flexbox, backdrop-filter) |
| Logic | Vanilla JavaScript ES2022 (ES Modules, async/await, AbortController) |
| Chart | Pure SVG (no canvas, no D3, no Chart.js) |
| Fonts | Inter + JetBrains Mono via Google Fonts |
| API | GitHub REST API v2022-11-28 |
| Dependencies | **Zero** |

### Browser Support

Hubble targets all modern browsers (Baseline Widely Available):
- Chrome / Edge 90+
- Firefox 90+
- Safari 15+

---

## Design Philosophy

Hubble follows **Dieter Rams' 10 Principles of Good Design**:

> *"Good design is as little design as possible."*

- **Monotone palette** — one accent colour (GitHub blue), warm off-white background
- **Typographic hierarchy** — Inter typeface, consistent weight and size scale
- **8px grid** — all spacing follows a strict 4/8/12/16… scale
- **No decorative elements** — every pixel serves a function
- **Honest UI** — errors explained plainly, rate limit always visible
- **Live feedback** — the chart updating in real time is both useful and truthful

---

*Built with ♥ for the GitHub REST API intermediate challenge.*

