// Only in the desktop build: connects the shared app to real files through the Rust side.
// A document tied to a file autosaves to that file, as well as to the app's history.
// If the file changed outside the app, autosave stops and Save asks what to do.
(() => {
  const { invoke } = window.__TAURI__.core;
  const { listen } = window.__TAURI__.event;
  const KEY = 'focusmd_files';

  // Document id -> the file behind it.
  let files = {};
  try { files = JSON.parse(Store.get(KEY) || '{}'); } catch { files = {}; }
  const remember = () => Store.set(KEY, JSON.stringify(files));
  const fileOf = id => (id ? files[id] : null);

  const hash = s => {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return (h >>> 0).toString(36) + ':' + s.length;
  };

  const failed = e => toast(String(e), 'err');

  // The editor works with plain \n and no BOM. A file gets back what it came with.
  function fromDisk(text) {
    const bom = text.charCodeAt(0) === 0xfeff;
    const body = bom ? text.slice(1) : text;
    const crlf = (body.match(/\r\n/g) || []).length;
    const lf = (body.match(/\n/g) || []).length;
    return { bom, crlf: crlf > 0 && crlf * 2 >= lf, content: body.replace(/\r\n?/g, '\n') };
  }
  const toDisk = (content, f) => (f.bom ? '﻿' : '') + (f.crlf ? content.replace(/\n/g, '\r\n') : content);
  const titleFrom = name => name.replace(/\.(md|markdown|txt)$/i, '');

  function badge() {
    const f = fileOf(currentId);
    if (!f) return;
    if (f.conflict) {
      badgeEl.textContent = 'File changed';
      badgeEl.className = 'save-badge unsaved';
      badgeEl.title = f.path + ' changed outside Focus.MD. Your edits are kept here. Press Save to choose which version to keep.';
    } else if (f.paused || f.failed) {
      badgeEl.textContent = 'Not saved';
      badgeEl.className = 'save-badge unsaved';
      badgeEl.title = 'Your edits are kept in Focus.MD but not in ' + f.path + '. Press Save to choose what to do.';
    } else if (hash(editorEl.value) === f.hash) {
      badgeEl.textContent = 'Saved';
      badgeEl.className = 'save-badge saved';
      badgeEl.title = 'Saved to ' + f.path;
    } else {
      badgeEl.textContent = 'Unsaved';
      badgeEl.className = 'save-badge unsaved';
      badgeEl.title = 'Saving to ' + f.path;
    }
  }

  const baseName = p => p.split(/[\\/]/).pop();
  const cleanName = t => t.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '-').trim() || 'Untitled';

  // Leaves the original alone and carries on in the new file.
  async function saveCopy(id, content) {
    const f = files[id];
    const stem = titleFrom(f ? baseName(f.path) : (titleEl.value || 'Untitled'));
    const s = await invoke('save_as', { name: cleanName(stem) + ' copy.md', content: f ? toDisk(content, f) : content });
    if (!s) return false;
    files[id] = { path: s.path, bom: f ? f.bom : false, crlf: f ? f.crlf : false, mtime: s.mtime, hash: hash(content) };
    remember();
    if (id === currentId) titleEl.value = titleFrom(s.name);
    toast(`Saved a copy: ${s.name}`, 'ok');
    return true;
  }

  // Every write goes through here. ask = true when the person pressed Save.
  async function write(id, content, ask) {
    const f = files[id];
    if (!f) return false;
    try {
      const s = await invoke('save_file', { path: f.path, content: toDisk(content, f), knownMtime: f.mtime, ask });
      if (!s) return false;
      Object.assign(f, { mtime: s.mtime, hash: hash(content), conflict: false, failed: false, paused: false });
      remember();
      return s;
    } catch (e) {
      if (e === 'CONFLICT') {
        f.conflict = true;
        remember();
        toast(`${baseName(f.path)} changed outside Focus.MD. Autosave is paused.`, 'err');
        return false;
      }
      if (e === 'NO_ACCESS') {
        const choice = await invoke('ask_access', { path: f.path });
        if (choice === 'file') return write(id, content, ask);
        if (choice === 'copy' && (await saveCopy(id, content))) return true;
        f.paused = true;
        remember();
        return false;
      }
      // Autosave asks only once, so a full disk doesn't bring up a dialog at every pause in typing.
      if (ask || !f.failed) {
        f.failed = true;
        if (await invoke('ask_copy', { message: String(e) })) return saveCopy(id, content);
      }
      return false;
    }
  }

  // One write at a time, newest content wins, so a slow disk can't save things out of order.
  const queue = new Map();
  let pump = null;
  async function runQueue() {
    while (queue.size) {
      const [id, content] = queue.entries().next().value;
      queue.delete(id);
      await write(id, content, false);
      if (id === currentId) badge();
    }
    pump = null;
  }
  function queueWrite(id, content) {
    const f = files[id];
    if (!f || f.conflict || f.paused || hash(content) === f.hash) return;
    queue.set(id, content);
    if (!pump) pump = runQueue();
  }

  const basePersist = persist;
  persist = function () {
    const r = basePersist();
    queueWrite(currentId, r.content);
    badge();
    return r;
  };

  function show(content, title) {
    titleEl.value = title;
    editorEl.value = content;
    UndoStack.reset(content);
    renderPreview();
    updateWords();
  }

  async function openFile(o) {
    if (!flushSave('Open this file')) return;
    const disk = fromDisk(o.content);
    const known = Object.keys(files).find(id => files[id].path === o.path && History.get(id));
    const meta = { path: o.path, bom: disk.bom, crlf: disk.crlf, mtime: o.mtime, hash: hash(disk.content) };
    if (known) {
      const f = files[known], stored = History.get(known).content;
      const unsaved = hash(stored) !== f.hash;
      if (unsaved && f.hash === meta.hash) {
        // The file hasn't moved on, so edits from last time are still the newest version.
        currentId = known; files[known] = meta; remember();
        show(stored, titleFrom(o.name)); persist();
        toast('Restored your unsaved changes.', 'ok');
        focusWritingSide();
        return;
      }
      if (!unsaved) {
        currentId = known; files[known] = meta; remember();
        show(disk.content, titleFrom(o.name)); persist();
        toast(`Opened: ${o.name}`, 'ok');
        focusWritingSide();
        return;
      }
      // Both changed: keep last time's edits in history under their own entry, untouched.
      delete files[known];
    }
    if (!(await makeRoom())) return;
    currentId = null;
    show(disk.content, titleFrom(o.name));
    persist();
    files[currentId] = meta;
    remember();
    badge();
    toast(`Opened: ${o.name}`, 'ok');
    focusWritingSide();
  }

  const pick = () => invoke('open_dialog').then(o => (o ? openFile(o) : null)).catch(failed);
  const openPath = path => invoke('read_opened', { path }).then(openFile).catch(failed);

  async function saveAs() {
    if (!currentId && !(await makeRoom())) return;
    const { title, content } = basePersist();
    const f = fileOf(currentId) || { bom: false, crlf: navigator.userAgent.includes('Windows') };
    const name = (title.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '-').trim() || 'Untitled');
    try {
      const s = await invoke('save_as', { name: /\.md$/i.test(name) ? name : name + '.md', content: toDisk(content, f) });
      if (!s) { badge(); return; }
      files[currentId] = { path: s.path, bom: f.bom, crlf: f.crlf, mtime: s.mtime, hash: hash(content) };
      remember();
      titleEl.value = titleFrom(s.name);
      persist();
      toast(`Saved: ${s.name}`, 'ok');
    } catch (e) { failed(e); }
  }

  // Ctrl/Cmd+S and the toolbar button already call this.
  exportDoc = async function () {
    const f = fileOf(currentId);
    if (!f) return saveAs();
    const { content } = basePersist();
    if (pump) await pump;
    const s = await write(currentId, content, true).catch(e => { failed(e); return false; });
    badge();
    if (s && s.name) toast(`Saved: ${s.name}`, 'ok');
  };

  // Downloading from the History menu makes a separate copy through Save As.
  downloadFile = function (title, content) {
    const name = (title.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '-').trim() || 'Untitled');
    invoke('save_as', { name: /\.md$/i.test(name) ? name : name + '.md', content })
      .then(s => { if (s) toast(`Saved: ${s.name}`, 'ok'); })
      .catch(failed);
  };

  // Save as… in the History menu uses the same native dialog.
  saveCopy = (title, content) => downloadFile(title, content);

  // The Open button and shortcut both click the hidden file input.
  document.getElementById('fileInput').click = pick;

  const exportBtn = document.getElementById('btnExport');
  exportBtn.querySelector('span').textContent = 'Save';
  exportBtn.setAttribute('aria-label', 'Save (Ctrl+S)');

  // Windows has no menu bar, and the Mac menu takes these before the page sees them.
  document.addEventListener('keydown', e => {
    if (!(e.ctrlKey || e.metaKey)) return;
    const k = (e.key || '').toLowerCase();
    if (k === 's' && e.shiftKey) { e.preventDefault(); e.stopPropagation(); saveAs(); }
    else if (k === 'n' && !e.shiftKey) { e.preventDefault(); e.stopPropagation(); newDoc(false); }
  }, true);

  // Links open in the person's browser. A plain click in the document only places the cursor.
  const external = url => invoke('open_external', { url }).catch(failed);
  window.open = url => { external(String(url)); return null; };
  document.addEventListener('click', e => {
    const a = e.target.closest && e.target.closest('a[href]');
    if (!a || !/^(https?:|mailto:)/i.test(a.href)) return;
    if (previewEl.contains(a)) return;
    e.preventDefault();
    external(a.href);
  }, true);

  listen('open-file', e => openPath(e.payload));
  // Closing or quitting: finish any pending save, then let the app go.
  listen('close-requested', async () => {
    try {
      clearTimeout(saveTimer);
      if (isDirty) persist();
      if (pump) await pump;
    } finally {
      invoke('finish_close');
    }
  });
  listen('menu', e => {
    const inTitle = document.activeElement === titleEl;
    ({
      about: showAbout,
      new: () => newDoc(false),
      open: pick,
      save: () => exportDoc(),
      'save-as': saveAs,
      undo: () => (inTitle ? document.execCommand('undo') : historyStep(UndoStack.applyUndo)),
      redo: () => (inTitle ? document.execCommand('redo') : historyStep(UndoStack.applyRedo)),
    }[e.payload] || (() => {}))();
  });

  badge();
  invoke('take_pending').then(list => list.forEach(openPath)).catch(failed);
})();
