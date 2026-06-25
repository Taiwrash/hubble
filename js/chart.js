/**
 * Hubble — SVG Donut Chart Engine
 * Pure SVG, zero dependencies, animatable, live-updatable.
 */

/* ─── GitHub-official Language Colours ────────────── */
export const LANG_COLORS = {
  'JavaScript':       '#f1e05a',
  'TypeScript':       '#3178c6',
  'Python':           '#3572A5',
  'Java':             '#b07219',
  'C++':              '#f34b7d',
  'C':                '#555555',
  'C#':               '#178600',
  'Go':               '#00ADD8',
  'Rust':             '#dea584',
  'Ruby':             '#701516',
  'PHP':              '#4F5D95',
  'Swift':            '#F05138',
  'Kotlin':           '#A97BFF',
  'HTML':             '#e34c26',
  'CSS':              '#563d7c',
  'SCSS':             '#c6538c',
  'Shell':            '#89e051',
  'Bash':             '#89e051',
  'PowerShell':       '#012456',
  'Dart':             '#00B4AB',
  'Scala':            '#c22d40',
  'R':                '#198CE7',
  'Vue':              '#41b883',
  'Svelte':           '#FF3E00',
  'Jupyter Notebook': '#DA5B0B',
  'Dockerfile':       '#384d54',
  'Lua':              '#000080',
  'Perl':             '#0298c3',
  'Haskell':          '#5e5086',
  'Elixir':           '#6e4a7e',
  'Clojure':          '#db5855',
  'Elm':              '#60B5CC',
  'Erlang':           '#B83998',
  'F#':               '#B845FC',
  'OCaml':            '#3be133',
  'Crystal':          '#000100',
  'Nix':              '#7e7eff',
  'HCL':              '#844FBA',
  'YAML':             '#cb171e',
  'Makefile':         '#427819',
  'CMake':            '#DA3434',
  'TeX':              '#3D6117',
  'Markdown':         '#083fa1',
  'Other':            '#9ca3af',
};

/** Generate a deterministic colour for unknown languages */
function hashColor(str) {
  let hash = 0;
  for (const c of str) hash = (hash << 5) - hash + c.charCodeAt(0);
  const h = Math.abs(hash) % 360;
  return `hsl(${h}, 55%, 50%)`;
}

export function getLangColor(lang) {
  return LANG_COLORS[lang] ?? hashColor(lang);
}

/* ─── Chart Configuration ─────────────────────────── */
const CX = 130;          // SVG centre x
const CY = 130;          // SVG centre y
const OUTER_R = 100;     // outer radius
const INNER_R = 60;      // inner radius (donut hole)
const GAP_DEG = 1.5;     // gap between segments (degrees)
const MAX_SEGMENTS = 8;  // collapse tail into "Other"

/* ─── Polar ↔ Cartesian ───────────────────────────── */
function polar(cx, cy, r, angleDeg) {
  const rad = (angleDeg - 90) * (Math.PI / 180);
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

function round(n) { return Math.round(n * 1000) / 1000; }

/**
 * Build an SVG arc path string for a donut segment.
 * @param {number} startDeg
 * @param {number} endDeg
 */
function arcPath(startDeg, endDeg) {
  const s  = polar(CX, CY, OUTER_R, startDeg);
  const e  = polar(CX, CY, OUTER_R, endDeg);
  const si = polar(CX, CY, INNER_R, endDeg);
  const ei = polar(CX, CY, INNER_R, startDeg);
  const large = endDeg - startDeg > 180 ? 1 : 0;

  return [
    `M ${round(s.x)}  ${round(s.y)}`,
    `A ${OUTER_R} ${OUTER_R} 0 ${large} 1 ${round(e.x)} ${round(e.y)}`,
    `L ${round(si.x)} ${round(si.y)}`,
    `A ${INNER_R} ${INNER_R} 0 ${large} 0 ${round(ei.x)} ${round(ei.y)}`,
    'Z',
  ].join(' ');
}

/* ─── Data Preparation ────────────────────────────── */

/**
 * Normalise raw language bytes into chart-ready segments.
 * Collapses small languages into "Other".
 * @param {{ name: string; bytes: number }[]} langs sorted desc
 * @returns {{ name: string; bytes: number; color: string; pct: number }[]}
 */
export function prepareSegments(langs) {
  const total = langs.reduce((s, l) => s + l.bytes, 0);
  if (total === 0) return [];

  let top = langs.slice(0, MAX_SEGMENTS);
  const rest = langs.slice(MAX_SEGMENTS);

  const segments = top.map(l => ({
    name:  l.name,
    bytes: l.bytes,
    color: getLangColor(l.name),
    pct:   (l.bytes / total) * 100,
  }));

  if (rest.length) {
    const otherBytes = rest.reduce((s, l) => s + l.bytes, 0);
    segments.push({
      name:  'Other',
      bytes: otherBytes,
      color: getLangColor('Other'),
      pct:   (otherBytes / total) * 100,
    });
  }

  return segments;
}

/* ─── Chart Rendering ─────────────────────────────── */

/**
 * Draw (or redraw) the donut chart into an SVG element.
 * @param {SVGElement} svgEl  — the <svg> element to draw into
 * @param {{ name: string; pct: number; color: string }[]} segments
 * @param {number} totalRepos — shown in the centre label
 */
export function renderDonut(svgEl, segments, totalRepos) {
  /* Snapshot old paths for transition (fade in new) */
  const oldGroup = svgEl.querySelector('.chart-svg-group');

  /* Build new group */
  const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  g.classList.add('chart-svg-group');

  if (segments.length === 0) {
    /* Empty ring */
    const empty = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    empty.setAttribute('cx', CX);
    empty.setAttribute('cy', CY);
    empty.setAttribute('r', (OUTER_R + INNER_R) / 2);
    empty.setAttribute('fill', 'none');
    empty.setAttribute('stroke', 'var(--border)');
    empty.setAttribute('stroke-width', OUTER_R - INNER_R);
    g.appendChild(empty);
  } else {
    let current = 0;
    const total = segments.reduce((s, seg) => s + seg.pct, 0);

    segments.forEach((seg, i) => {
      const sweep = (seg.pct / total) * (360 - segments.length * GAP_DEG);
      const start = current + (i > 0 ? GAP_DEG : 0);
      const end   = start + sweep;
      current = end;

      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', arcPath(start, end));
      path.setAttribute('fill', seg.color);
      path.classList.add('donut-segment');
      path.style.animationDelay = `${i * 40}ms`;
      path.style.opacity = '0';
      path.style.animation = `segment-appear 400ms cubic-bezier(0.16,1,0.3,1) ${i * 40}ms forwards`;

      /* Tooltip via title */
      const title = document.createElementNS('http://www.w3.org/2000/svg', 'title');
      title.textContent = `${seg.name}: ${seg.pct.toFixed(1)}%`;
      path.appendChild(title);

      g.appendChild(path);
    });
  }

  /* Swap with cross-fade */
  if (oldGroup) {
    oldGroup.style.transition = 'opacity 200ms ease';
    oldGroup.style.opacity = '0';
    setTimeout(() => {
      oldGroup.remove();
      svgEl.appendChild(g);
    }, 200);
  } else {
    svgEl.appendChild(g);
  }
}

/* ─── Legend Rendering ────────────────────────────── */

/**
 * Render the language legend.
 * @param {HTMLElement} container
 * @param {{ name: string; pct: number; color: string }[]} segments
 */
export function renderLegend(container, segments) {
  container.innerHTML = '';

  if (segments.length === 0) {
    container.innerHTML = '<p class="chart-loading-msg">No language data yet.</p>';
    return;
  }

  segments.forEach((seg, i) => {
    const item = document.createElement('div');
    item.className = 'legend-item';
    item.style.animationDelay = `${i * 50}ms`;
    item.innerHTML = `
      <span class="legend-dot" style="background:${seg.color}"></span>
      <span class="legend-name">${seg.name}</span>
      <span class="legend-pct">${seg.pct.toFixed(1)}%</span>
    `;
    container.appendChild(item);
  });
}

/* ─── Counter Animation ───────────────────────────── */

/**
 * Animate a number from 0 to target with easing.
 * @param {HTMLElement} el
 * @param {number} target
 * @param {number} [duration=700]
 * @param {(n:number) => string} [format]
 */
export function animateCounter(el, target, duration = 700, format = n => n.toLocaleString()) {
  const start = performance.now();
  const initial = parseInt(el.dataset.current || '0', 10) || 0;
  el.dataset.current = target;

  function easeOutQuart(t) { return 1 - (1 - t) ** 4; }

  function tick(now) {
    const elapsed  = now - start;
    const progress = Math.min(elapsed / duration, 1);
    const value    = Math.round(initial + (target - initial) * easeOutQuart(progress));
    el.textContent = format(value);
    if (progress < 1) requestAnimationFrame(tick);
    else {
      el.textContent = format(target);
      el.classList.add('updated');
      setTimeout(() => el.classList.remove('updated'), 300);
    }
  }

  requestAnimationFrame(tick);
}
