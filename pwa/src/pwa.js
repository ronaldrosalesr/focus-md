// Only in the installable build. The single-file download doesn't include this.
(() => {
  if ('serviceWorker' in navigator && isSecureContext) {
    addEventListener('load', () => { navigator.serviceWorker.register('./sw.js').catch(() => {}); });
  }

  const standalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

  // Asks the browser not to clear documents when space runs low. Only once installed,
  // since that's when someone has clearly chosen to keep the app.
  if (standalone() && navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});

  // Browsers that support it offer installing through their own prompt; show a button for it.
  let promptEvent = null;
  const button = document.createElement('button');
  button.id = 'btnInstall';
  button.className = 'tb-btn';
  button.hidden = true;
  button.setAttribute('aria-label', 'Install Focus.MD as an app');
  button.title = 'Install Focus.MD as an app';
  button.innerHTML = '<svg viewBox="0 0 20 20"><rect x="3" y="4" width="14" height="10" rx="1.5" stroke-width="1.8"/><path d="M7 17h6M10 7v4m0 0-2-2m2 2 2-2" stroke-width="1.8"/></svg><span>Install</span>';
  document.getElementById('btnNew').before(button);
  addEventListener('beforeinstallprompt', e => {
    e.preventDefault();
    promptEvent = e;
    button.hidden = false;
  });
  button.addEventListener('click', async () => {
    if (!promptEvent) return;
    const ev = promptEvent;
    promptEvent = null;
    button.hidden = true;
    await ev.prompt();
  });
  addEventListener('appinstalled', () => {
    promptEvent = null;
    button.hidden = true;
    toast('Focus.MD is installed. Open it like any other app.', 'ok');
  });

  // Keeps the window's title bar in step with the app's own light and dark toggle.
  const bar = document.querySelector('meta[name="theme-color"]');
  const paintBar = () => { bar.content = document.documentElement.dataset.theme === 'dark' ? '#1b1a18' : '#ffffff'; };
  new MutationObserver(paintBar).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  paintBar();

  // "Open with Focus.MD" on a .md file, once installed (Chrome and Edge).
  // It reuses the normal open path, so it behaves like the Open button.
  if ('launchQueue' in window) {
    window.launchQueue.setConsumer(async params => {
      const handle = params.files && params.files[0];
      if (!handle) return;
      const file = await handle.getFile();
      const dt = new DataTransfer();
      dt.items.add(file);
      const input = document.getElementById('fileInput');
      input.files = dt.files;
      input.dispatchEvent(new Event('change'));
    });
  }
})();
