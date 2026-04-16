(function () {
  // Si ya está instalada como PWA → no mostrar nada
  if (window.navigator.standalone === true) return;
  if (window.matchMedia('(display-mode: standalone)').matches) return;

  // Si ya lo descartó en esta sesión → no molestar
  if (sessionStorage.getItem('pwa-dismissed')) return;

  var isIOS    = /iphone|ipad|ipod/i.test(navigator.userAgent);
  var isSafari = isIOS && /safari/i.test(navigator.userAgent) && !/crios|fxios|opios|mercury/i.test(navigator.userAgent);

  /* ── Estilos del banner ── */
  var style = document.createElement('style');
  style.textContent = `
    #pwa-banner {
      position: fixed; bottom: 0; left: 0; right: 0; z-index: 9999;
      background: #1e3a8a; color: #fff;
      padding: 14px 16px; display: flex; align-items: center; gap: 12px;
      box-shadow: 0 -4px 16px rgba(0,0,0,.25);
      animation: pwaSlideUp .3s ease;
    }
    @keyframes pwaSlideUp {
      from { transform: translateY(100%); opacity: 0; }
      to   { transform: translateY(0);    opacity: 1; }
    }
    #pwa-banner img  { width: 44px; height: 44px; border-radius: 10px; object-fit: contain; flex-shrink: 0; }
    #pwa-banner .pwa-text { flex: 1; font-size: 13px; line-height: 1.4; font-family: -apple-system, sans-serif; }
    #pwa-banner .pwa-text strong { display: block; font-size: 14px; margin-bottom: 2px; }
    #pwa-banner .pwa-btn {
      background: #fff; color: #1e3a8a; border: none; border-radius: 8px;
      padding: 8px 14px; font-size: 13px; font-weight: 700; cursor: pointer;
      white-space: nowrap; font-family: inherit; flex-shrink: 0;
    }
    #pwa-banner .pwa-close {
      background: transparent; border: none; color: rgba(255,255,255,.6);
      font-size: 20px; cursor: pointer; padding: 0 4px; line-height: 1;
      flex-shrink: 0;
    }
    #pwa-banner .pwa-close:hover { color: #fff; }
    .pwa-share-icon { display: inline-block; vertical-align: middle; margin: 0 2px; }
  `;
  document.head.appendChild(style);

  function dismiss() {
    var el = document.getElementById('pwa-banner');
    if (el) { el.style.transform = 'translateY(100%)'; el.style.opacity = '0'; el.style.transition = 'all .25s'; setTimeout(function(){ el.remove(); }, 260); }
    sessionStorage.setItem('pwa-dismissed', '1');
  }

  function createBanner(contentHtml) {
    var div = document.createElement('div');
    div.id = 'pwa-banner';
    div.innerHTML =
      '<img src="/logo.jpeg" alt="Glory\'s Snack" />' +
      contentHtml +
      '<button class="pwa-close" onclick="(function(){var el=document.getElementById(\'pwa-banner\');if(el){el.style.transform=\'translateY(100%)\';el.style.opacity=\'0\';el.style.transition=\'all .25s\';setTimeout(function(){el.remove()},260)}sessionStorage.setItem(\'pwa-dismissed\',\'1\')})()">✕</button>';
    document.body.appendChild(div);
  }

  /* ── iOS Safari: instrucciones manuales ── */
  if (isSafari) {
    createBanner(
      '<div class="pwa-text">' +
        '<strong>Instala Glory\'s Snack</strong>' +
        'Toca <svg class="pwa-share-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/></svg> y luego <strong style="font-weight:700">"Añadir a inicio"</strong>' +
      '</div>'
    );
    // Auto-ocultar después de 8 segundos
    setTimeout(dismiss, 8000);
    return;
  }

  /* ── Android / Chrome: botón de instalación ── */
  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault();
    createBanner(
      '<div class="pwa-text">' +
        '<strong>Instala Glory\'s Snack</strong>' +
        'Accede más rápido desde tu pantalla de inicio' +
      '</div>' +
      '<button class="pwa-btn" id="pwa-install-btn">Instalar</button>'
    );
    document.getElementById('pwa-install-btn').addEventListener('click', function () {
      e.prompt();
      e.userChoice.then(function () { dismiss(); });
    });
  });
})();
