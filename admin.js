/* =========================================================================
   Digimarket · Panel de administración
   - Toda edición se aplica por ID (nunca por posición en la tabla).
   - Fotos se optimizan en el navegador y se suben junto con los datos en
     UN SOLO commit atómico (Git Data API): o se publica todo o nada.
   - Antes de publicar se valida y se detecta si alguien más publicó.
   ========================================================================= */
(function () {
  'use strict';
  const { TIENDA, CATEGORIAS, esc, dinero, nombreCategoria } = VJ;
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];

  /* ---------- Acceso por rol (2 fases de trabajo) ----------
     Solo se guarda el SHA-256 de cada clave, normalizada sin espacios y en
     mayúsculas ("INVENTARIO 2026" = "inventario2026"). Ver README para cambiarlas. */
  const ROLES = {
    inventario: { nombre: 'Inventario', hash: 'c168b468c4c066b30fda7608b85a058dbff55a8b8b20b061e1c289b31f75dd84', tabs: ['productos', 'promociones', 'importar', 'conexion'] },
    visuales:   { nombre: 'Visuales',   hash: '7b908c005b13ad0bb5ca5371ab5bc5dd11975b108d219d6f5b42ab9657ef26ae', tabs: ['fotos', 'imagenes', 'banners', 'conexion'] }
  };
  // Campos que cada rol puede modificar. Al publicar, SOLO estos campos se
  // mezclan sobre la versión más reciente en GitHub; el resto se respeta.
  const PERMISOS = {
    inventario: { prod: ['codigo', 'producto', 'marca', 'categoria', 'modulo', 'precio', 'descuento', 'stock', 'descripcion', 'destacado'], promo: ['titulo', 'descripcion', 'etiqueta', 'color', 'desde', 'hasta', 'descuento', 'productos', 'activo'], crear: true },
    visuales:   { prod: ['imagen', 'galeria'], promo: ['imagen', 'imagenMovil'], crear: false }
  };
  const sesion = VJ.almacen('sessionStorage');
  const local = VJ.almacen('localStorage');
  let ROL = null;
  let saliendo = false;
  const normClave = t => String(t || '').toUpperCase().replace(/\s+/g, '');

  async function sha256(t) {
    const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(t));
    return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('');
  }
  $('#formAcceso').addEventListener('submit', async e => {
    e.preventDefault();
    const h = await sha256(normClave($('#clave').value));
    const rol = Object.keys(ROLES).find(k => ROLES[k].hash === h);
    if (rol) { sesion.setItem('vj_admin_rol', rol); entrar(rol); }
    else { $('#errorAcceso').textContent = 'Clave incorrecta.'; $('#clave').select(); }
  });
  function entrar(rol) {
    ROL = rol; document.body.dataset.rol = rol;
    $('#acceso').hidden = true; $('#acceso').style.display = 'none'; $('#panel').hidden = false;
    $('#rolActual').textContent = 'Fase: ' + ROLES[rol].nombre;
    $$('.pestana').forEach(b => { b.hidden = !ROLES[rol].tabs.includes(b.dataset.tab); });
    activarTab(ROLES[rol].tabs[0]);
    iniciar();
  }

  /* ---------- Estado ---------- */
  let inv = [];
  const porId = new Map();
  let promos = [];
  let idxPromos = new Map();
  const snap = { prod: '', promo: '' };          // texto publicado/cargado
  const shaBase = { prod: null, promo: null };    // sha git de lo cargado
  let refsBase = new Set();                       // rutas de imágenes al cargar
  const pendientes = new Map();                   // ruta → { blob, url }
  const vistasLocales = new Map();                // ruta publicada → objectURL (para verlas mientras Pages despliega)
  const nuevos = new Set(), editados = new Set();
  let origen = 'sitio';
  const seleccion = new Set();
  const vista = { q: '', cat: '', marca: '', modulo: '', rapido: '', orden: 'producto-asc', pag: 1 };
  const POR_PAGINA = 50;
  let iniciado = false;

  const claveBorrador = () => 'vj_borrador_' + ROL;
  const rutaRepo = archivo => { const c = cfg().carpeta.replace(/^\/+|\/+$/g, ''); return c ? c + '/' + archivo : archivo; };

  /* ---------- Serialización estable ---------- */
  const ORDEN_CAMPOS = ['id', 'codigo', 'producto', 'marca', 'categoria', 'modulo', 'precio', 'descuento', 'stock', 'imagen', 'galeria', 'descripcion', 'destacado'];
  function serializarProductos(lista) {
    return JSON.stringify(lista.map(p => { const o = {}; for (const k of ORDEN_CAMPOS) o[k] = p[k]; return o; }), null, 1) + '\n';
  }
  function serializarPromos(lista, productos = inv) {
    const validos = new Set(productos.map(p => p.id));
    return JSON.stringify(lista.map(p => ({ ...p, productos: p.productos.filter(id => validos.has(id)) })), null, 1) + '\n';
  }
  function reindexar() {
    porId.clear(); for (const p of inv) porId.set(p.id, p);
    idxPromos = VJ.indicePromos(promos);
  }
  const siguienteId = () => inv.reduce((m, p) => Math.max(m, p.id), 0) + 1;
  function refsImagenes(listaProd = inv, listaPromos = promos) {
    const s = new Set();
    const esLocal = u => u && !/^https?:/i.test(u) && !/^(blob|data):/i.test(u);
    for (const p of listaProd) { if (esLocal(p.imagen)) s.add(p.imagen); for (const g of p.galeria) if (esLocal(g)) s.add(g); }
    for (const p of listaPromos) { if (esLocal(p.imagen)) s.add(p.imagen); if (esLocal(p.imagenMovil)) s.add(p.imagenMovil); }
    return s;
  }
  const srcVista = ruta => {
    if (!ruta) return '';
    if (pendientes.has(ruta)) return pendientes.get(ruta).url;
    if (vistasLocales.has(ruta)) return vistasLocales.get(ruta);
    return VJ.urlSegura(ruta);
  };

  /* ---------- Configuración GitHub ---------- */
  function cfg() {
    let c = {};
    try { c = JSON.parse(local.getItem('vj_cfg') || '{}'); } catch (e) {}
    const token = sesion.getItem('vj_token') || local.getItem('vj_token') || '';
    // Autodetección para sitios publicados en USUARIO.github.io/REPO/
    if (!c.owner && /\.github\.io$/i.test(location.hostname)) {
      c.owner = location.hostname.split('.')[0];
      const seg = location.pathname.split('/').filter(Boolean)[0];
      c.repo = seg && !/\.html?$/i.test(seg) ? seg : location.hostname;
    }
    return { owner: c.owner || '', repo: c.repo || '', branch: c.branch || 'main', carpeta: c.carpeta || '', token };
  }
  const hayConexion = () => { const c = cfg(); return !!(c.owner && c.repo && c.token); };

  async function gh(ruta, opciones = {}) {
    const c = cfg();
    const r = await fetch(`https://api.github.com/repos/${encodeURIComponent(c.owner)}/${encodeURIComponent(c.repo)}${ruta}`, {
      ...opciones,
      headers: { Authorization: `Bearer ${c.token}`, Accept: opciones.raw ? 'application/vnd.github.raw+json' : 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', ...(opciones.body ? { 'Content-Type': 'application/json' } : {}) }
    });
    if (!r.ok) {
      let msg = ''; try { msg = (await r.json()).message || ''; } catch (e) {}
      const err = new Error(traducirErrorGH(r.status, msg)); err.status = r.status; throw err;
    }
    return opciones.raw ? r.text() : r.json();
  }
  function traducirErrorGH(status, msg) {
    if (status === 401) return 'El token no es válido o expiró (401).';
    if (status === 403) return 'El token no tiene permiso de escritura sobre este repositorio (403). ' + msg;
    if (status === 404) return 'No se encontró el repositorio, la rama o el archivo (404). Revisa usuario, repositorio y rama.';
    if (status === 409) return 'El repositorio está vacío o en conflicto (409).';
    if (status === 422) return 'GitHub rechazó el cambio (422): ' + msg;
    return `GitHub respondió ${status}${msg ? ': ' + msg : ''}`;
  }

  /* ---------- Carga ---------- */
  async function textoDesdeSitio(archivo) {
    const r = await fetch(archivo + '?v=' + Date.now(), { cache: 'no-store' });
    if (r.status === 404) return null;
    if (!r.ok) throw new Error(archivo + ' respondió ' + r.status);
    return r.text();
  }
  async function textoDesdeGH(archivo) {
    try { return await gh(`/contents/${rutaRepo(archivo).split('/').map(encodeURIComponent).join('/')}?ref=${encodeURIComponent(cfg().branch)}`, { raw: true }); }
    catch (e) { if (e.status === 404) return null; throw e; }
  }
  async function cargar(desdeGH) {
    const leer = desdeGH ? textoDesdeGH : textoDesdeSitio;
    const [tp, tpr] = await Promise.all([leer(TIENDA.archivoProductos), leer(TIENDA.archivoPromociones)]);
    if (tp == null) throw new Error('No existe ' + TIENDA.archivoProductos);
    const { productos, reparados } = VJ.normalizarInventario(JSON.parse(tp));
    inv = productos;
    promos = tpr ? VJ.normalizarPromociones(JSON.parse(tpr)) : [];
    reindexar();
    shaBase.prod = await VJ.shaGitBlob(tp);
    shaBase.promo = tpr ? await VJ.shaGitBlob(tpr) : null;
    snap.prod = serializarProductos(inv);
    snap.promo = serializarPromos(promos);
    refsBase = refsImagenes();
    nuevos.clear(); editados.clear(); seleccion.clear();
    origen = desdeGH ? 'github' : 'sitio';
    if (reparados.length) aviso(`Se repararon ${reparados.length} ID duplicados o faltantes. Publica para guardar la corrección.`, 6000);
  }

  /* ---------- Cambios sin publicar ---------- */
  function estadoCambios() {
    const prod = serializarProductos(inv) !== snap.prod;
    const promo = serializarPromos(promos) !== snap.promo;
    const fotos = [...pendientes.keys()].filter(r => refsImagenes().has(r)).length;
    return { prod, promo, fotos, sucio: prod || promo || fotos > 0 };
  }
  const marcarCambios = VJ.debounce(() => {
    const e = estadoCambios();
    const el = $('#estadoCambios');
    const partes = [];
    if (e.prod) partes.push('productos');
    if (e.promo) partes.push('promociones');
    if (e.fotos) partes.push(`${e.fotos} foto${e.fotos === 1 ? '' : 's'}`);
    el.textContent = e.sucio ? 'Sin publicar: ' + partes.join(', ') : (origen === 'github' ? 'Al día con GitHub' : 'Sin cambios');
    el.classList.toggle('sucio', e.sucio);
    $('#btnDeshacer').hidden = !e.sucio;
    guardarBorrador(e.sucio);
  }, 120);

  // Borrador local para no perder trabajo si se cierra la pestaña
  function guardarBorrador(sucio) {
    try {
      if (!sucio) { local.removeItem(claveBorrador()); return; }
      const limpiar = u => pendientes.has(u) ? '' : u;
      local.setItem(claveBorrador(), JSON.stringify({
        fecha: Date.now(), base: shaBase,
        productos: inv.map(p => ({ ...p, imagen: limpiar(p.imagen), galeria: p.galeria.filter(g => !pendientes.has(g)) })),
        promociones: promos.map(p => ({ ...p, imagen: limpiar(p.imagen), imagenMovil: limpiar(p.imagenMovil) })),
        fotosPerdidas: pendientes.size
      }));
    } catch (e) { /* cuota llena: se ignora */ }
  }
  function ofrecerBorrador() {
    let b = null; try { b = JSON.parse(local.getItem(claveBorrador()) || 'null'); } catch (e) {}
    if (!b) return;
    const caja = $('#avisoBorrador');
    const mismaBase = b.base && b.base.prod === shaBase.prod;
    caja.innerHTML = `<span>Tienes cambios sin publicar del ${esc(new Date(b.fecha).toLocaleString('es-VE'))}.${mismaBase ? '' : ' <strong>Ojo: los datos publicados cambiaron desde entonces.</strong>'}${b.fotosPerdidas ? ' Las fotos nuevas de ese borrador deben volver a subirse.' : ''}</span>
      <button class="btn btn-mini btn-azul" id="recuperarBorrador">Recuperar</button><button class="btn btn-mini" id="descartarBorrador">Descartar</button>`;
    caja.hidden = false;
    $('#recuperarBorrador').onclick = () => {
      inv = VJ.normalizarInventario(b.productos).productos; promos = VJ.normalizarPromociones(b.promociones);
      reindexar(); caja.hidden = true; renderTodo(); marcarCambios(); aviso('Borrador recuperado. Revisa y publica.');
    };
    $('#descartarBorrador').onclick = () => { local.removeItem(claveBorrador()); caja.hidden = true; };
  }

  /* ---------- Avisos ---------- */
  let tAviso;
  function aviso(t, ms = 3200) { const a = $('#avisoFlotante'); a.textContent = t; a.classList.add('visible'); clearTimeout(tAviso); tAviso = setTimeout(() => a.classList.remove('visible'), ms); }

  /* ---------- Hojas ---------- */
  function abrirHoja(sel) {
    $$('.hoja.abierta').forEach(h => h.classList.remove('abierta'));
    $(sel).classList.add('abierta'); $('#velo').classList.add('abierto'); document.body.style.overflow = 'hidden';
  }
  function cerrarHojas() {
    $$('.hoja.abierta').forEach(h => h.classList.remove('abierta')); $('#velo').classList.remove('abierto'); document.body.style.overflow = '';
    edicion = null; edicionPromo = null;
  }

  /* =======================================================================
     IMÁGENES: optimización en el navegador
     ======================================================================= */
  async function cargarBitmap(file) {
    try { return await createImageBitmap(file, { imageOrientation: 'from-image' }); }
    catch (e) {
      const url = URL.createObjectURL(file);
      try { const img = new Image(); img.src = url; await img.decode(); return img; }
      finally { setTimeout(() => URL.revokeObjectURL(url), 1000); }
    }
  }
  async function optimizarImagen(file, maxAncho, maxAlto, fondoBlanco) {
    if (!/^image\//.test(file.type)) throw new Error('El archivo no es una imagen');
    const bmp = await cargarBitmap(file);
    const w0 = bmp.width, h0 = bmp.height;
    const escala = Math.min(1, maxAncho / w0, maxAlto / h0);
    const w = Math.max(1, Math.round(w0 * escala)), h = Math.max(1, Math.round(h0 * escala));
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const ctx = c.getContext('2d');
    if (fondoBlanco) { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h); }
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bmp, 0, 0, w, h);
    if (bmp.close) bmp.close();
    let blob = await new Promise(r => c.toBlob(r, 'image/webp', 0.82));
    let ext = 'webp';
    if (!blob || blob.type !== 'image/webp') {
      if (!fondoBlanco) { const c2 = document.createElement('canvas'); c2.width = w; c2.height = h; const x = c2.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, w, h); x.drawImage(c, 0, 0); blob = await new Promise(r => c2.toBlob(r, 'image/jpeg', 0.85)); }
      else blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.85));
      ext = 'jpg';
    }
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const digest = await crypto.subtle.digest('SHA-1', bytes);
    const huella = [...new Uint8Array(digest)].slice(0, 5).map(b => b.toString(16).padStart(2, '0')).join('');
    return { blob, ext, huella, ancho: w, alto: h };
  }
  // Devuelve la ruta (pendiente de publicar) de una foto de producto
  async function prepararFotoProducto(id, file) {
    const r = await optimizarImagen(file, 900, 900, true);
    const ruta = `${TIENDA.carpetaImgProductos}/${id}-${r.huella}.${r.ext}`;
    if (!pendientes.has(ruta)) pendientes.set(ruta, { blob: r.blob, url: URL.createObjectURL(r.blob) });
    return ruta;
  }
  async function prepararFotoPromo(promoId, file, movil) {
    const r = movil ? await optimizarImagen(file, 1080, 1080, true) : await optimizarImagen(file, 1920, 700, true);
    const ruta = `${TIENDA.carpetaImgPromos}/${promoId}${movil ? '-movil' : ''}-${r.huella}.${r.ext}`;
    if (!pendientes.has(ruta)) pendientes.set(ruta, { blob: r.blob, url: URL.createObjectURL(r.blob) });
    return ruta;
  }

  /* =======================================================================
     PRODUCTOS: tabla
     ======================================================================= */
  const ICONOS = {
    foto: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="11" r="2"/><path d="m21 16-5-5-8 8"/></svg>',
    editar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>',
    borrar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/></svg>'
  };

  function problemas(p) {
    const lista = [];
    if (!(p.precio > 0)) lista.push('precio en 0');
    if (p.codigo && codigosDuplicados().has(VJ.claveCodigo(p.codigo))) lista.push('código repetido');
    if (firmasDuplicadas().has(VJ.firmaProducto(p))) lista.push('nombre y marca repetidos');
    if (p.descuento >= 70) lista.push('descuento muy alto');
    return lista;
  }
  let _cacheCod = null, _cacheFirma = null;
  function invalidarCaches() { _cacheCod = null; _cacheFirma = null; }
  function codigosDuplicados() {
    if (_cacheCod) return _cacheCod;
    const vistos = new Map(); for (const p of inv) if (p.codigo) { const k = VJ.claveCodigo(p.codigo); vistos.set(k, (vistos.get(k) || 0) + 1); }
    return (_cacheCod = new Set([...vistos].filter(([, n]) => n > 1).map(([k]) => k)));
  }
  function firmasDuplicadas() {
    if (_cacheFirma) return _cacheFirma;
    const vistos = new Map(); for (const p of inv) { const k = VJ.firmaProducto(p); vistos.set(k, (vistos.get(k) || 0) + 1); }
    return (_cacheFirma = new Set([...vistos].filter(([, n]) => n > 1).map(([k]) => k)));
  }

  function filtrarAdmin() {
    const terms = VJ.terminosBusqueda(vista.q);
    const r = vista.rapido;
    let lista = inv.filter(p => {
      if (terms.length) {
        const t = VJ.normTexto(`${p.id} ${p.codigo} ${p.producto} ${p.marca} ${p.modulo}`);
        if (!terms.every(w => t.includes(w))) return false;
      }
      if (vista.cat && p.categoria !== vista.cat) return false;
      if (vista.marca && p.marca !== vista.marca) return false;
      if (vista.modulo && p.modulo !== vista.modulo) return false;
      if (r === 'sin-imagen' && p.imagen) return false;
      if (r === 'con-descuento' && !(VJ.precioFinal(p, idxPromos).descuento > 0)) return false;
      if (r === 'stock-bajo' && !(p.stock > 0 && p.stock < TIENDA.stockBajo)) return false;
      if (r === 'agotados' && p.stock > 0) return false;
      if (r === 'destacados' && !p.destacado) return false;
      if (r === 'sin-codigo' && p.codigo) return false;
      if (r === 'precio-cero' && p.precio > 0) return false;
      if (r === 'problemas' && !problemas(p).length) return false;
      return true;
    });
    const [campo, dir] = vista.orden.split('-');
    const s = dir === 'desc' ? -1 : 1;
    lista.sort((a, b) => {
      let va = a[campo], vb = b[campo];
      if (campo === 'descuento') { va = VJ.precioFinal(a, idxPromos).descuento; vb = VJ.precioFinal(b, idxPromos).descuento; }
      if (typeof va === 'string') return s * va.localeCompare(vb, 'es') || a.id - b.id;
      return s * (va - vb) || a.producto.localeCompare(b.producto, 'es');
    });
    return lista;
  }

  function opcionesCategoria(sel) { return CATEGORIAS.map(c => `<option value="${c.id}" ${c.id === sel ? 'selected' : ''}>${esc(c.nombre)}</option>`).join(''); }

  function filaHTML(p) {
    const pr = VJ.precioFinal(p, idxPromos);
    const probs = problemas(p);
    const codDup = p.codigo && codigosDuplicados().has(VJ.claveCodigo(p.codigo));
    const src = srcVista(p.imagen);
    const clases = ['fila'];
    if (p.stock < TIENDA.stockBajo) clases.push('bajo');
    if (seleccion.has(p.id)) clases.push('sel');
    if (nuevos.has(p.id)) clases.push('nuevo'); else if (editados.has(p.id)) clases.push('editado');
    return `<div class="${clases.join(' ')}" role="row" data-id="${p.id}">
      <span class="c-sel"><input type="checkbox" data-sel ${seleccion.has(p.id) ? 'checked' : ''} aria-label="Seleccionar ${esc(p.producto)}"></span>
      <span class="c-img"><span class="thumb ${src ? 'tiene' : ''}" title="Las fotos las carga la fase Visuales">${src ? `<img src="${esc(src)}" alt="" loading="lazy">` : ICONOS.foto}</span></span>
      <span class="c-cod" data-etq="Código"><input type="text" data-campo="codigo" value="${esc(p.codigo)}" placeholder="—" class="${codDup ? 'error' : ''}" title="${codDup ? 'Este código está repetido en otro producto' : ''}" autocapitalize="characters" spellcheck="false"><small>ID ${p.id}</small></span>
      <span class="c-nom" data-etq="Producto"><input type="text" data-campo="producto" value="${esc(p.producto)}">${probs.length ? `<small class="marca-problema">⚠ ${esc(probs.join(' · '))}</small>` : ''}</span>
      <span class="c-mar" data-etq="Marca"><input type="text" data-campo="marca" value="${esc(p.marca)}" list="listaMarcas"></span>
      <span class="c-cat" data-etq="Categoría"><select data-campo="categoria">${opcionesCategoria(p.categoria)}</select></span>
      <span class="c-pre num" data-etq="Precio $"><input type="text" class="num ${p.precio > 0 ? '' : 'error'}" data-campo="precio" value="${p.precio.toFixed(2)}" inputmode="decimal"></span>
      <span class="c-des num" data-etq="Desc. %"><input type="text" class="num" data-campo="descuento" value="${p.descuento || ''}" placeholder="0" inputmode="decimal"></span>
      <span class="c-fin ${pr.descuento ? 'desc' : ''}" data-etq="Final">${dinero(pr.final)}${pr.fuente === 'promo' ? `<small>promo -${pr.descuento}%</small>` : (pr.descuento ? `<small>-${pr.descuento}%</small>` : '')}</span>
      <span class="c-sto num" data-etq="Stock"><input type="text" class="num" data-campo="stock" value="${p.stock}" inputmode="numeric"></span>
      <span class="c-dst" data-etq="Destacado"><input type="checkbox" data-campo="destacado" ${p.destacado ? 'checked' : ''} aria-label="Destacado"></span>
      <span class="c-acc"><button class="icono" data-editar title="Editar detalle y fotos" aria-label="Editar">${ICONOS.editar}</button><button class="icono borrar" data-borrar title="Eliminar" aria-label="Eliminar">${ICONOS.borrar}</button></span>
    </div>`;
  }

  function renderKPIs() {
    const sinImg = inv.filter(p => !p.imagen).length;
    const conDesc = inv.filter(p => VJ.precioFinal(p, idxPromos).descuento > 0).length;
    const bajo = inv.filter(p => p.stock > 0 && p.stock < TIENDA.stockBajo).length;
    const agot = inv.filter(p => p.stock <= 0).length;
    const prob = inv.filter(p => problemas(p).length).length;
    const k = [['', inv.length, 'Productos'], ['sin-imagen', sinImg, 'Sin foto'], ['con-descuento', conDesc, 'Con descuento'], ['stock-bajo', bajo, 'Stock bajo'], ['agotados', agot, 'Agotados'], ['problemas', prob, 'Con problemas']];
    $('#kpis').innerHTML = k.map(([f, n, t]) => `<button class="kpi ${f === 'problemas' && n ? 'alerta' : ''}" data-rapido="${f}" aria-pressed="${vista.rapido === f}"><b>${n.toLocaleString('es-VE')}</b><span>${t}</span></button>`).join('');
  }
  function renderSelectsFiltro() {
    const marcas = [...new Set(inv.map(p => p.marca))].sort((a, b) => a.localeCompare(b, 'es'));
    const modulos = [...new Set(inv.map(p => p.modulo).filter(Boolean))].sort();
    $('#fCategoria').innerHTML = '<option value="">Todas las categorías</option>' + CATEGORIAS.map(c => `<option value="${c.id}">${esc(c.nombre)}</option>`).join('');
    $('#fMarca').innerHTML = '<option value="">Todas las marcas</option>' + marcas.map(m => `<option value="${esc(m)}">${esc(m || '(sin marca)')}</option>`).join('');
    $('#fModulo').innerHTML = '<option value="">Todos los módulos</option>' + modulos.map(m => `<option value="${esc(m)}">${esc(m)}</option>`).join('');
    $('#fCategoria').value = vista.cat; $('#fMarca').value = vista.marca; $('#fModulo').value = vista.modulo;
    let dl = $('#listaMarcas'); if (!dl) { dl = document.createElement('datalist'); dl.id = 'listaMarcas'; document.body.appendChild(dl); }
    dl.innerHTML = marcas.map(m => `<option value="${esc(m)}">`).join('');
    $('#loteCat').innerHTML = opcionesCategoria('');
    $('#ffCategoria').innerHTML = '<option value="">Todas las categorías</option>' + CATEGORIAS.map(c => `<option value="${c.id}">${esc(c.nombre)}</option>`).join(''); $('#ffCategoria').value = vistaF.cat;
    $('#lotePromo').innerHTML = promos.length ? promos.map(p => `<option value="${esc(p.id)}">${esc(p.titulo || p.id)}</option>`).join('') : '<option value="">(sin promociones)</option>';
  }
  function renderTabla() {
    const lista = filtrarAdmin();
    const paginas = Math.max(1, Math.ceil(lista.length / POR_PAGINA));
    vista.pag = Math.min(vista.pag, paginas);
    const ini = (vista.pag - 1) * POR_PAGINA;
    const pagina = lista.slice(ini, ini + POR_PAGINA);
    $('#filasProductos').innerHTML = pagina.length ? pagina.map(filaHTML).join('') : '<div class="vacio-adm" style="margin:12px">No hay productos con estos filtros.</div>';
    $('#infoTabla').textContent = lista.length ? `${ini + 1}–${ini + pagina.length} de ${lista.length.toLocaleString('es-VE')} (${inv.length.toLocaleString('es-VE')} en total)` : '';
    $('#selTodos').checked = pagina.length > 0 && pagina.every(p => seleccion.has(p.id));
    const nav = $('#pagProductos');
    if (paginas <= 1) nav.innerHTML = '';
    else {
      const p = vista.pag, nums = [...new Set([1, p - 1, p, p + 1, paginas])].filter(n => n >= 1 && n <= paginas).sort((a, b) => a - b);
      let h = `<button data-pagp="${p - 1}" ${p <= 1 ? 'disabled' : ''}>‹</button>`, prev = 0;
      for (const n of nums) { if (n - prev > 1) h += '<span class="puntos">…</span>'; h += `<button data-pagp="${n}" ${n === p ? 'aria-current="page"' : ''}>${n}</button>`; prev = n; }
      nav.innerHTML = h + `<button data-pagp="${p + 1}" ${p >= paginas ? 'disabled' : ''}>›</button>`;
    }
    renderLote();
  }
  function renderLote() {
    const b = $('#barraLote'); b.hidden = !seleccion.size;
    $('#numSel').textContent = `${seleccion.size} seleccionado${seleccion.size === 1 ? '' : 's'}`;
  }
  function renderTodo() { invalidarCaches(); renderKPIs(); renderSelectsFiltro(); renderTabla(); renderPromos(); renderFotos(); renderBanners(); }
  function refrescarFila(id) {
    const el = $(`#filasProductos .fila[data-id="${id}"]`); const p = porId.get(id);
    if (el && p) { const tmp = document.createElement('div'); tmp.innerHTML = filaHTML(p); el.replaceWith(tmp.firstElementChild); }
  }

  // Edición en línea: el valor se aplica al producto cuyo ID está en la fila.
  function aplicarCampo(id, campo, valor, input) {
    const p = porId.get(id); if (!p) return;
    let ok = true;
    switch (campo) {
      case 'producto': {
        const v = String(valor).replace(/\s+/g, ' ').trim();
        if (!v) { ok = false; aviso('El nombre del producto no puede quedar vacío.'); input.value = p.producto; break; }
        p.producto = v; break;
      }
      case 'marca': p.marca = String(valor).replace(/\s+/g, ' ').trim(); break;
      case 'codigo': p.codigo = String(valor).trim(); break;
      case 'categoria': p.categoria = valor; break;
      case 'precio': {
        const n = VJ.parseNumero(valor);
        if (isNaN(n) || n < 0) { ok = false; aviso('Precio no válido. Usa números, por ejemplo 2,50 o 2.50'); input.value = p.precio.toFixed(2); break; }
        if (p.precio > 0 && (n > p.precio * 5 || n < p.precio / 5) && !confirm(`El precio de “${p.producto}” cambia de ${dinero(p.precio)} a ${dinero(n)}. ¿Es correcto?`)) { input.value = p.precio.toFixed(2); ok = false; break; }
        p.precio = Math.round(n * 100) / 100; break;
      }
      case 'descuento': {
        const n = valor === '' ? 0 : VJ.parsePorcentaje(valor);
        if (isNaN(n) || n < 0 || n > 90) { ok = false; aviso('El descuento debe estar entre 0 y 90 %.'); input.value = p.descuento || ''; break; }
        p.descuento = VJ.limitarDescuento(n); break;
      }
      case 'stock': {
        const n = VJ.parseNumero(valor);
        if (isNaN(n) || n < 0) { ok = false; aviso('Cantidad no válida.'); input.value = p.stock; break; }
        p.stock = Math.floor(n); break;
      }
      case 'destacado': p.destacado = !!valor; break;
    }
    if (ok) {
      if (!nuevos.has(id)) editados.add(id);
      invalidarCaches();
      if (campo === 'codigo' || campo === 'producto' || campo === 'marca') {
        // los duplicados pueden afectar a otras filas visibles
        $$('#filasProductos .fila[data-id]').forEach(f => refrescarFila(Number(f.dataset.id)));
      } else refrescarFila(id);
      renderKPIs(); marcarCambios();
    }
  }

  /* ---------- Editor de producto ---------- */
  let edicion = null; // copia de trabajo { ...producto, esNuevo }
  function abrirEditor(id) {
    const p = id ? porId.get(id) : null;
    edicion = p ? JSON.parse(JSON.stringify(p)) : { ...VJ.normalizarProducto({ producto: ' ' }), id: siguienteId(), producto: '', esNuevo: true };
    if (p) edicion.esNuevo = false;
    $('#tProducto').textContent = edicion.esNuevo ? 'Nuevo producto' : 'Editar producto';
    renderEditor();
    abrirHoja('#hojaProducto');
    setTimeout(() => { const f = $('#formProducto [data-ed="producto"]'); f && f.focus(); }, 80);
  }
  function renderEditor() {
    const e = edicion;
    const fotos = [e.imagen, ...e.galeria].filter(Boolean);
    if (ROL === 'visuales') {
      $('#formProducto').innerHTML = `
      <div class="ficha-ro"><strong>${esc(e.producto)}</strong><span>${esc(e.marca)} · ${esc(nombreCategoria(e.categoria))} · ID ${e.id}${e.codigo ? ' · Cód. ' + esc(e.codigo) : ''}</span></div>
      <div class="campo"><span>Fotos (la primera es la principal, máximo 9)</span></div>
      <div class="fotos-editor">
        ${fotos.map((f, i) => `<div class="foto-ed"><img src="${esc(srcVista(f))}" alt="">${i === 0 ? '<span class="principal">Principal</span>' : `<button class="hacer" data-hacer-principal="${i}">Hacer principal</button>`}<button class="quitar" data-quitar-foto="${i}" aria-label="Quitar foto">×</button></div>`).join('')}
      </div>
      <label class="soltar-zona" id="zonaFotos">Arrastra fotos aquí o toca para elegir (puedes elegir varias)<input type="file" accept="image/*" multiple hidden id="inputFotosEd"></label>
      <div class="fila-form"><input type="url" id="urlFotoEd" placeholder="…o pega la URL https de una foto" style="flex:1;height:40px;border:1px solid var(--linea);border-radius:9px;padding:0 10px"><button class="btn btn-mini" id="agregarUrlFoto">Agregar URL</button></div>
      <p class="nota">Las fotos se optimizan automáticamente (máx. 900 px, WebP) y se suben al publicar.</p>`;
      return;
    }
    $('#formProducto').innerHTML = `
      <label class="campo"><span>Nombre del producto *</span><input data-ed="producto" value="${esc(e.producto)}" required></label>
      <div class="dos">
        <label class="campo"><span>Código</span><input data-ed="codigo" value="${esc(e.codigo)}" autocapitalize="characters" spellcheck="false"><span class="ayuda" id="ayudaCodigo">Opcional. Debe ser único.</span></label>
        <label class="campo"><span>Marca</span><input data-ed="marca" value="${esc(e.marca)}" list="listaMarcas"></label>
      </div>
      <div class="dos">
        <label class="campo"><span>Categoría</span><select data-ed="categoria">${opcionesCategoria(e.categoria)}</select></label>
        <label class="campo"><span>Módulo / almacén</span><input data-ed="modulo" value="${esc(e.modulo)}"></label>
      </div>
      <div class="tres">
        <label class="campo"><span>Precio (USD) *</span><input data-ed="precio" value="${e.precio ? e.precio.toFixed(2) : ''}" inputmode="decimal" placeholder="0.00"></label>
        <label class="campo"><span>Descuento %</span><input data-ed="descuento" value="${e.descuento || ''}" inputmode="decimal" placeholder="0"></label>
        <label class="campo"><span>Stock</span><input data-ed="stock" value="${e.stock}" inputmode="numeric"></label>
      </div>
      <div class="campo"><span>Precio final</span><strong id="edFinal"></strong></div>
      <label class="opcion"><input type="checkbox" data-ed="destacado" ${e.destacado ? 'checked' : ''}><span>Mostrar como destacado</span></label>
      <label class="campo" style="margin-top:10px"><span>Descripción</span><textarea data-ed="descripcion" rows="4" placeholder="Presentación, sabor, uso…">${esc(e.descripcion)}</textarea></label>
      <div class="campo"><span>Fotos</span><span class="ayuda">Las fotos las carga la fase Visuales.</span></div>
      ${fotos.length ? `<div class="fotos-editor">${fotos.map(f => `<div class="foto-ed"><img src="${esc(srcVista(f))}" alt=""></div>`).join('')}</div>` : '<p class="nota">Este producto aún no tiene foto.</p>'}
      ${e.esNuevo ? '' : `<p class="nota">ID interno: ${e.id} (no cambia nunca; así el catálogo y los pedidos no se cruzan).</p>`}`;
    actualizarFinalEditor();
  }
  function leerEditor() {
    const f = $('#formProducto');
    const val = k => f.querySelector(`[data-ed="${k}"]`);
    if (!val('producto')) return; // modo Visuales: solo fotos
    edicion.producto = val('producto').value.replace(/\s+/g, ' ').trim();
    edicion.codigo = val('codigo').value.trim();
    edicion.marca = val('marca').value.replace(/\s+/g, ' ').trim();
    edicion.categoria = val('categoria').value;
    edicion.modulo = val('modulo').value.trim();
    edicion.precio = VJ.parseNumero(val('precio').value);
    const d = val('descuento').value.trim(); edicion.descuento = d ? VJ.parsePorcentaje(d) : 0;
    edicion.stock = VJ.parseNumero(val('stock').value || '0');
    edicion.destacado = val('destacado').checked;
    edicion.descripcion = val('descripcion').value.trim();
  }
  function actualizarFinalEditor() {
    const f = $('#formProducto'); if (!f.querySelector('[data-ed]')) return;
    const precio = VJ.parseNumero(f.querySelector('[data-ed="precio"]').value);
    const d = VJ.parsePorcentaje(f.querySelector('[data-ed="descuento"]').value || '0');
    const pr = VJ.precioFinal({ id: edicion.id, precio: isNaN(precio) ? 0 : precio, descuento: isNaN(d) ? 0 : d }, idxPromos);
    $('#edFinal').innerHTML = isNaN(precio) ? '—' : `${dinero(pr.final)}${pr.descuento ? ` <small style="color:var(--rojo-700)">(-${pr.descuento}%${pr.fuente === 'promo' ? ' por promoción' : ''})</small>` : ''}`;
    const cod = f.querySelector('[data-ed="codigo"]').value.trim();
    const dup = cod && inv.some(p => p.id !== edicion.id && VJ.claveCodigo(p.codigo) === VJ.claveCodigo(cod));
    const ay = $('#ayudaCodigo'); ay.textContent = dup ? 'Ese código ya lo usa otro producto.' : 'Opcional. Debe ser único.'; ay.classList.toggle('error', !!dup);
    f.querySelector('[data-ed="codigo"]').classList.toggle('error', !!dup);
  }
  function guardarEditor() {
    if (ROL === 'visuales') {
      const p = porId.get(edicion.id); if (!p) return;
      p.imagen = edicion.imagen || ''; p.galeria = edicion.galeria.filter(Boolean).slice(0, 8);
      editados.add(p.id); cerrarHojas(); renderTodo(); marcarCambios(); aviso('Fotos actualizadas. Se subirán al publicar.');
      return;
    }
    leerEditor();
    const e = edicion;
    if (!e.producto) { aviso('Escribe el nombre del producto.'); return; }
    if (isNaN(e.precio) || e.precio < 0) { aviso('Escribe un precio válido.'); return; }
    if (isNaN(e.descuento) || e.descuento < 0 || e.descuento > 90) { aviso('El descuento debe estar entre 0 y 90 %.'); return; }
    if (isNaN(e.stock) || e.stock < 0) { aviso('El stock debe ser un número.'); return; }
    if (e.codigo && inv.some(p => p.id !== e.id && VJ.claveCodigo(p.codigo) === VJ.claveCodigo(e.codigo))) { aviso('Ese código ya lo usa otro producto.'); return; }
    const firma = VJ.firmaProducto(e);
    const gemelo = inv.find(p => p.id !== e.id && VJ.firmaProducto(p) === firma);
    if (gemelo && !confirm(`Ya existe “${gemelo.producto}” de la marca ${gemelo.marca || '(sin marca)'} (ID ${gemelo.id}). ¿Guardar de todos modos?`)) return;
    const limpio = VJ.normalizarProducto(e); limpio.id = e.id;
    if (e.esNuevo) {
      if (porId.has(limpio.id)) limpio.id = siguienteId();
      inv.unshift(limpio); nuevos.add(limpio.id);
    } else {
      const i = inv.findIndex(p => p.id === e.id); if (i < 0) return;
      inv[i] = limpio; editados.add(limpio.id);
    }
    reindexar(); cerrarHojas(); renderTodo(); marcarCambios();
    aviso(e.esNuevo ? 'Producto agregado.' : 'Producto actualizado.');
  }
  async function agregarFotosEditor(files) {
    const lista = [...files].filter(f => /^image\//.test(f.type));
    if (!lista.length) return;
    leerEditor();
    aviso(`Optimizando ${lista.length} foto${lista.length === 1 ? '' : 's'}…`);
    for (const f of lista) {
      try {
        const ruta = await prepararFotoProducto(edicion.id, f);
        if (!edicion.imagen) edicion.imagen = ruta; else if (!edicion.galeria.includes(ruta) && edicion.imagen !== ruta) edicion.galeria.push(ruta);
      } catch (err) { aviso('No se pudo procesar ' + f.name + ': ' + err.message); }
    }
    edicion.galeria = edicion.galeria.slice(0, 8);
    renderEditor();
  }

  /* ---------- Foto rápida desde la tabla ---------- */
  let fotoRapidaId = null;
  async function asignarFotoRapida(id, file) {
    const p = porId.get(id); if (!p || !file) return;
    try {
      const ruta = await prepararFotoProducto(id, file);
      p.imagen = ruta; // reemplaza la principal; la galería se gestiona con “Galería”
      if (!nuevos.has(id)) editados.add(id);
      renderFotos(); marcarCambios();
      aviso('Foto lista. Se subirá al publicar.');
    } catch (e) { aviso('No se pudo procesar la foto: ' + e.message); }
  }

  /* ---------- Acciones en lote ---------- */
  function accionLote(a) {
    const ids = [...seleccion].filter(id => porId.has(id));
    if (!ids.length) return;
    if (a === 'limpiar') { seleccion.clear(); renderTabla(); return; }
    if (a === 'descuento') {
      const n = VJ.parsePorcentaje($('#loteDesc').value || '0');
      if (isNaN(n) || n < 0 || n > 90) { aviso('Escribe un descuento entre 0 y 90.'); return; }
      ids.forEach(id => { porId.get(id).descuento = VJ.limitarDescuento(n); editados.add(id); });
      aviso(`Descuento de ${n}% aplicado a ${ids.length} productos.`);
    }
    if (a === 'categoria') { const c = $('#loteCat').value; ids.forEach(id => { porId.get(id).categoria = c; editados.add(id); }); aviso(`Categoría cambiada en ${ids.length} productos.`); }
    if (a === 'destacar' || a === 'no-destacar') ids.forEach(id => { porId.get(id).destacado = a === 'destacar'; editados.add(id); });
    if (a === 'promo') {
      const pr = promos.find(p => p.id === $('#lotePromo').value);
      if (!pr) { aviso('Primero crea una promoción en la pestaña Promociones del mes.'); return; }
      pr.productos = [...new Set([...pr.productos, ...ids])];
      reindexar(); aviso(`${ids.length} productos añadidos a “${pr.titulo || pr.id}”.`);
    }
    if (a === 'eliminar') {
      if (!confirm(`¿Eliminar ${ids.length} producto${ids.length === 1 ? '' : 's'}? Se quitarán también de las promociones.`)) return;
      const set = new Set(ids);
      inv = inv.filter(p => !set.has(p.id));
      promos.forEach(pr => { pr.productos = pr.productos.filter(id => !set.has(id)); });
      seleccion.clear(); reindexar();
    }
    renderTodo(); marcarCambios();
  }

  /* =======================================================================
     PROMOCIONES
     ======================================================================= */
  const ETQ_ESTADO = { activa: 'Activa', programada: 'Programada', vencida: 'Vencida', inactiva: 'Desactivada' };
  function fechaLarga(iso) { if (!iso) return '—'; const [y, m, d] = iso.split('-').map(Number); return new Date(y, m - 1, d).toLocaleDateString('es-VE', { day: 'numeric', month: 'short', year: 'numeric' }); }
  function renderPromos() {
    const cont = $('#listaPromos'); if (!cont) return;
    if (!promos.length) { cont.innerHTML = '<div class="vacio-adm">Aún no hay promociones. Crea la del mes con el botón de arriba.</div>'; return; }
    const orden = { activa: 0, programada: 1, inactiva: 2, vencida: 3 };
    const lista = [...promos].sort((a, b) => orden[VJ.estadoPromo(a)] - orden[VJ.estadoPromo(b)] || (b.desde || '').localeCompare(a.desde || ''));
    cont.innerHTML = lista.map(p => {
      const est = VJ.estadoPromo(p);
      const n = p.productos.filter(id => porId.has(id)).length;
      const img = srcVista(p.imagen);
      return `<article class="promo-card" data-promo-id="${esc(p.id)}">
        <div class="portada ${p.color}">${img ? `<img src="${esc(img)}" alt="">` : `<strong>${esc(p.etiqueta || (p.descuento ? '-' + p.descuento + '%' : ''))} ${esc(p.titulo)}</strong>`}</div>
        <div class="info">
          <h3>${esc(p.titulo || '(sin título)')}</h3>
          <div><span class="estado ${est}">${ETQ_ESTADO[est]}</span></div>
          <div>${fechaLarga(p.desde)} → ${fechaLarga(p.hasta)}</div>
          <div>${n} producto${n === 1 ? '' : 's'}${p.descuento ? ` · ${p.descuento}% de descuento` : ' · sin descuento automático'}</div>
        </div>
        <div class="acciones-promo">
          <button class="btn btn-mini btn-azul" data-pr="editar">Editar</button>
          <button class="btn btn-mini" data-pr="activar">${p.activo ? 'Desactivar' : 'Activar'}</button>
          <button class="btn btn-mini" data-pr="duplicar">Duplicar</button>
          <button class="btn btn-mini" data-pr="ver">Ver productos</button>
          <button class="btn btn-mini btn-peligro" data-pr="borrar">Eliminar</button>
        </div>
      </article>`;
    }).join('');
  }
  function mesActual(offset = 0) {
    const d = new Date(); const ini = new Date(d.getFullYear(), d.getMonth() + offset, 1); const fin = new Date(d.getFullYear(), d.getMonth() + offset + 1, 0);
    return { desde: VJ.hoyISO(ini), hasta: VJ.hoyISO(fin), nombre: ini.toLocaleDateString('es-VE', { month: 'long' }) };
  }
  const slug = t => VJ.normTexto(t).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30);
  function idPromoUnico(base) { let id = slug(base) || 'promo', n = 2; const b = id; while (promos.some(p => p.id === id)) id = b + '-' + (n++); return id; }

  let edicionPromo = null;
  function abrirPromo(id, plantilla) {
    const p = id ? promos.find(x => x.id === id) : null;
    edicionPromo = p ? JSON.parse(JSON.stringify(p)) : Object.assign(VJ.normalizarPromociones([{ id: 'nueva' }])[0], { id: '', activo: true }, plantilla || {});
    edicionPromo.esNueva = !p;
    $('#tPromo').textContent = p ? 'Editar promoción' : 'Nueva promoción';
    renderEditorPromo();
    abrirHoja('#hojaPromo');
  }
  function renderEditorPromo() {
    const e = edicionPromo;
    const elegidos = e.productos.map(id => porId.get(id)).filter(Boolean);
    $('#formPromo').innerHTML = `
      <label class="campo"><span>Título *</span><input data-ep="titulo" value="${esc(e.titulo)}" placeholder="Ej.: Semana de la despensa"></label>
      <label class="campo"><span>Descripción corta</span><input data-ep="descripcion" value="${esc(e.descripcion)}" placeholder="Ej.: Aceites, harinas y granos con precios especiales"></label>
      <div class="tres">
        <label class="campo"><span>Desde</span><input type="date" data-ep="desde" value="${esc(e.desde)}"></label>
        <label class="campo"><span>Hasta</span><input type="date" data-ep="hasta" value="${esc(e.hasta)}"></label>
        <label class="campo"><span>Descuento % (opcional)</span><input data-ep="descuento" value="${e.descuento || ''}" inputmode="decimal" placeholder="0"><span class="ayuda">Se aplica a los productos elegidos.</span></label>
      </div>
      <div class="tres">
        <label class="campo"><span>Texto grande del banner</span><input data-ep="etiqueta" value="${esc(e.etiqueta)}" maxlength="24" placeholder="-20%, 2x1, Nuevo…"></label>
        <label class="campo"><span>Color del banner</span><select data-ep="color"><option value="azul" ${e.color === 'azul' ? 'selected' : ''}>Azul</option><option value="rojo" ${e.color === 'rojo' ? 'selected' : ''}>Rojo</option></select></label>
        <label class="opcion" style="align-self:end;margin-bottom:12px"><input type="checkbox" data-ep="activo" ${e.activo ? 'checked' : ''}><span>Activa</span></label>
      </div>
      <div class="campo"><span>Imagen del banner</span><span class="ayuda">La sube la fase Visuales (pestaña Banners). Sin imagen se muestra un banner con texto y colores de la marca.</span></div>
      <div class="banner-prev">${e.imagen ? `<img src="${esc(srcVista(e.imagen))}" alt="">` : 'Banner de texto'}</div>
      <div class="campo"><span>Productos de la promoción (${elegidos.length})</span></div>
      <div class="selector-productos">
        <input type="search" id="buscarPromoProd" placeholder="Buscar por nombre, marca, código o ID para agregar">
        <div class="resultados-sel" id="resultadosPromo"></div>
        <div class="elegidos">${elegidos.map(p => `<span class="elegido"><span>${esc(p.producto)}</span><button data-quitar-prod="${p.id}" aria-label="Quitar ${esc(p.producto)}">×</button></span>`).join('') || '<span class="nota" style="margin:0">Ninguno todavía. Un banner sin productos sirve solo como anuncio.</span>'}</div>
      </div>`;
  }
  function leerEditorPromo() {
    const f = $('#formPromo'), v = k => f.querySelector(`[data-ep="${k}"]`);
    const e = edicionPromo;
    e.titulo = v('titulo').value.trim(); e.descripcion = v('descripcion').value.trim();
    e.desde = v('desde').value; e.hasta = v('hasta').value; e.etiqueta = v('etiqueta').value.trim();
    e.color = v('color').value; e.activo = v('activo').checked;
    const d = v('descuento').value.trim(); e.descuento = d ? VJ.parsePorcentaje(d) : 0;
  }
  function buscarParaPromo(q) {
    const terms = VJ.terminosBusqueda(q);
    const res = $('#resultadosPromo');
    if (!terms.length) { res.innerHTML = ''; return; }
    const ya = new Set(edicionPromo.productos);
    const lista = inv.filter(p => { const t = VJ.normTexto(`${p.id} ${p.codigo} ${p.producto} ${p.marca}`); return terms.every(w => t.includes(w)); });
    res.innerHTML = (lista.length > 1 ? `<div class="item-sel"><strong>${lista.length} resultados</strong><button class="btn btn-mini" data-agregar-todos>Agregar todos</button></div>` : '') +
      lista.slice(0, 40).map(p => `<div class="item-sel"><span>${esc(p.producto)} <small>· ${esc(p.marca)} · ID ${p.id}${p.codigo ? ' · ' + esc(p.codigo) : ''}</small></span>${ya.has(p.id) ? '<small>Ya agregado</small>' : `<button class="btn btn-mini" data-agregar-prod="${p.id}">Agregar</button>`}</div>`).join('') || '<div class="item-sel">Sin resultados</div>';
    res._lista = lista;
  }
  function guardarPromo() {
    leerEditorPromo();
    const e = edicionPromo;
    if (!e.titulo && !e.imagen) { aviso('Ponle un título o sube una imagen.'); return; }
    if (e.desde && e.hasta && e.desde > e.hasta) { aviso('La fecha “desde” es posterior a “hasta”.'); return; }
    if (isNaN(e.descuento) || e.descuento < 0 || e.descuento > 90) { aviso('El descuento debe estar entre 0 y 90 %.'); return; }
    if (e.esNueva) e.id = idPromoUnico(e.titulo || 'promo');
    const limpio = VJ.normalizarPromociones([e])[0]; limpio.id = e.id;
    const i = promos.findIndex(p => p.id === e.id);
    if (i >= 0) promos[i] = limpio; else promos.unshift(limpio);
    reindexar(); cerrarHojas(); renderTodo(); marcarCambios();
    aviso('Promoción guardada.');
  }

  /* =======================================================================
     FASE VISUALES: fotos de productos y banners
     ======================================================================= */
  const vistaF = { q: '', cat: '', filtro: '', pag: 1 };
  const POR_PAGINA_FOTOS = 48;
  function renderFotos() {
    const cont = $('#gridFotos'); if (!cont || ROL !== 'visuales') return;
    const conFoto = inv.filter(p => p.imagen).length;
    const pend = inv.filter(p => [p.imagen, ...p.galeria].some(f => pendientes.has(f))).length;
    const k = [['', inv.length, 'Productos'], ['sin-foto', inv.length - conFoto, 'Sin foto'], ['con-foto', conFoto, 'Con foto'], ['pendientes', pend, 'Sin publicar']];
    $('#kpisFotos').innerHTML = k.map(([f, n, t]) => `<button class="kpi ${f === 'sin-foto' && n ? 'alerta' : ''}" data-ffiltro="${f}" aria-pressed="${vistaF.filtro === f}"><b>${n.toLocaleString('es-VE')}</b><span>${t}</span></button>`).join('');
    const terms = VJ.terminosBusqueda(vistaF.q);
    const lista = inv.filter(p => {
      if (terms.length && !terms.every(w => VJ.normTexto(`${p.id} ${p.codigo} ${p.producto} ${p.marca}`).includes(w))) return false;
      if (vistaF.cat && p.categoria !== vistaF.cat) return false;
      if (vistaF.filtro === 'sin-foto' && p.imagen) return false;
      if (vistaF.filtro === 'con-foto' && !p.imagen) return false;
      if (vistaF.filtro === 'pendientes' && ![p.imagen, ...p.galeria].some(f => pendientes.has(f))) return false;
      return true;
    }).sort((a, b) => (a.imagen ? 1 : 0) - (b.imagen ? 1 : 0) || a.producto.localeCompare(b.producto, 'es'));
    const paginas = Math.max(1, Math.ceil(lista.length / POR_PAGINA_FOTOS));
    vistaF.pag = Math.min(vistaF.pag, paginas);
    const ini = (vistaF.pag - 1) * POR_PAGINA_FOTOS;
    cont.innerHTML = lista.slice(ini, ini + POR_PAGINA_FOTOS).map(p => {
      const src = srcVista(p.imagen), n = [p.imagen, ...p.galeria].filter(Boolean).length;
      const pendiente = [p.imagen, ...p.galeria].some(f => pendientes.has(f));
      return `<article class="foto-card ${pendiente ? 'pendiente' : ''}" data-id="${p.id}">
        <button class="foto-zona ${src ? 'tiene' : ''}" data-subir title="Clic o arrastra una foto aquí">${src ? `<img src="${esc(src)}" alt="${esc(p.producto)}" loading="lazy">` : `<span>${ICONOS.foto}Subir foto</span>`}${n > 1 ? `<span class="cuenta">${n} fotos</span>` : ''}</button>
        <div class="foto-info"><strong>${esc(p.producto)}</strong><small>${esc(p.marca)} · ID ${p.id}${p.codigo ? ' · ' + esc(p.codigo) : ''}</small>${pendiente ? '<small class="alerta-txt">Sin publicar</small>' : ''}</div>
        <div class="botones"><button class="btn btn-mini btn-azul" data-subir>${src ? 'Cambiar' : 'Subir'}</button><button class="btn btn-mini" data-galeria>Galería</button></div>
      </article>`;
    }).join('') || '<div class="vacio-adm" style="grid-column:1/-1">No hay productos con estos filtros.</div>';
    $('#infoFotos').textContent = lista.length ? `${ini + 1}–${Math.min(ini + POR_PAGINA_FOTOS, lista.length)} de ${lista.length.toLocaleString('es-VE')}` : '';
    const nav = $('#pagFotos');
    if (paginas <= 1) { nav.innerHTML = ''; return; }
    const p = vistaF.pag, nums = [...new Set([1, p - 1, p, p + 1, paginas])].filter(x => x >= 1 && x <= paginas).sort((a, b) => a - b);
    let h = `<button data-pagf="${p - 1}" ${p <= 1 ? 'disabled' : ''}>‹</button>`, prev = 0;
    for (const x of nums) { if (x - prev > 1) h += '<span class="puntos">…</span>'; h += `<button data-pagf="${x}" ${x === p ? 'aria-current="page"' : ''}>${x}</button>`; prev = x; }
    nav.innerHTML = h + `<button data-pagf="${p + 1}" ${p >= paginas ? 'disabled' : ''}>›</button>`;
  }
  function renderBanners() {
    const cont = $('#listaBanners'); if (!cont || ROL !== 'visuales') return;
    if (!promos.length) { cont.innerHTML = '<div class="vacio-adm">No hay promociones. Las crea la fase Inventario; cuando existan aparecerán aquí para cargar su banner.</div>'; return; }
    const orden = { activa: 0, programada: 1, inactiva: 2, vencida: 3 };
    cont.innerHTML = [...promos].sort((a, b) => orden[VJ.estadoPromo(a)] - orden[VJ.estadoPromo(b)]).map(p => {
      const est = VJ.estadoPromo(p);
      const pc = srcVista(p.imagen), mv = srcVista(p.imagenMovil);
      return `<article class="promo-card" data-banner-promo="${esc(p.id)}">
        <div class="info">
          <h3>${esc(p.titulo || p.id)}</h3>
          <div><span class="estado ${est}">${ETQ_ESTADO[est]}</span> · ${fechaLarga(p.desde)} → ${fechaLarga(p.hasta)}</div>
          <div class="campo" style="margin:8px 0 0"><span>Computador (1600 × 460 px)</span></div>
          <div class="banner-prev">${pc ? `<img src="${esc(pc)}" alt="">` : 'Sin imagen: se muestra el banner de texto'}</div>
          <div class="botones"><label class="btn btn-mini btn-azul" style="display:inline-grid;place-items:center">${pc ? 'Cambiar' : 'Subir'} imagen<input type="file" accept="image/*" hidden data-banner="pc"></label>${pc ? '<button class="btn btn-mini btn-peligro" data-quitar-banner="pc">Quitar</button>' : ''}</div>
          <div class="campo" style="margin:10px 0 0"><span>Teléfono (opcional, 1080 × 810 px)</span></div>
          <div class="banner-prev movil">${mv ? `<img src="${esc(mv)}" alt="">` : 'Usa la de computador'}</div>
          <div class="botones"><label class="btn btn-mini" style="display:inline-grid;place-items:center">${mv ? 'Cambiar' : 'Subir'} imagen móvil<input type="file" accept="image/*" hidden data-banner="movil"></label>${mv ? '<button class="btn btn-mini btn-peligro" data-quitar-banner="movil">Quitar</button>' : ''}</div>
        </div>
      </article>`;
    }).join('');
  }

  /* =======================================================================
     EXCEL: lectura y emparejamiento
     ======================================================================= */
  const SINONIMOS = {
    id: ['id', 'idinterno', 'iddigimarket'],
    codigo: ['codigo', 'cod', 'codproducto', 'codigoproducto', 'codigointerno', 'sku', 'referencia', 'ref', 'codart', 'codigoarticulo'],
    producto: ['producto', 'product', 'nombre', 'nombreproducto', 'articulo', 'nombrearticulo', 'descripcionproducto'],
    descripcion: ['descripcion', 'descripcionlarga', 'detalle', 'detalles'],
    marca: ['marca', 'brand', 'fabricante', 'proveedor', 'laboratorio'],
    categoria: ['categoria', 'category', 'departamento', 'rubro', 'familia', 'linea', 'grupo'],
    precio: ['precio', 'price', 'preciousd', 'preciounitario', 'preciodeventa', 'precioventa', 'pvp', 'precioref', 'preciodolares', 'preciounitariousd', 'preciounit', 'preciobase', 'precio1'],
    descuento: ['descuento', 'desc', 'descuentoporcentaje', 'porcentajedescuento', 'porcentaje', 'dcto', 'dto', 'off', 'descuentomes', 'descuentodelmes'],
    stock: ['stock', 'cantidad', 'existencia', 'existencias', 'inventario', 'qty', 'disponible', 'cantidaddisponible', 'unidades', 'cant'],
    modulo: ['modulo', 'module', 'almacen', 'deposito', 'ubicacion'],
    imagen: ['imagen', 'image', 'foto', 'urlimagen', 'imagenurl', 'img', 'urlfoto'],
    destacado: ['destacado', 'featured']
  };
  const normCab = h => VJ.normTexto(h).toLowerCase().replace(/[^a-z0-9]/g, '');
  function mapearColumnas(cabecera) {
    const norm = cabecera.map(normCab);
    const mapa = {};
    for (const [campo, sins] of Object.entries(SINONIMOS)) {
      const i = norm.findIndex((h, idx) => sins.includes(h) && !Object.values(mapa).includes(idx));
      if (i >= 0) mapa[campo] = i;
    }
    // "Precio …" genérico, evitando columnas de costo u oferta
    if (mapa.precio == null) {
      const i = norm.findIndex((h, idx) => h.startsWith('precio') && !/oferta|promo|desc|anterior|costo|compra/.test(h) && !Object.values(mapa).includes(idx));
      if (i >= 0) mapa.precio = i;
    }
    // Si solo hay "descripción" (sin columna de nombre), esa es el nombre
    if (mapa.producto == null && mapa.descripcion != null) { mapa.producto = mapa.descripcion; delete mapa.descripcion; }
    return mapa;
  }
  async function leerHojaExcel(file) {
    if (typeof XLSX === 'undefined') throw new Error('La librería de Excel aún está cargando; intenta de nuevo en unos segundos.');
    const wb = XLSX.read(new Uint8Array(await file.arrayBuffer()), { type: 'array' });
    let mejor = null;
    for (const nombre of wb.SheetNames) {
      const ws = wb.Sheets[nombre];
      if (!ws['!ref']) continue;
      const desfase = XLSX.utils.decode_range(ws['!ref']).s.r; // fila real de Excel donde empieza el rango
      const filas = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: true, blankrows: true });
      for (let i = 0; i < Math.min(30, filas.length); i++) {
        const mapa = mapearColumnas(filas[i].map(String));
        const puntos = Object.keys(mapa).length + (mapa.producto != null || mapa.codigo != null || mapa.id != null ? 3 : 0);
        if (Object.keys(mapa).length >= 2 && (!mejor || puntos > mejor.puntos)) mejor = { hoja: nombre, filaCab: i + desfase, cabecera: filas[i].map(String), mapa, filas: filas.slice(i + 1), puntos };
      }
    }
    if (!mejor) throw new Error('No se encontró una fila de encabezados reconocible (producto, código, precio, cantidad…).');
    return mejor;
  }
  function buscarCoincidencia(fila, indices) {
    if (fila.id && porIdImport(indices, fila.id)) return { p: porIdImport(indices, fila.id), por: 'ID' };
    if (fila.codigo) { const p = indices.porCodigo.get(VJ.claveCodigo(fila.codigo)); if (p) return { p, por: 'código' }; }
    if (fila.producto) {
      if (fila.marca != null && fila.marca !== '') { const p = indices.porFirma.get(VJ.normTexto(fila.producto) + '|' + VJ.normTexto(fila.marca)); if (p) return { p, por: 'nombre y marca' }; }
      const c = indices.porNombre.get(VJ.normTexto(fila.producto)); if (c && c.length === 1) return { p: c[0], por: 'nombre' };
    }
    return null;
  }
  const porIdImport = (ind, id) => ind.porId.get(Number(id));
  function indicesInventario() {
    const porCodigo = new Map(), porFirma = new Map(), porNombre = new Map();
    for (const p of inv) {
      if (p.codigo) porCodigo.set(VJ.claveCodigo(p.codigo), p);
      porFirma.set(VJ.firmaProducto(p), p);
      const n = VJ.normTexto(p.producto); porNombre.set(n, [...(porNombre.get(n) || []), p]);
    }
    return { porId, porCodigo, porFirma, porNombre };
  }
  function categoriaDesdeTexto(t, nombre) {
    const n = VJ.normTexto(t);
    if (n) { const c = CATEGORIAS.find(c => VJ.normTexto(c.nombre) === n || VJ.normTexto(c.id) === n); if (c) return c.id; }
    return VJ.clasificar(nombre);
  }

  /* ---------- Importación de productos ---------- */
  let planImport = null;
  async function analizarImport(file) {
    const vistaEl = $('#vistaImport');
    vistaEl.innerHTML = '<p class="nota">Leyendo archivo…</p>';
    let hoja;
    try { hoja = await leerHojaExcel(file); } catch (e) { vistaEl.innerHTML = `<p class="nota alerta-txt">${esc(e.message)}</p>`; return; }
    const m = hoja.mapa;
    const modo = $('input[name="modoImport"]:checked').value;
    const celda = (f, campo) => m[campo] != null ? f[m[campo]] : undefined;
    const ind = indicesInventario();
    const plan = { modo, actualizar: [], nuevos: [], ignorados: [], errores: [], duplicadosArchivo: [], cambiosPrecio: [], nombresCambian: [], tocados: new Set(), hoja };
    const vistosArchivo = new Map();
    hoja.filas.forEach((f, i) => {
      const nFila = hoja.filaCab + i + 2;
      const fila = {
        id: celda(f, 'id'), codigo: celda(f, 'codigo') != null ? String(celda(f, 'codigo')).trim() : undefined,
        producto: celda(f, 'producto') != null ? String(celda(f, 'producto')).replace(/\s+/g, ' ').trim() : undefined,
        marca: celda(f, 'marca') != null ? String(celda(f, 'marca')).replace(/\s+/g, ' ').trim() : undefined
      };
      if (!fila.producto && !fila.codigo && !fila.id) return; // fila vacía
      const clave = fila.codigo ? 'c:' + VJ.claveCodigo(fila.codigo) : 'n:' + VJ.normTexto(fila.producto) + '|' + VJ.normTexto(fila.marca || '');
      if (vistosArchivo.has(clave)) { plan.duplicadosArchivo.push({ fila: nFila, texto: fila.producto || fila.codigo, primera: vistosArchivo.get(clave) }); return; }
      vistosArchivo.set(clave, nFila);
      const cambios = {};
      if (m.precio != null) {
        const n = VJ.parseNumero(celda(f, 'precio'));
        if (isNaN(n) || n < 0) { plan.errores.push({ fila: nFila, texto: fila.producto || fila.codigo, motivo: `precio no válido (“${celda(f, 'precio')}”)` }); return; }
        cambios.precio = Math.round(n * 100) / 100;
      }
      if (m.stock != null) { const n = VJ.parseNumero(celda(f, 'stock')); cambios.stock = isNaN(n) || n < 0 ? 0 : Math.floor(n); }
      if (m.descuento != null) { const raw = celda(f, 'descuento'); const n = String(raw).trim() === '' ? 0 : VJ.parsePorcentaje(raw); if (!isNaN(n)) cambios.descuento = VJ.limitarDescuento(n); }
      if (m.marca != null) cambios.marca = fila.marca;
      if (m.modulo != null) cambios.modulo = String(celda(f, 'modulo')).trim();
      if (m.descripcion != null) cambios.descripcion = String(celda(f, 'descripcion')).trim();
      if (m.codigo != null && fila.codigo) cambios.codigo = fila.codigo;
      if (m.imagen != null && String(celda(f, 'imagen')).trim()) { const u = VJ.urlSegura(String(celda(f, 'imagen')).trim()); if (u) cambios.imagen = u; }
      if (m.destacado != null) cambios.destacado = /^(si|sí|x|1|true|verdadero)$/i.test(String(celda(f, 'destacado')).trim());
      const hit = buscarCoincidencia(fila, ind);
      if (hit) {
        if (plan.tocados.has(hit.p.id)) { plan.duplicadosArchivo.push({ fila: nFila, texto: fila.producto || fila.codigo, primera: 'otra fila con el mismo producto' }); return; }
        plan.tocados.add(hit.p.id);
        if (m.producto != null && fila.producto && fila.producto !== hit.p.producto) {
          cambios.producto = fila.producto;
          if (hit.por === 'ID' || hit.por === 'código') plan.nombresCambian.push({ id: hit.p.id, antes: hit.p.producto, despues: fila.producto, por: hit.por });
        }
        if (m.categoria != null && String(celda(f, 'categoria')).trim()) cambios.categoria = categoriaDesdeTexto(celda(f, 'categoria'), fila.producto || hit.p.producto);
        if (cambios.precio != null && cambios.precio !== hit.p.precio) plan.cambiosPrecio.push({ p: hit.p, antes: hit.p.precio, despues: cambios.precio });
        plan.actualizar.push({ id: hit.p.id, cambios, por: hit.por });
      } else {
        if (!fila.producto) { plan.errores.push({ fila: nFila, texto: fila.codigo || fila.id, motivo: 'no coincide con ningún producto y no trae nombre' }); return; }
        if (modo === 'solo-existentes') { plan.ignorados.push({ fila: nFila, texto: fila.producto }); return; }
        if (fila.codigo && ind.porCodigo.has(VJ.claveCodigo(fila.codigo))) { plan.errores.push({ fila: nFila, texto: fila.producto, motivo: 'el código ya existe en otro producto' }); return; }
        const cat = m.categoria != null && String(celda(f, 'categoria')).trim() ? categoriaDesdeTexto(celda(f, 'categoria'), fila.producto) : VJ.clasificar(fila.producto);
        plan.nuevos.push(VJ.normalizarProducto({ ...cambios, producto: fila.producto, marca: fila.marca || '', codigo: fila.codigo || '', categoria: cat }));
      }
    });
    plan.eliminar = modo === 'reemplazar' ? inv.filter(p => !plan.tocados.has(p.id)) : [];
    planImport = plan;
    renderPlanImport();
  }
  function renderPlanImport() {
    const p = planImport, m = p.hoja.mapa;
    const etiquetas = { id: 'ID', codigo: 'Código', producto: 'Producto', descripcion: 'Descripción', marca: 'Marca', categoria: 'Categoría', precio: 'Precio', descuento: 'Descuento', stock: 'Stock', modulo: 'Módulo', imagen: 'Imagen', destacado: 'Destacado' };
    const cols = Object.entries(etiquetas).map(([k, t]) => m[k] != null ? `<span>${t} ← “${esc(p.hoja.cabecera[m[k]])}”</span>` : (['producto', 'precio'].includes(k) ? `<span class="falta">${t}: no encontrada</span>` : '')).join('');
    const grandes = p.cambiosPrecio.filter(c => c.antes > 0 && (c.despues > c.antes * 2 || c.despues < c.antes / 2));
    const sospecha = p.actualizar.length > 10 && p.nombresCambian.length > p.actualizar.length * 0.3;
    const lista = (arr, fn, max = 200) => `<div class="desplazable"><table class="tabla-mini"><tbody>${arr.slice(0, max).map(fn).join('')}</tbody></table></div>${arr.length > max ? `<p class="nota">…y ${arr.length - max} más.</p>` : ''}`;
    $('#vistaImport').innerHTML = `
      <p class="nota">Hoja <strong>${esc(p.hoja.hoja)}</strong>, encabezados en la fila ${p.hoja.filaCab + 1}.</p>
      <div class="mapa-cols">${cols}</div>
      ${sospecha ? `<p class="alerta-txt">⚠ Muchos productos cambian de nombre al emparejarlos por ID o código. Puede que el archivo sea de otro catálogo o que las columnas estén corridas. Revisa antes de aplicar.</p>` : ''}
      ${grandes.length ? `<p class="alerta-txt">⚠ ${grandes.length} precios cambian más del doble o a menos de la mitad. Revisa que la columna de precio sea la correcta.</p>` : ''}
      <div class="resumen-import">
        <div><b>${p.actualizar.length}</b><span>se actualizan</span></div>
        <div><b>${p.cambiosPrecio.length}</b><span>cambian de precio</span></div>
        <div><b>${p.nuevos.length}</b><span>productos nuevos</span></div>
        ${p.modo === 'reemplazar' ? `<div class="rojo"><b>${p.eliminar.length}</b><span>se eliminan</span></div>` : ''}
        ${p.ignorados.length ? `<div><b>${p.ignorados.length}</b><span>nuevos ignorados</span></div>` : ''}
        <div class="${p.duplicadosArchivo.length ? 'rojo' : ''}"><b>${p.duplicadosArchivo.length}</b><span>filas repetidas (se omiten)</span></div>
        <div class="${p.errores.length ? 'rojo' : ''}"><b>${p.errores.length}</b><span>filas con error</span></div>
      </div>
      ${p.cambiosPrecio.length ? `<details class="mas" ${grandes.length ? 'open' : ''}><summary>Cambios de precio (${p.cambiosPrecio.length})</summary>${lista(p.cambiosPrecio.sort((a, b) => Math.abs(b.despues - b.antes) / (b.antes || 1) - Math.abs(a.despues - a.antes) / (a.antes || 1)), c => `<tr><td>${esc(c.p.producto)}</td><td class="num">${dinero(c.antes)}</td><td class="num ${c.despues > c.antes ? 'sube' : 'baja'}">${dinero(c.despues)}</td></tr>`)}</details>` : ''}
      ${p.nombresCambian.length ? `<details class="mas"><summary>Nombres que cambian (${p.nombresCambian.length})</summary>${lista(p.nombresCambian, c => `<tr><td>ID ${c.id}</td><td>${esc(c.antes)}</td><td>→ ${esc(c.despues)}</td></tr>`)}</details>` : ''}
      ${p.nuevos.length ? `<details class="mas"><summary>Productos nuevos (${p.nuevos.length})</summary>${lista(p.nuevos, n => `<tr><td>${esc(n.producto)}</td><td>${esc(n.marca)}</td><td>${esc(nombreCategoria(n.categoria))}</td><td class="num">${dinero(n.precio)}</td><td class="num">${n.stock}</td></tr>`)}</details>` : ''}
      ${p.eliminar.length ? `<details class="mas"><summary>Se eliminarán (${p.eliminar.length})</summary>${lista(p.eliminar, n => `<tr><td>${esc(n.producto)}</td><td>${esc(n.marca)}</td></tr>`)}</details>` : ''}
      ${p.duplicadosArchivo.length ? `<details class="mas"><summary>Filas repetidas en el archivo (${p.duplicadosArchivo.length})</summary>${lista(p.duplicadosArchivo, d => `<tr><td>Fila ${d.fila}</td><td>${esc(d.texto)}</td><td>repite la fila ${esc(d.primera)}</td></tr>`)}</details>` : ''}
      ${p.errores.length ? `<details class="mas" open><summary>Filas con error (${p.errores.length})</summary>${lista(p.errores, d => `<tr><td>Fila ${d.fila}</td><td>${esc(d.texto)}</td><td class="alerta-txt">${esc(d.motivo)}</td></tr>`)}</details>` : ''}
      <div class="botones" style="margin-top:12px">
        <button class="btn btn-primario" id="aplicarImport" ${m.producto == null && m.codigo == null && m.id == null ? 'disabled' : ''}>Aplicar al panel</button>
        <button class="btn" id="cancelarImport">Cancelar</button>
      </div>
      <p class="nota" style="margin-top:8px">Aplicar no publica: después revisa y pulsa “Publicar cambios”.</p>`;
  }
  function aplicarImport() {
    const p = planImport; if (!p) return;
    if (p.eliminar.length && !confirm(`Se eliminarán ${p.eliminar.length} productos que no están en el archivo. ¿Continuar?`)) return;
    for (const u of p.actualizar) {
      const prod = porId.get(u.id); if (!prod) continue;
      Object.assign(prod, u.cambios); editados.add(u.id);
    }
    let sig = siguienteId();
    for (const n of p.nuevos) { n.id = sig++; inv.push(n); nuevos.add(n.id); }
    if (p.eliminar.length) {
      const set = new Set(p.eliminar.map(x => x.id));
      inv = inv.filter(x => !set.has(x.id));
      promos.forEach(pr => { pr.productos = pr.productos.filter(id => !set.has(id)); });
    }
    inv = VJ.normalizarInventario(inv).productos;
    reindexar(); planImport = null; $('#vistaImport').innerHTML = ''; $('#excelProductos').value = '';
    renderTodo(); marcarCambios();
    aviso(`Listo: ${p.actualizar.length} actualizados, ${p.nuevos.length} nuevos${p.eliminar.length ? ', ' + p.eliminar.length + ' eliminados' : ''}. Revisa y publica.`, 5000);
    activarTab('productos');
  }
  function exportarExcel() {
    if (typeof XLSX === 'undefined') { aviso('La librería de Excel aún está cargando.'); return; }
    const filas = inv.map(p => ({ ID: p.id, 'Código': p.codigo, Producto: p.producto, Marca: p.marca, 'Categoría': nombreCategoria(p.categoria), 'Módulo': p.modulo, Precio: p.precio, 'Descuento %': p.descuento, Stock: p.stock, Destacado: p.destacado ? 'sí' : '', Imagen: p.imagen, 'Descripción': p.descripcion }));
    const ws = XLSX.utils.json_to_sheet(filas);
    ws['!cols'] = [{ wch: 6 }, { wch: 12 }, { wch: 48 }, { wch: 22 }, { wch: 20 }, { wch: 14 }, { wch: 9 }, { wch: 11 }, { wch: 8 }, { wch: 10 }, { wch: 30 }, { wch: 40 }];
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Productos');
    XLSX.writeFile(wb, `catalogo-digimarket-${VJ.hoyISO()}.xlsx`);
  }

  /* ---------- Descuentos desde Excel ---------- */
  let planDesc = null;
  async function analizarDescuentos(file) {
    const vistaEl = $('#vistaDescuentos');
    let hoja;
    try { hoja = await leerHojaExcel(file); } catch (e) { vistaEl.innerHTML = `<p class="nota alerta-txt">${esc(e.message)}</p>`; return; }
    if (hoja.mapa.descuento == null) { vistaEl.innerHTML = '<p class="nota alerta-txt">No se encontró una columna de descuento (descuento, desc, %, dcto…).</p>'; return; }
    const ind = indicesInventario(), m = hoja.mapa;
    const ok = [], sin = [], invalidos = [], vistos = new Set();
    hoja.filas.forEach((f, i) => {
      const fila = { id: m.id != null ? f[m.id] : undefined, codigo: m.codigo != null ? String(f[m.codigo]).trim() : '', producto: m.producto != null ? String(f[m.producto]).trim() : '', marca: m.marca != null ? String(f[m.marca]).trim() : undefined };
      if (!fila.id && !fila.codigo && !fila.producto) return;
      const d = VJ.parsePorcentaje(f[m.descuento]);
      if (isNaN(d) || d < 0 || d > 90) { invalidos.push({ fila: hoja.filaCab + i + 2, texto: fila.producto || fila.codigo, valor: f[m.descuento] }); return; }
      const hit = buscarCoincidencia(fila, ind);
      if (!hit) { sin.push({ fila: hoja.filaCab + i + 2, texto: fila.producto || fila.codigo || fila.id }); return; }
      if (vistos.has(hit.p.id)) return; vistos.add(hit.p.id);
      ok.push({ p: hit.p, d: VJ.limitarDescuento(d), por: hit.por });
    });
    planDesc = { ok, sin, invalidos };
    vistaEl.innerHTML = `
      <div class="resumen-import"><div><b>${ok.length}</b><span>productos encontrados</span></div><div class="${sin.length ? 'rojo' : ''}"><b>${sin.length}</b><span>sin coincidencia</span></div><div class="${invalidos.length ? 'rojo' : ''}"><b>${invalidos.length}</b><span>descuentos no válidos</span></div></div>
      <div class="desplazable"><table class="tabla-mini"><thead><tr><th>Producto</th><th>Emparejado por</th><th class="num">Precio</th><th class="num">Desc.</th><th class="num">Final</th></tr></thead><tbody>
      ${ok.slice(0, 300).map(o => `<tr><td>${esc(o.p.producto)}</td><td>${o.por}</td><td class="num">${dinero(o.p.precio)}</td><td class="num">${o.d}%</td><td class="num">${dinero(Math.round(VJ.centavos(o.p.precio) * (100 - o.d) / 100) / 100)}</td></tr>`).join('')}
      </tbody></table></div>
      ${sin.length ? `<details class="mas"><summary>Sin coincidencia (${sin.length})</summary><div class="desplazable"><table class="tabla-mini"><tbody>${sin.map(s => `<tr><td>Fila ${s.fila}</td><td>${esc(s.texto)}</td></tr>`).join('')}</tbody></table></div></details>` : ''}
      <div class="botones"><button class="btn btn-primario" id="aplicarDescuentos" ${ok.length ? '' : 'disabled'}>Aplicar descuentos</button><button class="btn" id="cancelarDescuentos">Cancelar</button></div>`;
  }
  function aplicarDescuentos() {
    const plan = planDesc; if (!plan) return;
    const destino = $('#destinoDescuentos').value;
    if (destino === 'producto') {
      if ($('#limpiarDescuentos').checked) { const set = new Set(plan.ok.map(o => o.p.id)); inv.forEach(p => { if (!set.has(p.id) && p.descuento) { p.descuento = 0; editados.add(p.id); } }); }
      plan.ok.forEach(o => { o.p.descuento = o.d; editados.add(o.p.id); });
      aviso(`Descuentos aplicados a ${plan.ok.length} productos.`);
    } else {
      // Una promoción por cada % distinto, para que cada producto conserve su descuento exacto
      const mes = mesActual();
      const grupos = new Map(); plan.ok.forEach(o => grupos.set(o.d, [...(grupos.get(o.d) || []), o.p.id]));
      for (const [d, ids] of grupos) {
        const titulo = `Ofertas de ${mes.nombre}${grupos.size > 1 ? ` ${d}%` : ''}`;
        promos.unshift(VJ.normalizarPromociones([{ id: idPromoUnico(titulo), titulo, etiqueta: `-${d}%`, descuento: d, desde: mes.desde, hasta: mes.hasta, productos: ids, activo: true, color: 'rojo' }])[0]);
      }
      aviso(`Se crearon ${grupos.size} promoción(es). Edítalas para ajustar título e imagen.`, 5000);
    }
    planDesc = null; $('#vistaDescuentos').innerHTML = ''; $('#excelDescuentos').value = '';
    reindexar(); renderTodo(); marcarCambios();
  }

  /* ---------- Fotos en lote ---------- */
  let planFotos = [];
  function analizarFotos(files) {
    const ind = indicesInventario();
    planFotos = [...files].filter(f => /^image\//.test(f.type)).map(f => {
      const base = f.name.replace(/\.[^.]+$/, '').trim();
      let p = null, por = '';
      if (/^\d+$/.test(base) && porId.has(Number(base))) { p = porId.get(Number(base)); por = 'ID'; }
      if (!p) { const c = ind.porCodigo.get(VJ.claveCodigo(base)); if (c) { p = c; por = 'código'; } }
      if (!p) { const c = ind.porNombre.get(VJ.normTexto(base.replace(/[_]+/g, ' '))); if (c && c.length === 1) { p = c[0]; por = 'nombre'; } }
      return { file: f, base, id: p ? p.id : null, por, url: URL.createObjectURL(f) };
    });
    renderPlanFotos();
  }
  function renderPlanFotos() {
    const ok = planFotos.filter(x => x.id).length;
    const opciones = '<option value="">— elegir producto —</option>' + [...inv].sort((a, b) => a.producto.localeCompare(b.producto, 'es')).map(p => `<option value="${p.id}">${esc(p.producto)} · ${esc(p.marca)} (ID ${p.id})</option>`).join('');
    $('#vistaFotos').innerHTML = `
      <div class="resumen-import"><div><b>${planFotos.length}</b><span>fotos</span></div><div><b>${ok}</b><span>con producto</span></div><div class="${planFotos.length - ok ? 'rojo' : ''}"><b>${planFotos.length - ok}</b><span>sin asignar</span></div></div>
      <div class="desplazable"><table class="tabla-mini"><thead><tr><th>Foto</th><th>Archivo</th><th>Producto</th></tr></thead><tbody>
      ${planFotos.map((x, i) => `<tr><td><img src="${esc(x.url)}" alt="" style="width:48px;height:48px;object-fit:contain"></td><td>${esc(x.file.name)}${x.por ? `<br><small>por ${x.por}</small>` : ''}</td><td><select data-foto-lote="${i}" style="max-width:340px;height:36px">${opciones.replace(`value="${x.id}"`, `value="${x.id}" selected`)}</select></td></tr>`).join('')}
      </tbody></table></div>
      <div class="botones"><button class="btn btn-primario" id="aplicarFotos" ${ok ? '' : 'disabled'}>Asignar ${ok} foto${ok === 1 ? '' : 's'}</button><button class="btn" id="cancelarFotos">Cancelar</button></div>`;
  }
  async function aplicarFotos() {
    const lista = planFotos.filter(x => x.id && porId.has(x.id));
    const comoGaleria = $('#fotosComoGaleria').checked;
    const btn = $('#aplicarFotos'); btn.disabled = true;
    let hechos = 0;
    for (const x of lista) {
      btn.textContent = `Optimizando ${++hechos} de ${lista.length}…`;
      try {
        const ruta = await prepararFotoProducto(x.id, x.file);
        const p = porId.get(x.id);
        if (comoGaleria && p.imagen && p.imagen !== ruta) { if (!p.galeria.includes(ruta)) p.galeria.push(ruta); }
        else p.imagen = ruta;
        if (!nuevos.has(x.id)) editados.add(x.id);
      } catch (e) { aviso('Error con ' + x.file.name + ': ' + e.message); }
    }
    planFotos.forEach(x => URL.revokeObjectURL(x.url)); planFotos = [];
    $('#vistaFotos').innerHTML = ''; $('#lotesFotos').value = '';
    renderTodo(); marcarCambios();
    aviso(`${lista.length} fotos asignadas. Se subirán al publicar.`, 4000);
  }

  /* =======================================================================
     VALIDACIÓN Y PUBLICACIÓN
     ======================================================================= */
  function validar() {
    const errores = [], avisos = [];
    const ids = new Set();
    for (const p of inv) { if (ids.has(p.id)) errores.push(`ID repetido: ${p.id}`); ids.add(p.id); if (!p.producto) errores.push(`Producto sin nombre (ID ${p.id})`); }
    const cods = new Map();
    for (const p of inv) if (p.codigo) { const k = VJ.claveCodigo(p.codigo); cods.set(k, [...(cods.get(k) || []), p]); }
    for (const [, ps] of cods) if (ps.length > 1) errores.push(`Código “${ps[0].codigo}” repetido en: ${ps.map(p => `${p.producto} (ID ${p.id})`).join(', ')}`);
    const firmas = new Map();
    for (const p of inv) { const k = VJ.firmaProducto(p); firmas.set(k, [...(firmas.get(k) || []), p]); }
    for (const [, ps] of firmas) if (ps.length > 1) avisos.push(`Mismo nombre y marca: ${ps[0].producto} (IDs ${ps.map(p => p.id).join(', ')})`);
    const cero = inv.filter(p => !(p.precio > 0));
    if (cero.length) avisos.push(`${cero.length} producto(s) con precio 0: ${cero.slice(0, 5).map(p => p.producto).join(', ')}${cero.length > 5 ? '…' : ''}`);
    const altos = inv.filter(p => p.descuento >= 70);
    if (altos.length) avisos.push(`${altos.length} producto(s) con descuento de 70 % o más: ${altos.slice(0, 5).map(p => p.producto).join(', ')}`);
    for (const pr of promos) {
      if (pr.desde && pr.hasta && pr.desde > pr.hasta) errores.push(`La promoción “${pr.titulo || pr.id}” termina antes de empezar.`);
      const faltan = pr.productos.filter(id => !porId.has(id)).length;
      if (faltan) avisos.push(`La promoción “${pr.titulo || pr.id}” tenía ${faltan} producto(s) que ya no existen; se quitarán.`);
      if (VJ.estadoPromo(pr) === 'activa' && !pr.titulo && !pr.imagen) avisos.push(`La promoción activa “${pr.id}” no tiene título ni imagen.`);
      if (pr.activo && VJ.estadoPromo(pr) === 'vencida') avisos.push(`“${pr.titulo || pr.id}” ya venció; no se mostrará.`);
    }
    if (!inv.length) errores.push('El catálogo quedaría vacío.');
    return { errores, avisos };
  }

  function abrirPublicar() {
    const e = estadoCambios();
    const cuerpo = $('#cuerpoPublicar'), pie = $('#piePublicar');
    if (!hayConexion()) {
      cuerpo.innerHTML = '<p>Para publicar necesitas configurar la conexión con GitHub (usuario, repositorio y token).</p>';
      pie.innerHTML = '<button class="btn" data-cerrar>Cerrar</button><button class="btn btn-azul" id="irConexion">Configurar conexión</button>';
      abrirHoja('#hojaPublicar'); return;
    }
    if (!e.sucio) { aviso('No hay cambios por publicar.'); return; }
    const { errores, avisos } = ROL === 'visuales' ? { errores: [], avisos: [] } : validar();
    const resumen = [];
    if (e.prod) resumen.push(ROL === 'visuales' ? `fotos de ${editados.size} producto(s)` : `productos (${editados.size} editados, ${nuevos.size} nuevos)`);
    if (e.promo) resumen.push(ROL === 'visuales' ? 'banners' : 'promociones');
    if (e.fotos) resumen.push(`${e.fotos} foto(s) nuevas`);
    cuerpo.innerHTML = `<div class="cuerpo-publicar">
      <p>Se publicará en <strong>${esc(cfg().owner)}/${esc(cfg().repo)}</strong> (rama ${esc(cfg().branch)}): ${esc(resumen.join(', '))}.</p>
      ${errores.length ? `<div class="val-error"><h3>Hay que corregir antes de publicar</h3><ul class="lista-val">${errores.map(x => `<li>${esc(x)}</li>`).join('')}</ul></div>` : ''}
      ${avisos.length ? `<div class="val-aviso"><h3>Revisa (no impide publicar)</h3><ul class="lista-val">${avisos.slice(0, 30).map(x => `<li>${esc(x)}</li>`).join('')}</ul></div>` : ''}
      ${!errores.length && !avisos.length ? '<div class="val-ok"><h3>Todo en orden ✓</h3></div>' : ''}
      <label class="campo"><span>Descripción del cambio (opcional)</span><input id="mensajeCommit" placeholder="Ej.: Precios de la semana y promo de noviembre"></label>
      <ol class="pasos" id="pasosPublicar" hidden></ol>
    </div>`;
    pie.innerHTML = `<button class="btn" data-cerrar>Cancelar</button><button class="btn btn-primario" id="confirmarPublicar" ${errores.length ? 'disabled' : ''}>Publicar ahora</button>`;
    abrirHoja('#hojaPublicar');
  }

  function aBase64(bytes) {
    let s = ''; const paso = 0x8000;
    for (let i = 0; i < bytes.length; i += paso) s += String.fromCharCode.apply(null, bytes.subarray(i, i + paso));
    return btoa(s);
  }
  async function leerBlobTexto(sha) {
    const b = await gh(`/git/blobs/${sha}`);
    const bin = atob(String(b.content).replace(/\n/g, ''));
    return new TextDecoder().decode(Uint8Array.from(bin, c => c.charCodeAt(0)));
  }
  // Mezcla de 3 vías por ID: parte de la versión REMOTA (la más reciente) y
  // solo sobrescribe los campos permitidos que este rol cambió respecto a su base.
  function fusionar(base, localL, remoto, campos, puedeCrear, nuevoId) {
    const igual = (a, b) => JSON.stringify(a) === JSON.stringify(b);
    const B = new Map(base.map(x => [x.id, x])), L = new Map(localL.map(x => [x.id, x])), R = new Map(remoto.map(x => [x.id, x]));
    const salida = [], reasignados = new Map();
    let conflictos = 0, perdidos = 0;
    for (const r of remoto) {
      const b = B.get(r.id), l = L.get(r.id);
      if (b && !l && puedeCrear) continue; // eliminado en este panel
      const res = { ...r };
      if (b && l) for (const c of campos) if (!igual(l[c], b[c])) { if (!igual(r[c], b[c]) && !igual(r[c], l[c])) conflictos++; res[c] = l[c]; }
      salida.push(res);
    }
    for (const b of base) if (!R.has(b.id) && L.has(b.id) && campos.some(c => !igual(L.get(b.id)[c], b[c]))) perdidos++;
    if (puedeCrear) {
      for (const l of localL.filter(x => !B.has(x.id)).reverse()) {
        const item = { ...l };
        if (salida.some(x => x.id === item.id)) { const n = nuevoId(salida, item); reasignados.set(item.id, n); item.id = n; }
        salida.unshift(item);
      }
    }
    return { lista: salida, conflictos, perdidos, reasignados };
  }
  function aBase64(bytes) {
    let s = ''; const paso = 0x8000;
    for (let i = 0; i < bytes.length; i += paso) s += String.fromCharCode.apply(null, bytes.subarray(i, i + paso));
    return btoa(s);
  }
  async function publicar() {
    const btn = $('#confirmarPublicar'); btn.disabled = true; btn.textContent = 'Publicando…';
    const pasosEl = $('#pasosPublicar'); pasosEl.hidden = false;
    const pasos = ['Leyendo la versión más reciente en GitHub', 'Subiendo fotos', 'Guardando productos y promociones', 'Creando la publicación', 'Actualizando la rama'];
    pasosEl.innerHTML = pasos.map(p => `<li>${p}</li>`).join('');
    const marca = (i, estado, extra) => { const li = pasosEl.children[i]; li.className = estado; li.textContent = pasos[i] + (extra ? ' — ' + extra : ''); };
    let paso = 0;
    try {
      const c = cfg(), per = PERMISOS[ROL];
      const rutaProd = rutaRepo(TIENDA.archivoProductos), rutaPromo = rutaRepo(TIENDA.archivoPromociones);

      // 1. Versión remota actual + mezcla de los campos de este rol
      marca(0, 'actual');
      const ref = await gh(`/git/ref/heads/${encodeURIComponent(c.branch)}`);
      const commitBase = ref.object.sha;
      const commit = await gh(`/git/commits/${commitBase}`);
      const arbol = await gh(`/git/trees/${commit.tree.sha}?recursive=1`);
      const enRepo = new Map(arbol.tree.filter(t => t.type === 'blob').map(t => [t.path, t.sha]));
      const shaRemProd = enRepo.get(rutaProd) || null, shaRemPromo = enRepo.get(rutaPromo) || null;
      const txtRemProd = !shaRemProd ? '[]' : shaRemProd === shaBase.prod ? snap.prod : await leerBlobTexto(shaRemProd);
      const txtRemPromo = !shaRemPromo ? '[]' : shaRemPromo === shaBase.promo ? snap.promo : await leerBlobTexto(shaRemPromo);
      const remProd = VJ.normalizarInventario(JSON.parse(txtRemProd)).productos;
      const remPromo = VJ.normalizarPromociones(JSON.parse(txtRemPromo));
      const fp = fusionar(JSON.parse(snap.prod), inv, remProd, per.prod, per.crear, l => l.reduce((m, x) => Math.max(m, x.id), 0) + 1);
      const promosLocal = promos.map(p => ({ ...p, productos: p.productos.map(id => fp.reasignados.get(id) || id) }));
      const fpr = fusionar(JSON.parse(snap.promo), promosLocal, remPromo, per.promo, per.crear, (l, it) => { let n = 2, id; do { id = it.id + '-' + (n++); } while (l.some(x => x.id === id)); return id; });
      const prodFinal = VJ.normalizarInventario(fp.lista).productos;
      const promosFinal = VJ.normalizarPromociones(fpr.lista);
      const textoProd = serializarProductos(prodFinal), textoPromo = serializarPromos(promosFinal, prodFinal);
      const shaNuevoProd = await VJ.shaGitBlob(textoProd), shaNuevoPromo = await VJ.shaGitBlob(textoPromo);
      const integrados = (shaRemProd && shaRemProd !== shaBase.prod) || (shaRemPromo && shaRemPromo !== shaBase.promo);
      const conflictos = fp.conflictos + fpr.conflictos, perdidos = fp.perdidos + fpr.perdidos;
      marca(0, 'hecho', integrados ? 'se integraron cambios publicados por la otra fase' : 'sin cambios ajenos');

      // 2. Fotos pendientes que siguen en uso tras la mezcla
      paso = 1; marca(1, 'actual');
      const enUso = refsImagenes(prodFinal, promosFinal);
      const fotos = [...pendientes.entries()].filter(([r]) => enUso.has(r));
      const entradas = []; const cola = [...fotos]; let n = 0;
      async function trabajador() {
        while (cola.length) {
          const [ruta, { blob }] = cola.shift();
          const b = await gh('/git/blobs', { method: 'POST', body: JSON.stringify({ content: aBase64(new Uint8Array(await blob.arrayBuffer())), encoding: 'base64' }) });
          entradas.push({ path: rutaRepo(ruta), mode: '100644', type: 'blob', sha: b.sha });
          marca(1, 'actual', `${++n} de ${fotos.length}`);
        }
      }
      await Promise.all([trabajador(), trabajador(), trabajador()]);
      marca(1, 'hecho', fotos.length ? `${fotos.length} subida(s)` : 'ninguna');

      // 3. JSON + limpieza de fotos que ya nadie usa
      paso = 2; marca(2, 'actual');
      if (shaRemProd !== shaNuevoProd) { const b = await gh('/git/blobs', { method: 'POST', body: JSON.stringify({ content: textoProd, encoding: 'utf-8' }) }); entradas.push({ path: rutaProd, mode: '100644', type: 'blob', sha: b.sha }); }
      if (shaRemPromo !== shaNuevoPromo) { const b = await gh('/git/blobs', { method: 'POST', body: JSON.stringify({ content: textoPromo, encoding: 'utf-8' }) }); entradas.push({ path: rutaPromo, mode: '100644', type: 'blob', sha: b.sha }); }
      const carpetas = [rutaRepo(TIENDA.carpetaImgProductos) + '/', rutaRepo(TIENDA.carpetaImgPromos) + '/'];
      let borradas = 0;
      for (const r of new Set([...refsImagenes(remProd, remPromo), ...refsBase])) {
        const completa = rutaRepo(r);
        if (!enUso.has(r) && enRepo.has(completa) && carpetas.some(cp => completa.startsWith(cp))) { entradas.push({ path: completa, mode: '100644', type: 'blob', sha: null }); borradas++; }
      }
      marca(2, 'hecho', borradas ? `${borradas} foto(s) antiguas eliminadas` : '');
      if (!entradas.length) throw new Error('No había diferencias con lo publicado.');

      // 4. Árbol + commit
      paso = 3; marca(3, 'actual');
      const nuevoArbol = await gh('/git/trees', { method: 'POST', body: JSON.stringify({ base_tree: commit.tree.sha, tree: entradas }) });
      const msg = `[${ROLES[ROL].nombre}] ` + ($('#mensajeCommit').value.trim() || (ROL === 'visuales' ? 'Actualizar fotos' : 'Actualizar inventario')) + ` · ${new Date().toLocaleString('es-VE')}`;
      const nuevoCommit = await gh('/git/commits', { method: 'POST', body: JSON.stringify({ message: msg, tree: nuevoArbol.sha, parents: [commitBase] }) });
      marca(3, 'hecho');

      // 5. Mover la rama sin forzar (si alguien publicó en este instante, falla y se reintenta)
      paso = 4; marca(4, 'actual');
      await gh(`/git/refs/heads/${encodeURIComponent(c.branch)}`, { method: 'PATCH', body: JSON.stringify({ sha: nuevoCommit.sha, force: false }) });
      marca(4, 'hecho');

      // Éxito: el resultado mezclado pasa a ser la nueva base del panel
      for (const [ruta, { url }] of fotos) vistasLocales.set(ruta, url);
      for (const [ruta, { url }] of pendientes) if (!enUso.has(ruta)) URL.revokeObjectURL(url);
      pendientes.clear();
      inv = prodFinal; promos = promosFinal; reindexar();
      snap.prod = textoProd; snap.promo = textoPromo;
      shaBase.prod = shaNuevoProd; shaBase.promo = shaNuevoPromo;
      refsBase = enUso; nuevos.clear(); editados.clear(); seleccion.clear(); origen = 'github';
      local.removeItem(claveBorrador());
      renderTodo(); marcarCambios();
      $('#piePublicar').innerHTML = `<a class="btn btn-azul" href="./" target="_blank" rel="noopener" style="display:inline-grid;place-items:center;text-decoration:none">Ver catálogo</a><button class="btn btn-primario" data-cerrar>Listo</button>`;
      const notas = [];
      if (integrados) notas.push('Se incorporaron los cambios que la otra fase había publicado; el panel ya muestra la versión combinada.');
      if (conflictos) notas.push(`${conflictos} campo(s) habían cambiado también en GitHub; quedó tu versión.`);
      if (perdidos) notas.push(`${perdidos} elemento(s) que editaste fueron eliminados en GitHub por la otra fase y no se restauraron.`);
      $('#pasosPublicar').insertAdjacentHTML('afterend', `<p class="val-ok"><strong>✓ Publicado.</strong> GitHub Pages tarda 1–2 minutos en mostrar los cambios.</p>${notas.map(t => `<p class="nota">${esc(t)}</p>`).join('')}`);
    } catch (err) {
      marca(paso, 'fallo', err.message);
      btn.disabled = false; btn.textContent = 'Reintentar';
      if (err.status === 422 && paso === 4) $('#pasosPublicar').insertAdjacentHTML('afterend', '<p class="alerta-txt">Alguien publicó en este mismo instante. Pulsa “Reintentar”: se volverá a leer GitHub y a mezclar.</p>');
    }
  }

  /* ---------- Conexión ---------- */
  function cargarFormCfg() {
    const c = cfg();
    $('#cfgOwner').value = c.owner; $('#cfgRepo').value = c.repo; $('#cfgBranch').value = c.branch; $('#cfgCarpeta').value = c.carpeta;
    $('#cfgToken').value = c.token; $('#cfgRecordar').checked = !!local.getItem('vj_token');
  }
  async function guardarCfg() {
    const datos = { owner: $('#cfgOwner').value.trim(), repo: $('#cfgRepo').value.trim(), branch: $('#cfgBranch').value.trim() || 'main', carpeta: $('#cfgCarpeta').value.trim().replace(/^\/+|\/+$/g, '') };
    local.setItem('vj_cfg', JSON.stringify(datos));
    const tok = $('#cfgToken').value.trim();
    sesion.removeItem('vj_token'); local.removeItem('vj_token');
    if (tok) ($('#cfgRecordar').checked ? local : sesion).setItem('vj_token', tok);
    const out = $('#resultadoCfg');
    out.textContent = 'Probando conexión…';
    try {
      const repo = await gh('');
      if (repo.permissions && !repo.permissions.push) throw new Error('El token puede leer pero no escribir en este repositorio.');
      await gh(`/git/ref/heads/${encodeURIComponent(datos.branch)}`);
      out.innerHTML = `<span class="baja">✓ Conectado a ${esc(repo.full_name)} (rama ${esc(datos.branch)}).</span>`;
    } catch (e) { out.innerHTML = `<span class="alerta-txt">✕ ${esc(e.message)}</span>`; }
  }
  async function recargarDesdeGH() {
    if (!hayConexion()) { aviso('Primero configura la conexión.'); return; }
    if (estadoCambios().sucio && !confirm('Perderás los cambios sin publicar. ¿Recargar desde GitHub?')) return;
    try { pendientes.clear(); await cargar(true); renderTodo(); marcarCambios(); aviso('Datos recargados desde GitHub.'); }
    catch (e) { aviso('No se pudo recargar: ' + e.message, 5000); }
  }
  function descargarRespaldo() {
    const blob = new Blob([JSON.stringify({ fecha: new Date().toISOString(), productos: JSON.parse(serializarProductos(inv)), promociones: JSON.parse(serializarPromos(promos)) }, null, 1)], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `respaldo-digimarket-${VJ.hoyISO()}.json`; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }
  async function restaurarRespaldo(file) {
    if (ROL !== 'inventario') return;
    try {
      const d = JSON.parse(await file.text());
      const lista = Array.isArray(d) ? d : d.productos;
      if (!Array.isArray(lista) || !lista.length) throw new Error('El archivo no contiene productos.');
      if (!confirm(`Restaurar ${lista.length} productos${d.promociones ? ' y ' + d.promociones.length + ' promociones' : ''}? Quedará como cambio sin publicar.`)) return;
      inv = VJ.normalizarInventario(lista).productos;
      if (Array.isArray(d.promociones)) promos = VJ.normalizarPromociones(d.promociones);
      reindexar(); renderTodo(); marcarCambios(); aviso('Respaldo restaurado. Revisa y publica.');
    } catch (e) { aviso('No se pudo leer el respaldo: ' + e.message, 5000); }
  }

  /* ---------- Pestañas ---------- */
  function activarTab(t) {
    $$('.pestana').forEach(b => b.setAttribute('aria-selected', b.dataset.tab === t));
    $$('.tab').forEach(s => { s.hidden = s.id !== 'tab-' + t; });
    window.scrollTo({ top: 0 });
  }

  /* =======================================================================
     EVENTOS
     ======================================================================= */
  function eventos() {
    $$('.pestana').forEach(b => b.addEventListener('click', () => activarTab(b.dataset.tab)));
    $('#btnPublicar').addEventListener('click', abrirPublicar);
    $('#btnSalir').addEventListener('click', () => {
      if (estadoCambios().sucio && !confirm('Tienes cambios sin publicar (quedan guardados como borrador en este equipo). ¿Salir?')) return;
      saliendo = true; sesion.removeItem('vj_admin_rol'); location.reload();
    });
    // Fase Visuales: fotos por producto
    $('#ffBuscar').addEventListener('input', VJ.debounce(() => { vistaF.q = $('#ffBuscar').value; vistaF.pag = 1; renderFotos(); }, 180));
    $('#ffCategoria').addEventListener('change', e => { vistaF.cat = e.target.value; vistaF.pag = 1; renderFotos(); });
    $('#ffFiltro').addEventListener('change', e => { vistaF.filtro = e.target.value; vistaF.pag = 1; renderFotos(); });
    $('#kpisFotos').addEventListener('click', e => { const b = e.target.closest('[data-ffiltro]'); if (!b) return; vistaF.filtro = b.dataset.ffiltro; $('#ffFiltro').value = vistaF.filtro; vistaF.pag = 1; renderFotos(); });
    $('#pagFotos').addEventListener('click', e => { const b = e.target.closest('[data-pagf]'); if (b && !b.disabled) { vistaF.pag = Number(b.dataset.pagf); renderFotos(); $('#gridFotos').scrollIntoView({ block: 'start' }); } });
    const gf = $('#gridFotos');
    gf.addEventListener('click', e => {
      const card = e.target.closest('.foto-card[data-id]'); if (!card) return;
      const id = Number(card.dataset.id);
      if (e.target.closest('[data-subir]')) { fotoRapidaId = id; $('#fotoRapida').click(); }
      else if (e.target.closest('[data-galeria]')) abrirEditor(id);
    });
    gf.addEventListener('dragover', e => { const z = e.target.closest('.foto-zona'); if (z) { e.preventDefault(); z.classList.add('soltar'); } });
    gf.addEventListener('dragleave', e => { const z = e.target.closest('.foto-zona'); if (z) z.classList.remove('soltar'); });
    gf.addEventListener('drop', e => { const z = e.target.closest('.foto-zona'); if (!z) return; e.preventDefault(); z.classList.remove('soltar'); const f = e.dataTransfer.files[0]; if (f) asignarFotoRapida(Number(z.closest('[data-id]').dataset.id), f); });
    // Fase Visuales: banners
    const lb = $('#listaBanners');
    lb.addEventListener('change', async e => {
      const inp = e.target.closest('[data-banner]'); if (!inp || !inp.files[0]) return;
      const pr = promos.find(p => p.id === inp.closest('[data-banner-promo]').dataset.bannerPromo); if (!pr) return;
      const movil = inp.dataset.banner === 'movil';
      try { pr[movil ? 'imagenMovil' : 'imagen'] = await prepararFotoPromo(pr.id, inp.files[0], movil); renderBanners(); marcarCambios(); aviso('Banner listo. Se subirá al publicar.'); }
      catch (err) { aviso('No se pudo procesar la imagen: ' + err.message); }
    });
    lb.addEventListener('click', e => {
      const q = e.target.closest('[data-quitar-banner]'); if (!q) return;
      const pr = promos.find(p => p.id === q.closest('[data-banner-promo]').dataset.bannerPromo); if (!pr) return;
      pr[q.dataset.quitarBanner === 'movil' ? 'imagenMovil' : 'imagen'] = ''; renderBanners(); marcarCambios();
    });
    $('#btnDeshacer').addEventListener('click', async () => {
      if (!confirm('¿Descartar todos los cambios sin publicar?')) return;
      inv = VJ.normalizarInventario(JSON.parse(snap.prod)).productos; promos = VJ.normalizarPromociones(JSON.parse(snap.promo));
      for (const { url } of pendientes.values()) URL.revokeObjectURL(url);
      pendientes.clear(); nuevos.clear(); editados.clear(); seleccion.clear(); reindexar(); renderTodo(); marcarCambios();
    });

    // Filtros de la tabla
    const alBuscar = VJ.debounce(() => { vista.q = $('#fBuscar').value; vista.pag = 1; renderTabla(); }, 180);
    $('#fBuscar').addEventListener('input', alBuscar);
    [['#fCategoria', 'cat'], ['#fMarca', 'marca'], ['#fModulo', 'modulo'], ['#fRapido', 'rapido'], ['#fOrden', 'orden']].forEach(([s, k]) =>
      $(s).addEventListener('change', e => { vista[k] = e.target.value; vista.pag = 1; if (k === 'rapido') renderKPIs(); renderTabla(); }));
    $('#kpis').addEventListener('click', e => { const b = e.target.closest('[data-rapido]'); if (!b) return; vista.rapido = b.dataset.rapido; $('#fRapido').value = vista.rapido; vista.pag = 1; renderKPIs(); renderTabla(); });
    $('#pagProductos').addEventListener('click', e => { const b = e.target.closest('[data-pagp]'); if (b && !b.disabled) { vista.pag = Number(b.dataset.pagp); renderTabla(); $('#tablaProductos').scrollIntoView({ block: 'start' }); } });
    $('#btnNuevo').addEventListener('click', () => abrirEditor(null));
    $('#selTodos').addEventListener('change', e => { $$('#filasProductos .fila[data-id]').forEach(f => { const id = Number(f.dataset.id); e.target.checked ? seleccion.add(id) : seleccion.delete(id); }); renderTabla(); });
    $('#barraLote').addEventListener('click', e => { const b = e.target.closest('[data-lote]'); if (b) accionLote(b.dataset.lote); });

    // Edición en línea (delegada; el ID sale de la fila)
    const filas = $('#filasProductos');
    filas.addEventListener('change', e => {
      const t = e.target; const fila = t.closest('.fila[data-id]'); if (!fila) return;
      const id = Number(fila.dataset.id);
      if (t.matches('[data-sel]')) { t.checked ? seleccion.add(id) : seleccion.delete(id); fila.classList.toggle('sel', t.checked); renderLote(); return; }
      if (t.dataset.campo) aplicarCampo(id, t.dataset.campo, t.type === 'checkbox' ? t.checked : t.value, t);
    });
    filas.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.matches('input[type="text"]')) { e.preventDefault(); e.target.blur(); } });
    filas.addEventListener('click', e => {
      const fila = e.target.closest('.fila[data-id]'); if (!fila) return;
      const id = Number(fila.dataset.id), p = porId.get(id); if (!p) return;
      if (e.target.closest('[data-editar]')) abrirEditor(id);
      else if (e.target.closest('[data-foto]')) { fotoRapidaId = id; $('#fotoRapida').click(); }
      else if (e.target.closest('[data-borrar]') && confirm(`¿Eliminar “${p.producto}”?`)) {
        inv = inv.filter(x => x.id !== id); promos.forEach(pr => { pr.productos = pr.productos.filter(x => x !== id); });
        seleccion.delete(id); reindexar(); renderTodo(); marcarCambios();
      }
    });
    // Arrastrar una foto sobre la miniatura de una fila
    filas.addEventListener('dragover', e => { const th = e.target.closest('.thumb'); if (th) { e.preventDefault(); th.classList.add('soltar'); } });
    filas.addEventListener('dragleave', e => { const th = e.target.closest('.thumb'); if (th) th.classList.remove('soltar'); });
    filas.addEventListener('drop', e => {
      const th = e.target.closest('.thumb'); if (!th) return; e.preventDefault();
      const f = e.dataTransfer.files[0]; if (f) asignarFotoRapida(Number(th.closest('.fila').dataset.id), f);
    });
    $('#fotoRapida').addEventListener('change', e => { const f = e.target.files[0]; if (f && fotoRapidaId) asignarFotoRapida(fotoRapidaId, f); e.target.value = ''; });

    // Editor de producto
    const fp = $('#formProducto');
    fp.addEventListener('input', e => { if (e.target.matches('[data-ed="precio"],[data-ed="descuento"],[data-ed="codigo"]')) actualizarFinalEditor(); });
    fp.addEventListener('change', e => { if (e.target.id === 'inputFotosEd') agregarFotosEditor(e.target.files); });
    fp.addEventListener('click', e => {
      const q = e.target.closest('[data-quitar-foto]'), h = e.target.closest('[data-hacer-principal]');
      if (q || h) {
        e.preventDefault(); leerEditor();
        const fotos = [edicion.imagen, ...edicion.galeria].filter(Boolean);
        if (q) fotos.splice(Number(q.dataset.quitarFoto), 1);
        if (h) { const i = Number(h.dataset.hacerPrincipal); fotos.unshift(fotos.splice(i, 1)[0]); }
        edicion.imagen = fotos[0] || ''; edicion.galeria = fotos.slice(1);
        renderEditor();
      }
      if (e.target.id === 'agregarUrlFoto') {
        e.preventDefault(); leerEditor();
        const u = VJ.urlSegura($('#urlFotoEd').value);
        if (!u || !/^https:/.test(u)) { aviso('Pega una URL que empiece con https:// y termine en una imagen.'); return; }
        if (!edicion.imagen) edicion.imagen = u; else edicion.galeria.push(u);
        renderEditor();
      }
    });
    fp.addEventListener('dragover', e => { const z = e.target.closest('#zonaFotos'); if (z) { e.preventDefault(); z.classList.add('activa'); } });
    fp.addEventListener('dragleave', e => { const z = e.target.closest('#zonaFotos'); if (z) z.classList.remove('activa'); });
    fp.addEventListener('drop', e => { const z = e.target.closest('#zonaFotos'); if (z) { e.preventDefault(); agregarFotosEditor(e.dataTransfer.files); } });
    $('#guardarProducto').addEventListener('click', guardarEditor);

    // Promociones
    $('#btnPromoMes').addEventListener('click', () => { const m = mesActual(); abrirPromo(null, { titulo: `Promociones de ${m.nombre}`, desde: m.desde, hasta: m.hasta }); });
    $('#btnPromoNueva').addEventListener('click', () => { const m = mesActual(1); abrirPromo(null, { desde: m.desde, hasta: m.hasta }); });
    $('#listaPromos').addEventListener('click', e => {
      const b = e.target.closest('[data-pr]'); if (!b) return;
      const id = b.closest('[data-promo-id]').dataset.promoId; const p = promos.find(x => x.id === id); if (!p) return;
      const a = b.dataset.pr;
      if (a === 'editar') abrirPromo(id);
      if (a === 'activar') { p.activo = !p.activo; reindexar(); renderTodo(); marcarCambios(); }
      if (a === 'duplicar') { const m = mesActual(1); const c = { ...JSON.parse(JSON.stringify(p)), id: idPromoUnico(p.titulo + ' copia'), titulo: p.titulo + ' (copia)', desde: m.desde, hasta: m.hasta }; promos.unshift(c); reindexar(); renderTodo(); marcarCambios(); }
      if (a === 'ver') { vista.q = ''; $('#fBuscar').value = ''; activarTab('productos'); seleccion.clear(); p.productos.forEach(x => porId.has(x) && seleccion.add(x)); vista.rapido = ''; renderTabla(); aviso(`${seleccion.size} productos de la promoción quedaron seleccionados.`); }
      if (a === 'borrar' && confirm(`¿Eliminar la promoción “${p.titulo || p.id}”?`)) { promos = promos.filter(x => x.id !== id); reindexar(); renderTodo(); marcarCambios(); }
    });
    const fpr = $('#formPromo');
    fpr.addEventListener('input', VJ.debounce(e => { if (e.target.id === 'buscarPromoProd') buscarParaPromo(e.target.value); }, 150));
    fpr.addEventListener('click', e => {
      const ag = e.target.closest('[data-agregar-prod]'), qt = e.target.closest('[data-quitar-prod]'), todos = e.target.closest('[data-agregar-todos]'), qb = e.target.closest('[data-quitar-banner]');
      if (!ag && !qt && !todos && !qb) return;
      e.preventDefault(); leerEditorPromo();
      const q = $('#buscarPromoProd') ? $('#buscarPromoProd').value : '';
      if (ag) edicionPromo.productos = [...new Set([...edicionPromo.productos, Number(ag.dataset.agregarProd)])];
      if (todos) edicionPromo.productos = [...new Set([...edicionPromo.productos, ...($('#resultadosPromo')._lista || []).map(p => p.id)])];
      if (qt) edicionPromo.productos = edicionPromo.productos.filter(id => id !== Number(qt.dataset.quitarProd));
      if (qb) edicionPromo[qb.dataset.quitarBanner === 'movil' ? 'imagenMovil' : 'imagen'] = '';
      renderEditorPromo();
      if (q) { $('#buscarPromoProd').value = q; buscarParaPromo(q); $('#buscarPromoProd').focus(); }
    });
    fpr.addEventListener('change', async e => {
      const inp = e.target.closest('[data-banner]'); if (!inp || !inp.files[0]) return;
      leerEditorPromo();
      const movil = inp.dataset.banner === 'movil';
      try {
        const idTmp = edicionPromo.id || idPromoUnico(edicionPromo.titulo || 'promo');
        const ruta = await prepararFotoPromo(idTmp, inp.files[0], movil);
        edicionPromo[movil ? 'imagenMovil' : 'imagen'] = ruta;
        renderEditorPromo();
      } catch (err) { aviso('No se pudo procesar la imagen: ' + err.message); }
    });
    $('#guardarPromo').addEventListener('click', guardarPromo);
    $('#excelDescuentos').addEventListener('change', e => { if (e.target.files[0]) analizarDescuentos(e.target.files[0]); });
    $('#vistaDescuentos').addEventListener('click', e => {
      if (e.target.id === 'aplicarDescuentos') aplicarDescuentos();
      if (e.target.id === 'cancelarDescuentos') { planDesc = null; $('#vistaDescuentos').innerHTML = ''; $('#excelDescuentos').value = ''; }
    });

    // Importar
    $('#excelProductos').addEventListener('change', e => { if (e.target.files[0]) analizarImport(e.target.files[0]); });
    $$('input[name="modoImport"]').forEach(r => r.addEventListener('change', () => { const f = $('#excelProductos').files[0]; if (f) analizarImport(f); }));
    $('#vistaImport').addEventListener('click', e => {
      if (e.target.id === 'aplicarImport') aplicarImport();
      if (e.target.id === 'cancelarImport') { planImport = null; $('#vistaImport').innerHTML = ''; $('#excelProductos').value = ''; }
    });
    $('#btnExportar').addEventListener('click', exportarExcel);

    // Fotos en lote
    $('#lotesFotos').addEventListener('change', e => { if (e.target.files.length) analizarFotos(e.target.files); });
    $('#vistaFotos').addEventListener('change', e => {
      const s = e.target.closest('[data-foto-lote]'); if (!s) return;
      const x = planFotos[Number(s.dataset.fotoLote)]; x.id = s.value ? Number(s.value) : null; x.por = s.value ? 'manual' : '';
      const ok = planFotos.filter(y => y.id).length; const b = $('#aplicarFotos'); b.disabled = !ok; b.textContent = `Asignar ${ok} foto${ok === 1 ? '' : 's'}`;
    });
    $('#vistaFotos').addEventListener('click', e => {
      if (e.target.id === 'aplicarFotos') aplicarFotos();
      if (e.target.id === 'cancelarFotos') { planFotos.forEach(x => URL.revokeObjectURL(x.url)); planFotos = []; $('#vistaFotos').innerHTML = ''; $('#lotesFotos').value = ''; }
    });

    // Conexión y respaldo
    $('#btnGuardarCfg').addEventListener('click', guardarCfg);
    $('#btnRecargarGH').addEventListener('click', recargarDesdeGH);
    $('#btnRespaldo').addEventListener('click', descargarRespaldo);
    $('#archivoRespaldo').addEventListener('change', e => { if (e.target.files[0]) restaurarRespaldo(e.target.files[0]); e.target.value = ''; });

    // Hojas
    document.addEventListener('click', e => {
      if (e.target.closest('[data-cerrar]') || e.target.id === 'velo') cerrarHojas();
      if (e.target.id === 'irConexion') { cerrarHojas(); activarTab('conexion'); }
      if (e.target.id === 'confirmarPublicar') publicar();
    });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') cerrarHojas(); });
    window.addEventListener('beforeunload', e => { if (!saliendo && estadoCambios().sucio) { e.preventDefault(); e.returnValue = ''; } });
  }

  /* ---------- Inicio ---------- */
  async function iniciar() {
    if (iniciado) return; iniciado = true;
    eventos(); cargarFormCfg();
    $('#filasProductos').innerHTML = '<div class="vacio-adm" style="margin:12px">Cargando productos…</div>';
    try {
      if (hayConexion()) {
        try { await cargar(true); }
        catch (e) { aviso('No se pudo leer desde GitHub (' + e.message + '). Se cargó la versión del sitio.', 6000); await cargar(false); }
      } else await cargar(false);
    } catch (e) {
      $('#filasProductos').innerHTML = `<div class="vacio-adm" style="margin:12px">No se pudieron cargar los productos: ${esc(e.message)}</div>`;
      return;
    }
    renderTodo(); marcarCambios(); ofrecerBorrador();
    if (!hayConexion()) aviso('Configura la conexión con GitHub (pestaña “Conexión y respaldo”) para poder publicar.', 5000);
  }

  // Sesión abierta en esta pestaña (al final, cuando todo está definido)
  sesion.removeItem('vj_admin'); // marca de la versión anterior
  const rolGuardado = sesion.getItem('vj_admin_rol');
  if (ROLES[rolGuardado]) entrar(rolGuardado);
})();
