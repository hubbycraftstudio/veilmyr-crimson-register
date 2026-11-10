
import './style.css';
import { doc, onSnapshot, setDoc } from 'firebase/firestore';
import { db } from './firebase.js';
import bloodSealSvg from './assets/crimson-register-with-meter.svg?raw';

const KEY = 'veilmyr-crimson-register-draft-v1';
const REF = doc(db, 'register', 'published');
const app = document.querySelector('#app');
const MAX = 25;
const SEAL_THRESHOLDS = [8, 15, 23, 30, 38, 45, 53, 60];

const newId = () => globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`;
const newRow = () => ({ id: newId(), initiative: '', name: '', innateMagic: false, items: '', bodyStatus: 'alive', soulStatus: 'present', sparkConsumed: false });
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
  const mode = row.bodyStatus === 'absent'
    ? 'absent'
    : row.bodyStatus === 'dead'
      ? 'departed'
      : (row.innateMagic && !row.sparkConsumed ? 'magical' : 'ordinary');

  const soulMarkup = row.soulStatus === 'present'
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

const BODY_STATUSES = ['alive', 'dead', 'absent'];
const SOUL_STATUSES = ['present', 'consumed', 'absent'];

function statusFields(row) {
  const innateMagic = row.innateMagic === true;
  // Old versions represented both soul and spark consumption as soulPresent=false.
  // Preserve those previously awarded 5+3 points when migrating old rosters.
  const legacyConsumption = row.soulStatus === undefined && row.soulPresent === false;
  return {
    innateMagic,
    bodyStatus: BODY_STATUSES.includes(row.bodyStatus)
      ? row.bodyStatus : (row.alive === false ? 'dead' : 'alive'),
    soulStatus: SOUL_STATUSES.includes(row.soulStatus)
      ? row.soulStatus : (legacyConsumption ? 'consumed' : 'present'),
    sparkConsumed: innateMagic && (typeof row.sparkConsumed === 'boolean'
      ? row.sparkConsumed : legacyConsumption),
  };
}

function normalizeRow(row) {
  return {
    id: typeof row.id === 'string' ? row.id : newId(),
    initiative: String(row.initiative ?? ''),
    name: String(row.name ?? ''),
    items: String(row.items ?? ''),
    ...statusFields(row),
  };
}

function portalPoints(rows) {
  return rows.reduce((total, row) => total
    + (row.soulStatus === 'consumed' ? 5 : 0)
    + (row.innateMagic && row.sparkConsumed ? 3 : 0), 0);
}

function statusSelect(field, value, options, name) {
  return `<select data-field="${field}" aria-label="${field === 'bodyStatus' ? 'Body' : 'Soul'} status for ${escaped(name)}">
    ${options.map(option => `<option value="${option}" ${value === option ? 'selected' : ''}>${option[0].toUpperCase()}${option.slice(1)}</option>`).join('')}
  </select>`;
}

const isDisplay = location.pathname.replace(/\/$/, '').endsWith('/display');
if (isDisplay) renderDisplay(); else renderDM();


function renderDisplay() {
  app.innerHTML = `<main class="display-view">
    <button id="fullscreen-btn" class="fullscreen-btn" title="Toggle fullscreen">⛶</button>
    <div id="wake-status" class="wake-status" role="status" aria-live="polite">Checking screen wake lock…</div>
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

  // Android may release screen wake locks when focus, fullscreen or power state changes.
  // Show the actual browser-reported state, and retry while the display is visible.
  const wakeStatus = document.querySelector('#wake-status');
  let wakeLock = null;
  let requestingWakeLock = false;
  let wakeRetryTimer = null;

  function showWakeStatus(message, problem = false) {
    wakeStatus.textContent = message;
    wakeStatus.classList.toggle('problem', problem);
  }

  function retryWakeLock(delay = 2000) {
    clearTimeout(wakeRetryTimer);
    if (document.visibilityState === 'visible') {
      wakeRetryTimer = setTimeout(keepScreenAwake, delay);
    }
  }

  async function keepScreenAwake() {
    if (!('wakeLock' in navigator)) {
      showWakeStatus('Screen wake lock unsupported', true);
      return;
    }
    if (document.visibilityState !== 'visible') return;
    if (requestingWakeLock || (wakeLock && !wakeLock.released)) return;

    requestingWakeLock = true;
    clearTimeout(wakeRetryTimer);
    try {
      const lock = await navigator.wakeLock.request('screen');
      wakeLock = lock;
      showWakeStatus('Screen wake lock active');
      console.log('Screen wake lock active.');

      lock.addEventListener('release', () => {
        if (wakeLock !== lock) return;
        wakeLock = null;
        showWakeStatus('Screen wake lock released — retrying', true);
        console.warn('Screen wake lock released.');
        retryWakeLock();
      });
    } catch (error) {
      showWakeStatus('Screen wake lock unavailable — retrying', true);
      console.warn('Could not keep screen awake:', error);
      retryWakeLock(15000);
    } finally {
      requestingWakeLock = false;
    }
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') keepScreenAwake();
  });
  document.addEventListener('fullscreenchange', keepScreenAwake);
  window.addEventListener('focus', keepScreenAwake);
  window.addEventListener('pageshow', keepScreenAwake);
  keepScreenAwake();


  grid.innerHTML = `<div class="empty">Waiting for a published register…</div>`;

  onSnapshot(REF, (snapshot) => {
    const data = snapshot.data();
    // Accept published records from either version of the app.
    const glyphs = (Array.isArray(data?.glyphs) ? data.glyphs.slice(0, MAX) : [])
      .map(row => ({ ...row, ...statusFields(row) }));
    const soulPoints = portalPoints(glyphs);

    document.querySelectorAll('#blood-seal .blood-seal-level')
      .forEach((level, index) => {
        const threshold = SEAL_THRESHOLDS[index];
        const start = Math.max(0, threshold - 10);
        const brightness = Math.max(0, Math.min(1,
          (soulPoints - start) / (threshold - start)
        ));

        level.style.opacity = brightness;
      });

    document.querySelectorAll('#blood-seal .blood-seal-node')
      .forEach((node, index) => {
        const threshold = SEAL_THRESHOLDS[index];
        node.classList.toggle('is-lit', soulPoints >= threshold);
      });

    console.log(`Blood Seal: ${soulPoints}/60 points`);

    // Symmetrical progress bar (0–60 points)
    const progress = Math.min(1, Math.max(0, soulPoints / 60));

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
      <button id="roll-initiative">Roll Initiative</button>
      <button id="import">Import CSV</button>
      <button id="export">Export CSV</button>
      <button id="reset" class="subtle">Clear draft</button>
      <span id="draft-state" class="draft-state">Local draft</span>
      <span id="portal-score" class="portal-score">Portal: 0/60</span>
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
          <th>Body status</th>
          <th>Soul status</th>
          <th>Spark consumed</th><th></th>
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
  const portalScore = document.querySelector('#portal-score');
  const updateScorePreview = () => { portalScore.textContent = `Portal: ${portalPoints(rows)}/60`; };

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
      <td>${statusSelect('bodyStatus', row.bodyStatus, BODY_STATUSES, row.name || 'person')}</td>
      <td>${statusSelect('soulStatus', row.soulStatus, SOUL_STATUSES, row.name || 'person')}</td>
      <td><input data-field="sparkConsumed" type="checkbox" ${row.sparkConsumed ? 'checked' : ''} ${!row.innateMagic ? 'disabled' : ''} aria-label="Spark consumed for ${escaped(row.name || 'person')}" /></td>
      <td><button class="delete subtle" data-delete="${escaped(row.id)}" aria-label="Remove ${escaped(row.name || 'person')}">×</button></td>
    </tr>`).join('');

    document.querySelector('#add').disabled = rows.length >= MAX;
    state.textContent = dirty ? 'Unpublished changes · saved locally' : 'Local draft ready';
    updateScorePreview();
  }

  function editRow(event) {
    const field = event.target.dataset.field;
    if (!field) return;
    const row = rows.find(x => x.id === event.target.closest('tr')?.dataset.id);
    if (!row) return;

    row[field] = event.target.type === 'checkbox'
      ? event.target.checked
      : event.target.value;

    if (field === 'innateMagic' && !row.innateMagic) row.sparkConsumed = false;

    save();
    updateScorePreview();
    if (field === 'items') {
      event.target.nextElementSibling.textContent = `${itemNames(row.items).length} items`;
    }
    if (field === 'innateMagic') draw(); // refresh Spark checkbox enabled state
  }

  tbody.addEventListener('input', (event) => {
    if (!event.target.matches('select, input[type="checkbox"]')) editRow(event);
  });

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
    if (event.target.matches('select, input[type="checkbox"]')) editRow(event);
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

  document.querySelector('#roll-initiative').onclick = () => {
    if (!rows.length) return;

    if (!confirm('Roll new initiative for everyone? This will overwrite existing rolls.')) return;

    rows.forEach(row => {
      row.initiative = String(Math.floor(Math.random() * 20) + 1);
    });

    save();
    draw();
    show('Initiative rolled for all characters.');
  };

  document.querySelector('#reset').onclick = () => {
    if (!confirm('Clear the local draft? This will not change the published display. Export CSV first if you need a backup.')) return;
    rows = [];
    save();
    draw();
    show('Local draft cleared. The published display is unchanged.');
  };

  document.querySelector('#export').onclick = () => {
    const header = ['Initiative','Name','Innate Magic','Magical Items','Body Status','Soul Status','Spark Consumed'];
    const csv = [header, ...sorted(rows).map(r => [
      r.initiative, r.name,
      r.innateMagic ? 'Yes' : 'No',
      r.items,
      r.bodyStatus,
      r.soulStatus,
      r.sparkConsumed ? 'Yes' : 'No'
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
      const headers = [
        ['Initiative','Name','Innate Magic','Magical Items','Soul Present'],
        ['Initiative','Name','Innate Magic','Magical Items','Alive','Soul Present'],
        ['Initiative','Name','Innate Magic','Magical Items','Body Status','Soul Status','Spark Consumed']
      ];
      const actualHeader = parsed[0]?.map(x => x.trim().toLowerCase()).join('|');
      const format = headers.findIndex(header => actualHeader === header.join('|').toLowerCase());
      if (format === -1) {
        throw new Error('CSV must contain the original 5/6 columns or the updated 7 columns.');
      }

      const imported = parsed.slice(1)
        .filter(cells => cells.some(v => v.trim()))
        .map(cells => {
          const expectedCount = headers[format].length;
          if (cells.length !== expectedCount) {
            throw new Error(`Each CSV row must have ${expectedCount} columns.`);
          }
          const yesNo = value => ['yes', 'no'].includes(value.trim().toLowerCase());
          if (!yesNo(cells[2])) throw new Error('Innate Magic must be Yes or No.');

          if (format === 2) {
            const bodyStatus = cells[4].trim().toLowerCase();
            const soulStatus = cells[5].trim().toLowerCase();
            if (!BODY_STATUSES.includes(bodyStatus) || !SOUL_STATUSES.includes(soulStatus) || !yesNo(cells[6])) {
              throw new Error('Use Alive/Dead/Absent, Present/Consumed/Absent, and Yes/No for Spark Consumed.');
            }
            return normalizeRow({
              initiative: cells[0], name: cells[1],
              innateMagic: cells[2].trim().toLowerCase() === 'yes',
              items: cells[3], bodyStatus, soulStatus,
              sparkConsumed: cells[6].trim().toLowerCase() === 'yes'
            });
          }

          // Legacy CSVs: Soul Present=No previously consumed both soul and innate magic.
          if ((format === 1 && !yesNo(cells[4])) || !yesNo(cells[format === 1 ? 5 : 4])) {
            throw new Error('Legacy Alive and Soul Present columns must be Yes or No.');
          }
          return normalizeRow({
            initiative: cells[0], name: cells[1],
            innateMagic: cells[2].trim().toLowerCase() === 'yes',
            items: cells[3],
            alive: format === 1 ? cells[4].trim().toLowerCase() === 'yes' : true,
            soulPresent: cells[format === 1 ? 5 : 4].trim().toLowerCase() === 'yes'
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
        bodyStatus: r.bodyStatus,
        soulStatus: r.soulStatus,
        sparkConsumed: r.sparkConsumed
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
    if (!BODY_STATUSES.includes(r.bodyStatus) || !SOUL_STATUSES.includes(r.soulStatus)) {
      throw new Error(`${r.name}: invalid body or soul status.`);
    }
    if (r.sparkConsumed && !r.innateMagic) {
      throw new Error(`${r.name}: only innately magical characters can have a consumed Spark.`);
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
