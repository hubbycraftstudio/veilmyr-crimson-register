
import './style.css';
import { doc, onSnapshot, setDoc } from 'firebase/firestore';
import { db } from './firebase.js';
import bloodSealSvg from './assets/crimson-register-with-meter.svg?raw';

const KEY = 'veilmyr-crimson-register-draft-v1';
const REF = doc(db, 'register', 'published');
const app = document.querySelector('#app');
const MAX = 25;

const newId = () => globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`;
const newRow = () => ({ id: newId(), initiative: '', name: '', innateMagic: false, items: '', alive: true, soulPresent: true });
const escaped = (value) => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
const itemNames = (value) => String(value ?? '').split(/\r?\n/).map(x => x.trim()).filter(Boolean);
const sorted = (rows) => [...rows].sort((a, b) => (Number(b.initiative) || 0) - (Number(a.initiative) || 0));

// Standard Roman numerals, read bottom-to-top on the display.
function numeralDots(n) {
  if (!Number.isInteger(n) || n < 0 || n > 39) throw new Error('Each person can have 0–39 magical items.');
  const tokens = [['X', 10], ['IX', 9], ['V', 5], ['IV', 4], ['I', 1]];
  let roman = '';
  for (const [symbol, value] of tokens) {
    while (n >= value) { roman += symbol; n -= value; }
  }
  const colours = { X: 'blue', V: 'yellow', I: 'white' };
  return [...roman].map(ch => colours[ch]);
}

function glyphMarkup(row, index) {
  const dots = numeralDots(Number(row.magicalItems) || 0);
  const mode = row.alive !== false
    ? (row.innateMagic ? 'magical' : 'ordinary')
    : 'departed';

  const soulMarkup = row.soulPresent
    ? `<g class="soul-orb">
        <circle class="orb-halo" cx="50" cy="-6" r="9" />
        <circle class="orb-core" cx="50" cy="-6" r="5.5" />
      </g>`
    : '';

  const dotMarkup = dots.map((colour, i) =>
    `<circle class="item-dot ${colour}" cx="97" cy="${135 - i * 14}" r="4.5" />`
  ).join('');

  return `<div class="glyph-cell" aria-label="Soul ${index + 1}">
    <div class="glyph ${mode}">
      <svg viewBox="0 0 125 150" aria-hidden="true">
        ${soulMarkup}
        <g class="figure">
          <circle cx="50" cy="25" r="14"/>
          <path d="M50 39V99 M21 63H79 M50 99L25 139 M50 99L75 139"/>
        </g>
        <g class="item-dots">${dotMarkup}</g>
      </svg>
    </div>
  </div>`;
}

function loadDraft() {
  try {
    const stored = JSON.parse(localStorage.getItem(KEY));
    if (Array.isArray(stored)) return stored.map(normalizeRow).slice(0, MAX);
  } catch (error) {
    console.warn('Draft could not be restored:', error);
  }
  return [];
}

function normalizeRow(row) {
  return {
    id: typeof row.id === 'string' ? row.id : newId(),
    initiative: String(row.initiative ?? ''),
    name: String(row.name ?? ''),
    innateMagic: row.innateMagic === true,
    items: String(row.items ?? ''),
    soulPresent: row.soulPresent !== false,
    alive: row.alive !== false,
  };
}

const isDisplay = location.pathname.replace(/\/$/, '').endsWith('/display');
if (isDisplay) renderDisplay(); else renderDM();


function renderDisplay() {
  app.innerHTML = `<main class="display-view">
    <button id="fullscreen-btn" class="fullscreen-btn" title="Toggle fullscreen">⛶</button>
    <div id="display-grid" class="display-grid"></div>
    <div id="blood-seal" class="blood-seal">
      ${bloodSealSvg}
    </div>
    <div id="display-status" class="connection" aria-live="polite">Connecting…</div>
  </main>`;

  document.querySelector('#fullscreen-btn').addEventListener('click', async () => {
    if (document.fullscreenElement) {
      await document.exitFullscreen();
    } else {
      await document.documentElement.requestFullscreen();
    }
  });

  const grid = document.querySelector('#display-grid');
  const status = document.querySelector('#display-status');

  // Keep the player display awake, including on battery power.
  let wakeLock = null;

  async function keepScreenAwake() {
    if (!('wakeLock' in navigator)) {
      console.warn('Screen wake lock not supported.');
      return;
    }

    if (document.visibilityState !== 'visible' || wakeLock) return;

    try {
      wakeLock = await navigator.wakeLock.request('screen');
      console.log('Screen wake lock active.');

      wakeLock.addEventListener('release', () => {
        wakeLock = null;
        console.log('Screen wake lock released.');
      });
    } catch (error) {
      console.warn('Could not keep screen awake:', error);
    }
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      keepScreenAwake();
    }
  });

  keepScreenAwake();


  grid.innerHTML = `<div class="empty">Waiting for a published register…</div>`;

  onSnapshot(REF, (snapshot) => {
    const data = snapshot.data();
    const glyphs = Array.isArray(data?.glyphs) ? data.glyphs.slice(0, MAX) : [];
    const soulPoints = glyphs.reduce((total, person) => {
      if (person.soulPresent !== false) return total;
      return total + 5 + (person.innateMagic ? 3 : 0);
    }, 0);

    document.querySelectorAll('#blood-seal .blood-seal-level')
      .forEach((level, index) => {
        const threshold = (index + 1) * 5;
        const start = Math.max(0, threshold - 7);
        const brightness = Math.max(0, Math.min(1,
          (soulPoints - start) / (threshold - start)
        ));

        level.style.opacity = brightness;
      });

    document.querySelectorAll('#blood-seal .blood-seal-node')
      .forEach((node, index) => {
        const threshold = (index + 1) * 5;
        node.classList.toggle('is-lit', soulPoints >= threshold);
      });

    console.log(`Blood Seal: ${soulPoints}/40 points`);

    // Symmetrical progress bar (0–40 points)
    const progress = Math.min(1, Math.max(0, soulPoints / 40));

    document.querySelectorAll('#seal-meter-svg .seal-meter-svg-fill')
      .forEach(fill => {
        fill.style.strokeDasharray = `${225 * progress} 225`;
      });

    let position = 0;
    grid.innerHTML = [8, 9, 8].map((size) =>
      `<div class="glyph-row">${Array.from({ length: size }, () => {
        const row = glyphs[position++];
        return row
          ? glyphMarkup(row, position - 1)
          : '<div class="glyph-cell vacant"></div>';
      }).join('')}</div>`
    ).join('');

    status.textContent = snapshot.metadata.fromCache
      ? 'Offline · showing cached display'
      : 'Connected';
    status.className = `connection ${snapshot.metadata.fromCache ? 'offline' : ''}`;
  }, (error) => {
    status.textContent = `Sync error: ${error.message}`;
    status.className = 'connection offline';
  });
}


function renderDM() {
  let rows = loadDraft();
  let dirty = false;
  let publishing = false;
  let lastPublished = null;

  app.innerHTML = `<main class="dashboard">
    <header>
      <div>
        <h1>Crimson Register</h1>
        <p>Private DM dashboard · <a href="/display/" target="_blank" rel="noopener">Open player display ↗</a></p>
      </div>
      <div class="header-status">
        <span id="sync-label">Connecting…</span>
        <span id="published-label">Never published in this session</span>
      </div>
    </header>
    <div class="controls">
      <button id="add">+ Add person</button>
      <button id="import">Import CSV</button>
      <button id="export">Export CSV</button>
      <button id="reset" class="subtle">Clear draft</button>
      <span id="draft-state" class="draft-state">Local draft</span>
      <button id="publish" class="primary">Publish to display</button>
    </div>
    <input id="file" type="file" accept=".csv,text/csv" hidden />
    <div id="feedback" role="status" class="feedback"></div>
    <div class="table-wrap">
      <table>
        <thead><tr>
          <th>Initiative</th>
          <th>Name</th>
          <th>Innate magic</th>
          <th>Magical items (one per line)</th>
          <th>Alive</th>
          <th>Soul present</th><th></th>
        </tr></thead>
        <tbody id="roster"></tbody>
      </table>
    </div>
    <p class="footnote">Rows are sorted by descending initiative. Only Publish updates the player display. The draft stays in this browser.</p>
  </main>`;

  const tbody = document.querySelector('#roster');
  const state = document.querySelector('#draft-state');
  const feedback = document.querySelector('#feedback');
  const publish = document.querySelector('#publish');
  const syncLabel = document.querySelector('#sync-label');
  const publishedLabel = document.querySelector('#published-label');
  const file = document.querySelector('#file');

  function show(text, error = false) {
    feedback.textContent = text;
    feedback.className = `feedback ${error ? 'error' : ''}`;
  }

  function save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(rows));
    } catch (error) {
      show(`Local save failed: ${error.message}`, true);
    }
    dirty = true;
    state.textContent = 'Unpublished changes · saved locally';
  }

  function draw() {
    tbody.innerHTML = sorted(rows).map((row) => `<tr data-id="${escaped(row.id)}">
      <td><input class="initiative" data-field="initiative" type="number" step="any" value="${escaped(row.initiative)}" aria-label="Initiative for ${escaped(row.name || 'person')}" /></td>
      <td><input data-field="name" value="${escaped(row.name)}" placeholder="Name" aria-label="Name" /></td>
      <td><input data-field="innateMagic" type="checkbox" ${row.innateMagic ? 'checked' : ''} aria-label="Innate magic" /></td>
      <td><textarea data-field="items" rows="2" placeholder="One item per line" aria-label="Magical items">${escaped(row.items)}</textarea><small>${itemNames(row.items).length} items</small></td>
      <td><input data-field="alive" type="checkbox" ${row.alive !== false ? 'checked' : ''} aria-label="Alive" /></td>
      <td><input data-field="soulPresent" type="checkbox" ${row.soulPresent ? 'checked' : ''} aria-label="Soul present" /></td>
      <td><button class="delete subtle" data-delete="${escaped(row.id)}" aria-label="Remove ${escaped(row.name || 'person')}">×</button></td>
    </tr>`).join('');

    document.querySelector('#add').disabled = rows.length >= MAX;
    state.textContent = dirty ? 'Unpublished changes · saved locally' : 'Local draft ready';
  }

  function editRow(event) {
    const field = event.target.dataset.field;
    if (!field) return;
    const row = rows.find(x => x.id === event.target.closest('tr')?.dataset.id);
    if (!row) return;

    row[field] = event.target.type === 'checkbox'
      ? event.target.checked
      : event.target.value;

    save();
    if (field === 'items') {
      event.target.nextElementSibling.textContent = `${itemNames(row.items).length} items`;
    }
  }

  tbody.addEventListener('input', editRow);

  function resizeItemField(textarea) {
    textarea.style.height = 'auto';
    textarea.style.height = `${Math.max(27, textarea.scrollHeight)}px`;
  }

  tbody.addEventListener('focusin', (event) => {
    if (event.target.matches('textarea[data-field="items"]')) {
      resizeItemField(event.target);
    }
  });

  tbody.addEventListener('input', (event) => {
    if (event.target.matches('textarea[data-field="items"]')) {
      resizeItemField(event.target);
    }
  });

  tbody.addEventListener('focusout', (event) => {
    if (event.target.matches('textarea[data-field="items"]')) {
      event.target.style.height = '27px';
    }
  });


  tbody.addEventListener('change', (event) => {
    editRow(event);
    if (event.target.dataset.field === 'initiative') draw();
  });

  tbody.addEventListener('click', (event) => {
    const id = event.target.dataset.delete;
    if (!id) return;
    const row = rows.find(r => r.id === id);
    if (confirm(`Remove ${row?.name || 'this person'} from the draft?`)) {
      rows = rows.filter(r => r.id !== id);
      save();
      draw();
    }
  });

  document.querySelector('#add').onclick = () => {
    if (rows.length >= MAX) return;
    rows.push(newRow());
    save();
    draw();
    tbody.querySelector('tr:last-child input[data-field="name"]')?.focus();
  };

  document.querySelector('#reset').onclick = () => {
    if (!confirm('Clear the local draft? This will not change the published display. Export CSV first if you need a backup.')) return;
    rows = [];
    save();
    draw();
    show('Local draft cleared. The published display is unchanged.');
  };

  document.querySelector('#export').onclick = () => {
    const header = ['Initiative','Name','Innate Magic','Magical Items','Alive','Soul Present'];
    const csv = [header, ...sorted(rows).map(r => [
      r.initiative, r.name,
      r.innateMagic ? 'Yes' : 'No',
      r.items,
      r.alive !== false ? 'Yes' : 'No',
      r.soulPresent ? 'Yes' : 'No'
    ])].map(cells =>
      cells.map(v => `"${String(v).replaceAll('"','""')}"`).join(',')
    ).join('\r\n');

    const url = URL.createObjectURL(
      new Blob(['\uFEFF', csv], { type: 'text/csv;charset=utf-8' })
    );
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'crimson-register.csv';
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    show('CSV exported.');
  };

  document.querySelector('#import').onclick = () => file.click();

  file.onchange = async () => {
    const f = file.files?.[0];
    if (!f) return;

    try {
      const parsed = parseCSV(await f.text().then(s => s.replace(/^\uFEFF/, '')));
      const oldHeader = ['Initiative','Name','Innate Magic','Magical Items','Soul Present'];
      const newHeader = ['Initiative','Name','Innate Magic','Magical Items','Alive','Soul Present'];

      const actualHeader = parsed[0]?.map(x => x.trim().toLowerCase()).join('|');
      const oldFormat = actualHeader === oldHeader.join('|').toLowerCase();
      const newFormat = actualHeader === newHeader.join('|').toLowerCase();

      if (!oldFormat && !newFormat) {
        throw new Error('CSV must contain the original five columns or the new six columns.');
      }

      const imported = parsed.slice(1)
        .filter(cells => cells.some(v => v.trim()))
        .map((cells) => {
          const expectedCount = newFormat ? 6 : 5;

          if (cells.length !== expectedCount) {
            throw new Error(`Each CSV row must have ${expectedCount} columns.`);
          }

          const isYesNo = value => ['yes', 'no'].includes(value.trim().toLowerCase());

          if (!isYesNo(cells[2]) ||
              (newFormat && !isYesNo(cells[4])) ||
              !isYesNo(cells[newFormat ? 5 : 4])) {
            throw new Error('Boolean columns must use Yes or No.');
          }

          return normalizeRow({
            initiative: cells[0],
            name: cells[1],
            innateMagic: cells[2].trim().toLowerCase() === 'yes',
            items: cells[3],
            alive: newFormat
              ? cells[4].trim().toLowerCase() === 'yes'
              : true,
            soulPresent: cells[newFormat ? 5 : 4].trim().toLowerCase() === 'yes'
          });
        });

      if (imported.length > MAX) throw new Error('Maximum 25 people.');
      validate(imported);

      if (!confirm(`Replace the local draft with ${imported.length} imported people? The published display will not change.`)) return;

      rows = imported;
      save();
      draw();
      show(`Imported ${rows.length} people into local draft.`);
    } catch (error) {
      show(`CSV import failed: ${error.message}`, true);
    } finally {
      file.value = '';
    }
  };

  publish.onclick = async () => {
    try {
      validate(rows);
      if (publishing) return;

      publishing = true;
      publish.disabled = true;
      show('Publishing…');

      const glyphs = sorted(rows).map(r => ({
        innateMagic: r.innateMagic,
        magicalItems: itemNames(r.items).length,
        alive: r.alive !== false,
        soulPresent: r.soulPresent
      }));

      await setDoc(REF, { glyphs, publishedAt: Date.now() });
      dirty = false;
      draw();
      show(`Published ${glyphs.length} glyphs successfully.`);

      lastPublished = Date.now();
      publishedLabel.textContent = `Published ${new Date(lastPublished).toLocaleTimeString()}`;
    } catch (error) {
      show(`Publish failed: ${error.message}`, true);
    } finally {
      publishing = false;
      publish.disabled = false;
    }
  };

  onSnapshot(REF, snapshot => {
    syncLabel.textContent = snapshot.metadata.fromCache
      ? 'Offline · cached'
      : 'Connected';

    if (snapshot.data()?.publishedAt && !lastPublished) {
      publishedLabel.textContent =
        `Last published: ${new Date(snapshot.data().publishedAt).toLocaleString()}`;
    }
  }, error => {
    syncLabel.textContent = `Sync error: ${error.message}`;
  });

  draw();
}

function validate(rows) {
  if (rows.length > MAX) throw new Error('Maximum 25 people.');

  for (const [i, r] of rows.entries()) {
    if (!r.name.trim()) throw new Error(`Row ${i + 1}: name is required.`);
    if (!r.initiative.trim() || !Number.isFinite(Number(r.initiative))) {
      throw new Error(`${r.name}: enter a valid initiative number.`);
    }
    if (itemNames(r.items).length > 39) {
      throw new Error(`${r.name}: maximum 39 items with the current Roman numeral markers.`);
    }
  }
}

function parseCSV(text) {
  const result = [];
  let row = [], value = '', quoted = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];

    if (c === '"') {
      if (quoted && text[i + 1] === '"') {
        value += '"';
        i++;
      } else {
        quoted = !quoted;
      }
    } else if (c === ',' && !quoted) {
      row.push(value);
      value = '';
    } else if ((c === '\n' || c === '\r') && !quoted) {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(value);
      result.push(row);
      row = [];
      value = '';
    } else {
      value += c;
    }
  }

  if (quoted) throw new Error('Unclosed quoted field.');
  if (row.length || value) {
    row.push(value);
    result.push(row);
  }
  return result;
}
