/* Mysh — logique de la page.
   Construit le formulaire à partir des listes de src/generator.js, lit les choix,
   met à jour l'aperçu, le résumé et le script, et gère téléchargement et copie. */
(function () {
  'use strict';
  // Ouvert directement depuis src/ : le moteur et le générateur ne sont pas encore insérés.
  if (!window.Mysh || document.getElementById('engine').textContent.trim() === '@@' + 'ENGINE@@') {
    document.querySelector('.page').insertAdjacentHTML('afterbegin',
      '<p class="dev-warn"><b>Ceci est le modèle de la page, pas la page finale.</b> ' +
      'Lance <code>node build.mjs</code>, puis ouvre <code>dist/index.html</code>.</p>');
    return;
  }
  const C = window.Mysh;
  const engine = document.getElementById('engine').textContent;
  const $ = id => document.getElementById(id);
  const esc = s => String(s).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  // v2 : les options Zsh ne sont plus effacées quand on choisit un autre shell ;
  // les configurations v1 enregistrées pouvaient les avoir mises à « non ».
  const STORE = 'mysh.config.v2';
  const LOGO_STORE = 'mysh.config.v1.logo';

  // Couleurs approximatives des thèmes Starship, pour l'aperçu
  const THEMES = {
    'tokyo-night':          [['#a3aed2', '#090c0c'], ['#769ff0', '#e3e5e5'], ['#394260', '#769ff0'], ['#1d2230', '#a0a9cb']],
    'catppuccin-powerline': [['#f38ba8', '#11111b'], ['#fab387', '#11111b'], ['#a6e3a1', '#11111b'], ['#74c7ec', '#11111b']],
    'pastel-powerline':     [['#9a348e', '#ffffff'], ['#da627d', '#ffffff'], ['#fca17d', '#1b1b1b'], ['#33658a', '#ffffff']],
    'gruvbox-rainbow':      [['#d65d0e', '#fbf1c7'], ['#d79921', '#fbf1c7'], ['#689d6a', '#fbf1c7'], ['#665c54', '#fbf1c7']],
  };

  // ---------- mode clair / sombre ----------
  // « auto » suit le réglage du système ; « clair » et « sombre » le forcent.
  const MODES = ['auto', 'light', 'dark'];
  function setMode(name, save) {
    const mode = MODES.includes(name) ? name : 'auto';
    if (mode === 'auto') delete document.documentElement.dataset.mode;
    else document.documentElement.dataset.mode = mode;
    document.querySelectorAll('.modes button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.mode === mode)));
    if (save) { try { localStorage.setItem('mysh.mode', mode); } catch (e) { /* ignore */ } }
  }
  let initialMode = 'auto';
  try { initialMode = localStorage.getItem('mysh.mode') || 'auto'; } catch (e) { /* ignore */ }
  setMode(initialMode, false);
  document.querySelectorAll('.modes button').forEach(b => b.addEventListener('click', () => setMode(b.dataset.mode, true)));

  let cfg = C.normalize(C.DEFAULTS);
  try { const saved = JSON.parse(localStorage.getItem(STORE) || 'null'); if (saved) cfg = C.normalize(saved); } catch (e) { /* stockage indisponible */ }

  // ---------- construction du formulaire ----------
  const row = (type, name, id, value, title, desc, extra = '') =>
    `<label class="${type === 'radio' ? 'opt' : 'chk'}"><input type="${type}"${name ? ` name="${name}"` : ''} id="${id}"${value !== null ? ` value="${esc(value)}"` : ''}>` +
    `<span class="mk"></span><span class="t"><b>${title}</b>${extra}${desc ? `<small>${desc}</small>` : ''}</span></label>`;
  const radios = (el, name, items, title, desc, extra) => {
    el.innerHTML = items.map(it => row('radio', name, `${name}-${it.id || 'none'}`, it.id, title(it), desc(it), extra ? extra(it) : '')).join('');
  };
  radios($('pm'), 'pm', Object.entries(C.PMS).map(([id, p]) => ({ id, ...p })), p => esc(p.label), p => esc(p.distros));
  radios($('shell'), 'shell', Object.entries(C.SHELLS).map(([id, x]) => ({ id, ...x })), x => esc(x.label), x => esc(x.desc),
    x => (x.id === 'zsh' ? '<span class="flag">conseillé</span>' : ''));
  // Les options propres à Zsh s'affichent juste sous « Zsh ».
  $('shell-zsh').closest('label').after($('zshopts'));
  radios($('preset'), 'preset', C.PRESETS, p => esc(p.label), p => (p.nerd ? 'Avec icônes (Nerd Font)' : 'Sans icônes spéciales'),
    p => (THEMES[p.id] ? `<span class="sw">${THEMES[p.id].map(c => `<i style="background:${c[0]}"></i>`).join('')}</span>` : ''));
  radios($('font'), 'font', C.FONTS, f => esc(f.label), f => (f.id ? esc(f.family) : 'J’ai déjà une police'));
  $('tools').innerHTML = C.TOOLS.map(t => row('checkbox', '', `tool-${t.id}`, null, `<code>${t.id}</code>`, esc(t.desc))).join('');
  $('replace').innerHTML = C.REPLACEMENTS.map(r => row('checkbox', '', `rep-${r.id}`, null,
    `<span class="rep-from">${r.from}</span><span class="rep-arrow">→</span><span class="rep-from">${r.to}</span>`,
    `${esc(r.note)}<span class="need" id="need-${r.id}"></span>`,
    r.risky ? '<span class="flag warn">prudence</span>' : '')).join('');

  // ---------- logo : image -> caractères ----------
  const LOGO_COLORS = { image: null, cyan: [86, 212, 221], magenta: [210, 168, 255], green: [126, 231, 135], orange: [255, 166, 87], white: [230, 237, 243] };
  const LOGO_COLOR_LABELS = { image: 'Couleurs de l’image', cyan: 'Cyan', magenta: 'Magenta', green: 'Vert', orange: 'Orange', white: 'Blanc', none: 'Sans couleur' };
  const RAMP = ' .:-=+*#%@';
  let logoSource = null;
  let logoSourceKind = 'sample';

  function drawSample() {
    const cv = document.createElement('canvas');
    cv.width = cv.height = 240;
    const x = cv.getContext('2d');
    const cx = 120, cy = 198, R = 160, n = 9;
    const a0 = Math.PI * 1.1, a1 = Math.PI * 1.9;
    const tones = ['#ff6a45', '#ff8456', '#ff9a66', '#ffad73', '#ffbd80', '#ffad73', '#ff9a66', '#ff8456', '#ff6a45'];
    for (let i = 0; i < n; i++) {
      const s0 = a0 + (a1 - a0) * i / n, s1 = a0 + (a1 - a0) * (i + 1) / n, mid = (s0 + s1) / 2;
      x.fillStyle = tones[i];
      x.beginPath(); x.moveTo(cx, cy); x.arc(cx, cy, R, s0, s1); x.closePath(); x.fill();
      x.beginPath(); x.arc(cx + Math.cos(mid) * R * 0.97, cy + Math.sin(mid) * R * 0.97, R * 0.16, 0, Math.PI * 2); x.fill();
    }
    // Les côtes sont découpées (transparentes) pour rester visibles une fois en caractères
    x.globalCompositeOperation = 'destination-out';
    x.strokeStyle = '#000'; x.lineWidth = 9; x.lineCap = 'round';
    for (let i = 1; i < n; i++) {
      const a = a0 + (a1 - a0) * i / n;
      x.beginPath(); x.moveTo(cx + Math.cos(a) * 18, cy + Math.sin(a) * 18); x.lineTo(cx + Math.cos(a) * R * 0.98, cy + Math.sin(a) * R * 0.98); x.stroke();
    }
    x.globalCompositeOperation = 'source-over';
    x.fillStyle = '#d24e2c';
    x.beginPath(); x.moveTo(cx - 42, cy + 2); x.lineTo(cx + 42, cy + 2); x.lineTo(cx + 24, cy + 32); x.lineTo(cx - 24, cy + 32); x.closePath(); x.fill();
    return cv;
  }

  function drawThumb() {
    const cv = $('srcThumb'), x = cv.getContext('2d');
    x.clearRect(0, 0, cv.width, cv.height);
    if (!logoSource) return;
    const sw = logoSource.naturalWidth || logoSource.width, sh = logoSource.naturalHeight || logoSource.height;
    const k = Math.min(cv.width / sw, cv.height / sh) * 0.9;
    x.drawImage(logoSource, (cv.width - sw * k) / 2, (cv.height - sh * k) / 2, sw * k, sh * k);
  }

  function convertLogo(src, o) {
    const sw = src.naturalWidth || src.width, sh = src.naturalHeight || src.height;
    if (!sw || !sh) return null;
    const aspect = sh / sw;
    const geom = cols => o.style === 'braille' ? { cw: 2, ch: 4, pw: cols * 2, ph: Math.max(4, Math.round(cols * 2 * aspect)) }
      : o.style === 'blocks' ? { cw: 1, ch: 2, pw: cols, ph: Math.max(2, Math.round(cols * aspect)) }
      : { cw: 1, ch: 1, pw: cols, ph: Math.max(1, Math.round(cols * aspect / 2)) };
    let cols = o.cols, g = geom(cols), rows = Math.ceil(g.ph / g.ch);
    while (rows > 40 && cols > 12) { cols--; g = geom(cols); rows = Math.ceil(g.ph / g.ch); }
    const cv = document.createElement('canvas');
    cv.width = g.pw; cv.height = rows * g.ch;
    const ctx = cv.getContext('2d', { willReadFrequently: true });
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(src, 0, 0, g.pw, g.ph);
    const d = ctx.getImageData(0, 0, cv.width, cv.height).data, W = cv.width;
    const px = (x, y) => { const i = (y * W + x) * 4; return [d[i], d[i + 1], d[i + 2], d[i + 3]]; };
    const corners = [px(0, 0), px(g.pw - 1, 0), px(0, g.ph - 1), px(g.pw - 1, g.ph - 1)];
    const transparent = corners.some(c => c[3] < 128);
    const bg = [0, 1, 2].map(k => corners.reduce((n, c) => n + c[k], 0) / 4);
    const t = 1 - o.density / 100;
    const ink = (x, y) => {
      if (y >= g.ph) return 0;
      const [r, gg, b, a] = px(x, y);
      if (transparent) return a / 255;
      if (o.ignoreBg) return (a / 255) * Math.min(1, Math.hypot(r - bg[0], gg - bg[1], b - bg[2]) / 140);
      return (a / 255) * (0.2126 * r + 0.7152 * gg + 0.0722 * b) / 255;
    };
    const q = v => Math.min(255, Math.round(v / 17) * 17);
    const fixed = LOGO_COLORS[o.color] || null;
    const colorOf = list => {
      if (o.color === 'none' || !list.length) return null;
      if (fixed) return fixed;
      const s = list.reduce((acc, c) => [acc[0] + c[0], acc[1] + c[1], acc[2] + c[2]], [0, 0, 0]);
      return s.map(v => q(v / list.length));
    };
    const grid = [];
    for (let cy = 0; cy < rows; cy++) {
      const row = [];
      for (let cx = 0; cx < cols; cx++) {
        const x0 = cx * g.cw, y0 = cy * g.ch;
        if (o.style === 'braille') {
          const BIT = [[0x01, 0x08], [0x02, 0x10], [0x04, 0x20], [0x40, 0x80]];
          let bits = 0; const on = [];
          for (let dy = 0; dy < 4; dy++) for (let dx = 0; dx < 2; dx++) {
            if (ink(x0 + dx, y0 + dy) >= t) { bits |= BIT[dy][dx]; on.push(px(x0 + dx, y0 + dy)); }
          }
          row.push(bits ? { c: String.fromCharCode(0x2800 + bits), fg: colorOf(on) } : { c: ' ' });
        } else if (o.style === 'blocks') {
          const top = ink(x0, y0) >= t, bot = ink(x0, y0 + 1) >= t;
          const ct = top ? colorOf([px(x0, y0)]) : null, cb = bot ? colorOf([px(x0, y0 + 1)]) : null;
          if (top && bot) row.push(!ct || !cb || ct.join() === cb.join() ? { c: '\u2588', fg: ct } : { c: '\u2580', fg: ct, bg: cb });
          else if (top) row.push({ c: '\u2580', fg: ct });
          else if (bot) row.push({ c: '\u2584', fg: cb });
          else row.push({ c: ' ' });
        } else {
          const v = ink(x0, y0);
          const idx = v < t * 0.5 ? 0 : Math.max(1, Math.round(v * (RAMP.length - 1)));
          row.push(idx ? { c: RAMP[idx], fg: colorOf([px(x0, y0)]) } : { c: ' ' });
        }
      }
      grid.push(row);
    }
    // Recadrage sur la partie dessinée
    const used = (r, c) => grid[r][c].c !== ' ';
    let top = 0, bottom = rows - 1, left = cols, right = -1;
    while (top <= bottom && grid[top].every(cell => cell.c === ' ')) top++;
    while (bottom >= top && grid[bottom].every(cell => cell.c === ' ')) bottom--;
    if (top > bottom) return null;
    for (let r = top; r <= bottom; r++) for (let c = 0; c < cols; c++) if (used(r, c)) { left = Math.min(left, c); right = Math.max(right, c); }
    const lines = [];
    for (let r = top; r <= bottom; r++) {
      let last = right; while (last >= left && grid[r][last].c === ' ') last--;
      let out = '', cur = '';
      for (let c = left; c <= last; c++) {
        const cell = grid[r][c];
        let want;
        if (cell.c === ' ') want = cur.includes('48;2') ? '' : cur;
        else want = cell.fg ? `38;2;${cell.fg.join(';')}` + (cell.bg ? `;48;2;${cell.bg.join(';')}` : '') : '';
        if (want !== cur) {
          if (!want || cur.includes('48;2')) out += '\\e[0m';
          if (want) out += `\\e[${want}m`;
          cur = want;
        }
        out += cell.c;
      }
      if (cur) out += '\\e[0m';
      lines.push(out);
    }
    return { text: lines.join('\n'), w: right - left + 1, h: lines.length };
  }

  function ansiToHtml(t) {
    const re = /\\e\[([0-9;]*)m/g;
    let out = '', fg = null, bgc = null, last = 0, m;
    const flush = str => {
      if (!str) return;
      const e = esc(str);
      out += fg || bgc ? `<span style="${fg ? `color:${fg};` : ''}${bgc ? `background:${bgc};` : ''}">${e}</span>` : e;
    };
    while ((m = re.exec(t))) {
      flush(t.slice(last, m.index));
      const p = m[1].split(';').map(Number);
      if (p[0] === 0) { fg = null; bgc = null; }
      else {
        if (p[0] === 38) fg = `rgb(${p[2]},${p[3]},${p[4]})`;
        if (p[5] === 48) bgc = `rgb(${p[7]},${p[8]},${p[9]})`; else bgc = null;
      }
      last = re.lastIndex;
    }
    flush(t.slice(last));
    return out;
  }

  function setSource(img, kind) {
    logoSource = img; logoSourceKind = kind;
    drawThumb();
  }

  function loadUpload(file) {
    if (!file || !/^image\//.test(file.type)) { note('Ce fichier n’est pas une image.', 'bad'); return; }
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        // Réduite à 256 px : assez pour 64 colonnes, et légère à garder dans le navigateur
        const k = Math.min(1, 256 / Math.max(img.naturalWidth, img.naturalHeight));
        const cv = document.createElement('canvas');
        cv.width = Math.max(1, Math.round(img.naturalWidth * k)); cv.height = Math.max(1, Math.round(img.naturalHeight * k));
        cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
        setSource(cv, 'upload');
        try { localStorage.setItem(LOGO_STORE, cv.toDataURL('image/png')); } catch (e) { /* stockage plein ou indisponible */ }
        if (!$('logoOn').checked) { $('logoOn').checked = true; $('tool-fastfetch').checked = true; $('fastfetchStart').checked = true; }
        render();
      };
      img.onerror = () => note('Impossible de lire cette image. Essaie un PNG ou un JPG.', 'bad');
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  }

  $('logoStyle').innerHTML = [['braille', 'Braille', 'petits points, le plus fin'], ['blocks', 'Blocs', 'gros pixels'], ['ascii', 'ASCII', 'caractères classiques']]
    .map(([id, label, desc]) => row('radio', 'logoStyle', `logoStyle-${id}`, id, label, desc)).join('');
  $('logoColor').innerHTML = C.LOGO_COLORS.map(id => {
    const sw = id === 'image' ? 'conic-gradient(#ff6a45, #ffd580, #7ee787, #79c0ff, #d2a8ff, #ff6a45)'
      : id === 'none' ? 'transparent' : `rgb(${LOGO_COLORS[id].join(',')})`;
    return row('radio', 'logoColor', `logoColor-${id}`, id, `<i class="dot" style="background:${sw}"></i>${LOGO_COLOR_LABELS[id]}`, '');
  }).join('');

  const BOOLS = ['chsh', 'autosuggestions', 'highlighting', 'history', 'completion', 'starship', 'aliasUpdate', 'aliasGit', 'fastfetchStart'];

  function readForm() {
    const get = n => (document.querySelector(`input[name="${n}"]:checked`) || {}).value;
    const next = { pm: get('pm'), shell: get('shell'), preset: get('preset'), font: get('font'), tools: {} };
    BOOLS.forEach(k => { next[k] = $(k).checked; });
    C.TOOLS.forEach(t => { next.tools[t.id] = $('tool-' + t.id).checked; });
    next.replace = {};
    C.REPLACEMENTS.forEach(r => { next.replace[r.id] = $('rep-' + r.id).checked; });
    next.logo = {
      on: $('logoOn').checked,
      style: get('logoStyle'),
      cols: Number($('logoCols').value),
      color: get('logoColor'),
      density: Number($('logoDensity').value),
      ignoreBg: $('logoIgnoreBg').checked,
    };
    const conv = next.logo.on && logoSource ? convertLogo(logoSource, C.normalize(next).logo) : null;
    if (conv) Object.assign(next.logo, conv);
    return C.normalize(next);
  }

  function writeForm(c) {
    ['pm', 'shell', 'preset', 'font'].forEach(n => {
      const el = $(`${n}-${c[n] || 'none'}`); if (el) el.checked = true;
    });
    BOOLS.forEach(k => { $(k).checked = c[k]; });
    C.TOOLS.forEach(t => { $('tool-' + t.id).checked = c.tools[t.id]; });
    const zsh = c.shell === 'zsh';
    $('zshopts').hidden = !zsh;
    $('chsh').disabled = c.shell === 'bash';
    document.querySelectorAll('input[name="preset"]').forEach(i => { i.disabled = !c.starship; });
    C.REPLACEMENTS.forEach(r => {
      const box = $('rep-' + r.id), on = c.tools[r.tool];
      box.checked = c.replace[r.id];
      box.disabled = !on;
      $('need-' + r.id).textContent = on ? '' : ` Coche ${r.tool} dans les outils pour l’activer.`;
    });
    $('fastfetchStart').disabled = !c.tools.fastfetch;
    $('logoOn').checked = c.logo.on || ($('logoOn').checked && !c.logo.text);
    $('logoEditor').hidden = !$('logoOn').checked;
    const ls = $(`logoStyle-${c.logo.style}`); if (ls) ls.checked = true;
    const lc = $(`logoColor-${c.logo.color}`); if (lc) lc.checked = true;
    $('logoCols').value = c.logo.cols; $('logoColsOut').textContent = `${c.logo.cols} colonnes`;
    $('logoDensity').value = c.logo.density; $('logoDensityOut').textContent = `${c.logo.density} %`;
    $('logoIgnoreBg').checked = c.logo.ignoreBg;
    $('tool-fastfetch').disabled = c.logo.on;
    $('logoMeta').textContent = c.logo.on
      ? `Logo de ${c.logo.w} × ${c.logo.h} caractères${logoSourceKind === 'sample' ? ', à partir du coquillage d’exemple' : ''}.`
      : ($('logoOn').checked ? 'Avec ces réglages, l’image ne donne aucun caractère : augmente la densité ou décoche « Ignorer le fond ».' : '');
    $('updateHint').innerHTML = `Lance <code>${esc(C.PMS[c.pm].update)}</code>.`;
  }

  // ---------- aperçu du terminal ----------
  function promptHTML(c) {
    const dir = '~/projets/mysh', branch = 'main';
    if (!c.starship) {
      return c.shell === 'fish'
        ? `<span style="color:#7ee787">laura@pc</span> <span style="color:#79c0ff">~/p/mysh</span>&gt; `
        : `<span style="color:#7ee787;font-weight:600">laura@pc</span>:<span style="color:#79c0ff;font-weight:600">${dir}</span>$ `;
    }
    const t = THEMES[c.preset];
    if (t) {
      const parts = [' laura', ` ${dir}`, ` ${branch}`, ' 09:41'];
      return parts.map((p, i) => `<span class="seg" style="background:${t[i][0]};color:${t[i][1]}">${esc(p)}</span>`).join('') + `\n<span style="color:#7ee787">❯</span> `;
    }
    if (c.preset === 'pure-preset') return `<span style="color:#79c0ff">${dir}</span> <span style="color:#8b949e">${branch}</span>\n<span style="color:#d2a8ff">❯</span> `;
    if (c.preset === 'plain-text-symbols') return `<span style="color:#56d4dd;font-weight:600">${dir}</span> on <span style="color:#d2a8ff">git:${branch}</span>\n<span style="color:#7ee787">&gt;</span> `;
    return `<span style="color:#56d4dd;font-weight:600">${dir}</span> on <span style="color:#d2a8ff;font-weight:600">${branch}</span>\n<span style="color:#7ee787;font-weight:600">❯</span> `;
  }

  function lsHTML(c) {
    if (!c.tools.eza) {
      return `<span style="color:#79c0ff;font-weight:600">docs</span>  notes.md  <span style="color:#79c0ff;font-weight:600">src</span>  install.sh`;
    }
    const ic = c.font ? ['▸ ', '▸ ', '· ', '· '] : ['', '', '', ''];
    const rows = [
      ['d', '-', '14 oct 09:12', 'docs', true],
      ['d', '-', '14 oct 09:40', 'src', true],
      ['.', '2,1k', '13 oct 18:05', 'notes.md', false],
      ['.', '9,8k', '14 oct 09:38', 'install.sh', false],
    ];
    return rows.map((r, i) =>
      `<span style="color:${r[0] === 'd' ? '#79c0ff' : '#8b949e'}">${r[0]}</span><span style="color:#ffd580">rw</span><span style="color:#ff9e7a">x</span><span style="color:#8b949e">r-xr-x</span> ` +
      `<span style="color:#7ee787">${r[1].padStart(4)}</span> <span style="color:#e3b341">laura</span> <span style="color:#79c0ff">${r[2]}</span> ` +
      `<span style="color:#7ee787">${r[4] ? '' : ' '}</span><span style="${r[4] ? 'color:#79c0ff;font-weight:600' : ''}">${ic[i]}${r[3]}</span>`
    ).join('\n');
  }

  const OS_NAMES = { apt: 'Ubuntu 24.04 LTS x86_64', dnf: 'Fedora Linux 42 x86_64', pacman: 'Arch Linux x86_64', zypper: 'openSUSE Tumbleweed x86_64' };
  const SHELL_VER = { zsh: 'zsh 5.9', fish: 'fish 3.7.1', bash: 'bash 5.2.21' };
  function fastfetchHTML(c) {
    const info = [
      '<b>laura</b>@<b>pc</b>', '---------',
      `<b>OS</b>: ${OS_NAMES[c.pm]}`, '<b>Kernel</b>: Linux 6.8', `<b>Shell</b>: ${SHELL_VER[c.shell]}`,
      '<b>Terminal</b>: kitty 0.36', '<b>CPU</b>: Ryzen 5 5600G (12)', '<b>Memory</b>: 3.4 / 15.6 GiB (22%)', '',
      '<span class="ff-blocks">' + ['#1d2230', '#ff6a5c', '#7ee787', '#ffd580', '#79c0ff', '#d2a8ff', '#56d4dd', '#dce4ec'].map(col => `<span style="background:${col}"></span>`).join('') + '</span>',
    ];
    const avail = Math.max(240, $('termBody').clientWidth - 32);
    const fs = Math.max(5, Math.min(12, (avail * 0.42) / (Math.max(1, c.logo.w) * 0.62)));
    return `<div class="ff"><span class="ff-logo" style="font-size:${fs.toFixed(1)}px">${ansiToHtml(c.logo.text)}</span><span class="ff-info">${info.join('\n')}</span></div>`;
  }

  function renderTerm(c) {
    const fontMap = { FiraCode: '"Fira Code"', JetBrainsMono: '"JetBrains Mono"' };
    $('termBody').style.fontFamily = `${fontMap[c.font] || '"JetBrains Mono"'}, ui-monospace, monospace`;
    const fontLabel = C.FONTS.find(f => f.id === c.font).label;
    $('termTitle').textContent = `aperçu · ${c.shell} · ${c.font ? fontLabel : 'ta police'}`;
    const lsCmd = c.tools.eza ? (c.replace.ls ? 'ls -la' : 'll') : 'ls';
    const suggest = c.shell === 'fish' || (c.shell === 'zsh' && c.autosuggestions);
    const colorCmd = c.shell === 'fish' || (c.shell === 'zsh' && c.highlighting);
    const typed = colorCmd ? `<span style="color:#7ee787">git</span> st` : 'git st';
    const ghost = suggest ? `<span class="ghost">atus -sb</span>` : '';
    if (c.logo.on) {
      const lead = c.fastfetchStart ? '' : `${promptHTML(c)}fastfetch\n`;
      $('termBody').innerHTML = `${lead}${fastfetchHTML(c)}${promptHTML(c)}${typed}<span class="caret"></span>${ghost}`;
      return;
    }
    $('termBody').innerHTML = `${promptHTML(c)}${lsCmd}\n${lsHTML(c)}\n\n${promptHTML(c)}${typed}<span class="caret"></span>${ghost}`;
  }

  // ---------- résumé ----------
  function renderReceipt(c, sum) {
    const item = (dt, dd) => `<div class="row"><dt>${dt}</dt><dd>${dd}</dd></div>`;
    const html = [
      item(`${sum.packages.length} paquets via ${esc(c.pm)}, seulement ceux qui manquent`, sum.packages.map(p => `<code>${esc(p)}</code>`).join(', ')),
      item('Fichiers modifiés', `<ul>${sum.files.map(f => `<li><code>${esc(f.path)}</code> <span>· ${esc(f.what)}</span></li>`).join('')}</ul>`),
    ];
    if (sum.replaced.length) html.push(item('Commandes remplacées (alias)', sum.replaced.map(r => `<code>${esc(r)}</code>`).join(', ')));
    if (sum.downloads.length) html.push(item('Téléchargements vérifiés par SHA-256', `<ul>${sum.downloads.map(d => `<li>${esc(d)}</li>`).join('')}</ul>`));
    if (sum.chsh) html.push(item('Shell par défaut', `${esc(sum.chsh)}, à la prochaine connexion`));
    $('rows').innerHTML = html.join('');
  }

  // ---------- script ----------
  let currentScript = '';
  function renderCode(text) {
    const lines = text.split('\n');
    let inChoices = false;
    $('code').innerHTML = lines.map(l => {
      if (l.startsWith('# --- Tes choix')) inChoices = true;
      else if (l.startsWith('# --- Contenu')) inChoices = false;
      const cls = inChoices && l.startsWith('CFG_') ? 'cf' : /^\s*#/.test(l) ? 'cm' : '';
      return `<div${cls ? ` class="${cls}"` : ''}>${esc(l)}</div>`;
    }).join('');
  }

  async function sha256(text) {
    if (!(window.crypto && crypto.subtle)) return null;
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
  }

  let renderId = 0;
  async function render() {
    cfg = readForm();
    writeForm(cfg);
    try { localStorage.setItem(STORE, JSON.stringify(cfg)); } catch (e) { /* ignore */ }
    const sum = C.summarize(cfg);
    renderTerm(cfg);
    renderReceipt(cfg, sum);
    currentScript = C.buildScript(cfg, engine);
    renderCode(currentScript);
    $('cmds').innerHTML =
      `<span class="c"># Vérifier, puis voir ce qui serait fait</span>\nsha256sum mysh-install.sh\nchmod +x mysh-install.sh\n./mysh-install.sh --dry-run\n\n<span class="c"># Installer</span>\n./mysh-install.sh`;
    const id = ++renderId;
    $('sha').textContent = 'calcul…';
    const h = await sha256(currentScript);
    if (id === renderId) $('sha').textContent = h || 'indisponible ici (lance sha256sum)';
  }

  // ---------- zip minimal (le script garde ses droits d'exécution) ----------
  const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  const crc32 = b => { let c = 0xffffffff; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  function zip(files) {
    const enc = new TextEncoder(), parts = [], central = [];
    let offset = 0;
    for (const f of files) {
      const name = enc.encode(f.name), data = enc.encode(f.text), crc = crc32(data);
      const h = new DataView(new ArrayBuffer(30));
      h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true);
      h.setUint16(8, 0, true); h.setUint16(10, 0, true); h.setUint16(12, 0x21, true);
      h.setUint32(14, crc, true); h.setUint32(18, data.length, true); h.setUint32(22, data.length, true);
      h.setUint16(26, name.length, true); h.setUint16(28, 0, true);
      parts.push(new Uint8Array(h.buffer), name, data);
      const cd = new DataView(new ArrayBuffer(46));
      cd.setUint32(0, 0x02014b50, true); cd.setUint16(4, 0x0314, true); cd.setUint16(6, 20, true); cd.setUint16(8, 0x0800, true);
      cd.setUint16(10, 0, true); cd.setUint16(12, 0, true); cd.setUint16(14, 0x21, true);
      cd.setUint32(16, crc, true); cd.setUint32(20, data.length, true); cd.setUint32(24, data.length, true);
      cd.setUint16(28, name.length, true); cd.setUint32(38, ((f.mode || 0o100644) << 16) >>> 0, true); cd.setUint32(42, offset, true);
      central.push(new Uint8Array(cd.buffer), name);
      offset += 30 + name.length + data.length;
    }
    const cdSize = central.reduce((n, p) => n + p.length, 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
    end.setUint32(12, cdSize, true); end.setUint32(16, offset, true);
    return new Blob([...parts, ...central, new Uint8Array(end.buffer)], { type: 'application/zip' });
  }

  // ---------- actions ----------
  const note = (text, kind) => { $('dlNote').textContent = text; $('dlNote').className = 'note' + (kind ? ' ' + kind : ''); };
  const downloadsReady = (window.claude && typeof window.claude.use === 'function')
    ? window.claude.use('downloads').catch(() => null) : Promise.resolve(null);

  $('dlBtn').addEventListener('click', async () => {
    const script = currentScript;
    const hash = $('sha').textContent;
    const dl = await downloadsReady;
    if (dl) {
      const readme = [
        'Mysh — personnalisation du terminal', '',
        'Empreinte SHA-256 de mysh-install.sh :', hash, '',
        'unzip mysh.zip && cd mysh',
        'sha256sum mysh-install.sh     # doit afficher l’empreinte ci-dessus',
        './mysh-install.sh --dry-run   # voir ce qui serait fait',
        './mysh-install.sh             # installer', '',
        'Annuler : ~/.local/share/mysh/mysh.sh --uninstall', '',
      ].join('\n');
      try {
        await dl.save({ filename: 'mysh.zip', data: zip([
          { name: 'mysh/mysh-install.sh', text: script, mode: 0o100755 },
          { name: 'mysh/LISEZMOI.txt', text: readme },
        ]) });
        note('Enregistré : mysh.zip contient le script (déjà exécutable) et un LISEZMOI.', 'ok');
      } catch (e) {
        if (e && e.code === 'declined') note('Téléchargement annulé.', 'bad');
        else note('Le téléchargement n’est pas disponible ici. Utilise « Copier » et colle le script dans mysh-install.sh.', 'bad');
      }
      return;
    }
    const url = URL.createObjectURL(new Blob([script], { type: 'text/x-shellscript' }));
    const a = document.createElement('a');
    a.href = url; a.download = 'mysh-install.sh';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    note('mysh-install.sh téléchargé. Vérifie son empreinte avant de le lancer.', 'ok');
  });

  async function copy(text, okMsg, fallbackEl) {
    try { await navigator.clipboard.writeText(text); note(okMsg, 'ok'); }
    catch (e) {
      const r = document.createRange(); r.selectNodeContents(fallbackEl);
      const s = getSelection(); s.removeAllRanges(); s.addRange(r);
      note('Texte sélectionné : copie-le avec Ctrl+C.', 'bad');
    }
  }
  $('copyBtn').addEventListener('click', () => copy(currentScript, 'Script copié. Colle-le dans un fichier mysh-install.sh.', $('code')));
  $('shaBtn').addEventListener('click', () => copy($('sha').textContent, 'Empreinte copiée.', $('sha')));
  $('form').addEventListener('change', e => {
    if (e.target.id === 'logoOn' && e.target.checked) { $('tool-fastfetch').checked = true; $('fastfetchStart').checked = true; }
    if (e.target.id === 'logoFile') { loadUpload(e.target.files[0]); e.target.value = ''; return; }
    render();
  });
  ['logoCols', 'logoDensity'].forEach(id => $(id).addEventListener('input', render));
  $('sampleBtn').addEventListener('click', () => {
    setSource(drawSample(), 'sample');
    try { localStorage.removeItem(LOGO_STORE); } catch (e) { /* ignore */ }
    render();
  });
  const drop = $('drop');
  ['dragenter', 'dragover'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, () => drop.classList.remove('over')));
  drop.addEventListener('drop', e => { e.preventDefault(); loadUpload(e.dataTransfer.files[0]); });
  $('form').addEventListener('submit', e => e.preventDefault());
  $('ver').textContent = C.VERSION;

  setSource(drawSample(), 'sample');
  writeForm(cfg);
  render();
  try {
    const saved = localStorage.getItem(LOGO_STORE);
    if (saved) {
      const img = new Image();
      img.onload = () => { setSource(img, 'upload'); render(); };
      img.src = saved;
    }
  } catch (e) { /* stockage indisponible */ }
})();
