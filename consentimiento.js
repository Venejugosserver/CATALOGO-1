/* Digimarket · aceptación de Términos y Política de privacidad.
   Dos casillas separadas, sin marcar, con enlace a cada documento.
   No se pide el nombre: se registra fecha, hora, versión y forma de aceptación. */
(function () {
  'use strict';
  const L = window.VJ_LEGAL;
  if (!L) return;
  const C_VIGENTE = 'vj_consentimiento', C_LOG = 'vj_consentimientos', C_DISP = 'vj_dispositivo';
  const ls = (() => {
    try { const s = window.localStorage; s.setItem('__vj', '1'); s.removeItem('__vj'); return s; }
    catch (e) { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }; }
  })();
  const leer = (k, d = null) => { try { const v = ls.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } };
  const guardar = (k, v) => { try { ls.setItem(k, JSON.stringify(v)); } catch (e) { /* sin espacio */ } };
  const uuid = () => (crypto.randomUUID ? crypto.randomUUID()
    : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => { const r = crypto.getRandomValues(new Uint8Array(1))[0] & 15; return (c === 'x' ? r : (r & 3) | 8).toString(16); }));
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function dispositivo() { let id = leer(C_DISP); if (!id) { id = uuid(); guardar(C_DISP, id); } return id; }
  function vigente() {
    const c = leer(C_VIGENTE);
    return !!(c && c.terminos_version === L.version.terminos && c.privacidad_version === L.version.privacidad);
  }
  const marcas = { terminos: null, privacidad: null, abrio: { terminos: false, privacidad: false, cookies: false } };

  function registro(tipo, extra) {
    const ahora = new Date();
    return {
      id: uuid(), tipo, sitio: L.sitio,
      registrado_en: ahora.toISOString(),
      hora_local: ahora.toLocaleString('es-VE', { dateStyle: 'short', timeStyle: 'medium' }),
      zona_horaria: (Intl.DateTimeFormat().resolvedOptions().timeZone) || '',
      dispositivo: dispositivo(),
      pagina: location.origin + location.pathname,
      navegador: navigator.userAgent,
      idioma: navigator.language || '',
      pantalla: `${screen.width}x${screen.height}`,
      modo: matchMedia('(display-mode: standalone)').matches ? 'app instalada' : 'navegador',
      ...extra
    };
  }
  async function enviar(r) {
    if (!L.registroUrl) return 'local';
    try {
      const resp = await fetch(L.registroUrl, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(r) });
      const d = await resp.json().catch(() => ({}));
      return resp.ok && d.ok ? 'enviado' : 'pendiente';
    } catch (e) { return 'pendiente'; }
  }
  async function anotar(r) {
    const log = leer(C_LOG, []);
    log.push({ ...r, envio: 'enviando' });
    guardar(C_LOG, log.slice(-200));
    const estado = await enviar(r);
    const log2 = leer(C_LOG, []);
    const it = log2.find((x) => x.id === r.id);
    if (it) { it.envio = estado; guardar(C_LOG, log2); }
    return estado;
  }
  // Si se activa el registro central después, envía lo que quedó solo en local
  async function reenviarPendientes() {
    if (!L.registroUrl) return;
    const log = leer(C_LOG, []);
    let cambio = false;
    for (const it of log) {
      if (it.envio === 'enviado') continue;
      const { envio, ...limpio } = it;
      it.envio = await enviar(limpio); cambio = true;
    }
    if (cambio) guardar(C_LOG, log);
  }

  function aviso(t) {
    const a = document.getElementById('avisoFlotante');
    if (!a) return;
    a.textContent = t; a.classList.add('visible');
    setTimeout(() => a.classList.remove('visible'), 2800);
  }

  /* ---------- Ventana de aceptación ---------- */
  let dlg;
  function construir() {
    dlg = document.createElement('dialog');
    dlg.className = 'consent';
    dlg.setAttribute('aria-labelledby', 'vjConsentT');
    dlg.innerHTML = `
      <form method="dialog" novalidate>
        <img class="consent-logo" src="logo.png" alt="Venejugos" width="120" height="81">
        <h2 id="vjConsentT">Antes de entrar a ${esc(L.sitio)}</h2>
        <p>Para usar el catálogo necesitamos que leas y aceptes, por separado, estos dos documentos. No te pedimos tu nombre: solo guardamos la fecha, la hora y la forma en que aceptas.</p>
        <label class="casilla" for="vjChkT">
          <input type="checkbox" id="vjChkT">
          <span>He leído y acepto los <a href="terminos.html" target="_blank" rel="noopener" data-abre="terminos">Términos y condiciones</a> (versión ${esc(L.version.terminos)}).</span>
        </label>
        <label class="casilla" for="vjChkP">
          <input type="checkbox" id="vjChkP">
          <span>He leído y acepto la <a href="privacidad.html" target="_blank" rel="noopener" data-abre="privacidad">Política de privacidad</a> (versión ${esc(L.version.privacidad)}).</span>
        </label>
        <p class="nota">${esc(L.sitio)} no usa cookies. Guarda algunos datos en tu navegador para funcionar, como tu pedido; lo explicamos en la <a href="cookies.html" target="_blank" rel="noopener" data-abre="cookies">Política de cookies</a>.</p>
        <div class="falta" id="vjFalta" aria-live="polite"></div>
        <div class="acciones-dlg"><button class="btn btn-primario" type="submit" id="vjAceptar" disabled>Aceptar y entrar</button></div>
      </form>`;
    document.body.appendChild(dlg);
    const chkT = dlg.querySelector('#vjChkT'), chkP = dlg.querySelector('#vjChkP'), btn = dlg.querySelector('#vjAceptar');
    const revisar = () => { btn.disabled = !(chkT.checked && chkP.checked); if (!btn.disabled) dlg.querySelector('#vjFalta').textContent = ''; };
    chkT.addEventListener('change', () => { marcas.terminos = chkT.checked ? new Date().toISOString() : null; revisar(); });
    chkP.addEventListener('change', () => { marcas.privacidad = chkP.checked ? new Date().toISOString() : null; revisar(); });
    dlg.querySelectorAll('[data-abre]').forEach((a) => a.addEventListener('click', () => { marcas.abrio[a.dataset.abre] = true; }));
    dlg.addEventListener('cancel', (e) => e.preventDefault()); // Esc no la cierra
    dlg.querySelector('form').addEventListener('submit', (e) => {
      e.preventDefault();
      if (!(chkT.checked && chkP.checked)) { dlg.querySelector('#vjFalta').textContent = 'Marca las dos casillas para continuar.'; return; }
      aceptar();
    });
  }
  function abrir(actualizado) {
    if (!dlg) construir();
    dlg.querySelector('#vjChkT').checked = false; dlg.querySelector('#vjChkP').checked = false;
    marcas.terminos = marcas.privacidad = null;
    dlg.querySelector('#vjAceptar').disabled = true;
    dlg.querySelector('#vjFalta').textContent = actualizado ? 'Actualizamos los documentos. Revísalos y acéptalos de nuevo.' : '';
    document.documentElement.classList.add('vj-bloqueado');
    if (typeof dlg.showModal === 'function') dlg.showModal(); else dlg.setAttribute('open', '');
  }
  function aceptar() {
    const r = registro('aceptacion', {
      terminos_version: L.version.terminos, terminos_aceptado: marcas.terminos,
      privacidad_version: L.version.privacidad, privacidad_aceptado: marcas.privacidad,
      cookies_version: L.version.cookies,
      abrio_terminos: marcas.abrio.terminos ? 'sí' : 'no',
      abrio_privacidad: marcas.abrio.privacidad ? 'sí' : 'no',
      abrio_cookies: marcas.abrio.cookies ? 'sí' : 'no',
      metodo: `Dos casillas separadas, sin marcar por defecto, con enlace a cada documento, en la ventana "Antes de entrar a ${L.sitio}"; confirmación con el botón "Aceptar y entrar". No se solicita el nombre.`
    });
    guardar(C_VIGENTE, r);
    if (dlg.open) dlg.close();
    document.documentElement.classList.remove('vj-bloqueado');
    aviso(`Listo. Ya puedes usar ${L.sitio}.`);
    document.dispatchEvent(new CustomEvent('vj:consentimiento', { detail: r }));
    anotar(r);
  }

  /* ---------- Retiro del consentimiento ---------- */
  function confirmarRetiro() {
    return new Promise((resolver) => {
      const d = document.createElement('dialog');
      d.className = 'consent';
      d.setAttribute('aria-labelledby', 'vjRetiroT');
      d.innerHTML = `<form method="dialog">
        <h2 id="vjRetiroT">¿Retirar tu consentimiento?</h2>
        <p>Dejarás de poder usar ${esc(L.sitio)} hasta que vuelvas a aceptar. Borraremos de este navegador tu aceptación y el pedido que tengas guardado (productos y datos de entrega). Guardaremos la fecha en que lo retiraste.</p>
        <div class="acciones-dlg"><button class="btn" value="no">Cancelar</button><button class="btn btn-primario" value="si">Retirar consentimiento</button></div></form>`;
      document.body.appendChild(d);
      d.addEventListener('close', () => { resolver(d.returnValue === 'si'); d.remove(); });
      d.showModal();
    });
  }
  async function retirar() {
    if (!(await confirmarRetiro())) return;
    const r = registro('retiro', { metodo: 'Enlace "Retirar mi consentimiento" del pie de página.' });
    ls.removeItem(C_VIGENTE);
    ls.removeItem('vj_pedido_v2');
    await Promise.race([anotar(r), new Promise((ok) => setTimeout(ok, 2500))]);
    location.reload();
  }

  function iniciar() {
    document.addEventListener('click', (e) => {
      const a = e.target.closest('[data-retirar-consentimiento]');
      if (a) { e.preventDefault(); retirar(); }
    });
    if (!vigente()) abrir(!!leer(C_VIGENTE));
    reenviarPendientes();
  }
  window.VJ_CONSENTIMIENTO = { vigente, abrir };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar); else iniciar();
})();
