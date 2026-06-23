(() => {
  const canRegisterServiceWorker =
    'serviceWorker' in navigator &&
    window.isSecureContext &&
    (location.protocol === 'https:' || location.hostname === '127.0.0.1' || location.hostname === 'localhost');

  if (!canRegisterServiceWorker) return;

  const serviceWorkerUrl = new URL('sw.js', new URL('./', location.href));

  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register(serviceWorkerUrl)
      .catch(error => console.warn('Geo Rafidain service worker registration failed:', error));
  });
})();
