/* =========================================================================
   Digimarket · Catálogo público (lectura de precios.json + promociones.json)
   ========================================================================= */
(function () {
  'use strict';
  const { TIENDA, CATEGORIAS, esc, dinero, dineroPartes, nombreCategoria } = VJ;
  const $ = (s, el = document) => el.querySelector(s);
  const POR_PAGINA = 60;
  const CLAVE_PEDIDO = 'vj_pedido_v2';
  const local = VJ.almacen('localStorage');
  const mqEscritorio = matchMedia('(min-width: 1024px)');
  const mqMovil = matchMedia('(max-width: 479px)');
  const reducirMov = matchMedia('(prefers-reduced-motion: reduce)');

  /* ---------- Estado ---------- */
  let productos = [];
  const porId = new Map();
  const textoBusq = new Map();
  let promos = [];
  let idxPromos = new Map();
  const precios = new Map(); // id → resultado de VJ.precioFinal (caché)

  const estado = { q: '', cat: '', marcas: new Set(), min: '', max: '', desc: 0, disp: false, orden: 'relevancia', pag: 1, promo: '', ofertas: false };
  let pedido = { items: {}, cliente: { nombre: '', telefono: '', direccion: '', nota: '' } };
  let avisosPedido = [];

  /* ---------- Carga de datos ---------- */
  async function cargarJSON(url) {
    const r = await fetch(url + '?v=' + Date.now(), { cache: 'no-store' });
    if (!r.ok) throw new Error(url + ' respondió ' + r.status);
    return { data: await r.json(), fecha: r.headers.get('last-modified') };
  }

  async function cargarDatos() {
    const [rp, rpr] = await Promise.allSettled([cargarJSON(TIENDA.archivoProductos), cargarJSON(TIENDA.archivoPromociones)]);
    if (rp.status !== 'fulfilled') throw rp.reason;
    const { productos: lista } = VJ.normalizarInventario(rp.value.data);
    productos = lista;
    porId.clear(); textoBusq.clear();
    for (const p of productos) { porId.set(p.id, p); textoBusq.set(p.id, VJ.textoIndexable(p)); }
    promos = rpr.status === 'fulfilled' ? VJ.normalizarPromociones(rpr.value.data) : [];
    idxPromos = VJ.indicePromos(promos);
    precios.clear();
    for (const p of productos) precios.set(p.id, VJ.precioFinal(p, idxPromos));
    const f = rp.value.fecha ? new Date(rp.value.fecha) : new Date();
    $('#actualizado').textContent = f.toLocaleString('es-VE', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
    $('#totalProductos').textContent = productos.length.toLocaleString('es-VE');
  }

  /* ---------- URL ↔ estado (enlaces compartibles) ---------- */
  function leerURL() {
    const u = new URLSearchParams(location.search);
    estado.q = u.get('q') || '';
    estado.cat = VJ.CATEGORIAS.some(c => c.id === u.get('cat')) ? u.get('cat') : '';
    estado.marcas = new Set((u.get('marca') || '').split('~').filter(Boolean));
    estado.min = u.get('min') || '';
    estado.max = u.get('max') || '';
    estado.desc = [0, 1, 10, 25, 50].includes(Number(u.get('desc'))) ? Number(u.get('desc')) : 0;
    estado.disp = u.get('disp') === '1';
    estado.orden = u.get('orden') || 'relevancia';
    estado.pag = Math.max(1, parseInt(u.get('pag'), 10) || 1);
    estado.promo = u.get('promo') || '';
    estado.ofertas = u.get('ofertas') === '1';
    return Number(u.get('p')) || 0;
  }
  function escribirURL(push) {
    const u = new URLSearchParams();
    if (estado.q) u.set('q', estado.q);
    if (estado.cat) u.set('cat', estado.cat);
    if (estado.marcas.size) u.set('marca', [...estado.marcas].join('~'));
    if (estado.min) u.set('min', estado.min);
    if (estado.max) u.set('max', estado.max);
    if (estado.desc) u.set('desc', estado.desc);
    if (estado.disp) u.set('disp', '1');
    if (estado.orden !== 'relevancia') u.set('orden', estado.orden);
    if (estado.pag > 1) u.set('pag', estado.pag);
    if (estado.promo) u.set('promo', estado.promo);
    if (estado.ofertas) u.set('ofertas', '1');
    const url = location.pathname + (u.toString() ? '?' + u : '');
    history[push ? 'pushState' : 'replaceState'](null, '', url);
  }
  const hayFiltros = () => !!(estado.q || estado.cat || estado.marcas.size || estado.min || estado.max || estado.desc || estado.disp || estado.promo || estado.ofertas);

  /* ---------- Filtrado y orden ---------- */
  function filtrar(excluir) {
    const terms = VJ.terminosBusqueda(estado.q);
    const min = VJ.parseNumero(estado.min), max = VJ.parseNumero(estado.max);
    const promo = estado.promo ? promos.find(p => p.id === estado.promo) : null;
    const enPromo = promo ? new Set(promo.productos) : null;
    return productos.filter(p => {
      const pr = precios.get(p.id);
      if (terms.length) { const t = textoBusq.get(p.id); for (const w of terms) if (!t.includes(w)) return false; }
      if (excluir !== 'cat' && estado.cat && p.categoria !== estado.cat) return false;
      if (excluir !== 'marca' && estado.marcas.size && !estado.marcas.has(p.marca)) return false;
      if (!isNaN(min) && pr.final < min) return false;
      if (!isNaN(max) && pr.final > max) return false;
      if (estado.desc && pr.descuento < Math.max(estado.desc, 0.1)) return false;
      if (estado.ofertas && pr.descuento <= 0) return false;
      if (estado.disp && p.stock <= 0) return false;
      if (enPromo && !enPromo.has(p.id)) return false;
      return true;
    });
  }

  function ordenar(lista) {
    const o = estado.orden;
    const nom = (a, b) => a.producto.localeCompare(b.producto, 'es');
    const pf = id => precios.get(id);
    const cmp = {
      'precio-asc': (a, b) => pf(a.id).final - pf(b.id).final || nom(a, b),
      'precio-desc': (a, b) => pf(b.id).final - pf(a.id).final || nom(a, b),
      'descuento-desc': (a, b) => pf(b.id).descuento - pf(a.id).descuento || nom(a, b),
      'producto-asc': nom,
      'producto-desc': (a, b) => nom(b, a),
      'stock-desc': (a, b) => b.stock - a.stock || nom(a, b)
    }[o];
    if (cmp) return lista.sort(cmp);
    // Relevancia: disponibles → destacados → con descuento → coincidencia al inicio del nombre → A-Z
    const terms = VJ.terminosBusqueda(estado.q);
    const puntos = p => {
      let s = 0;
      if (p.stock > 0) s += 1000;
      if (p.destacado) s += 300;
      s += Math.min(pf(p.id).descuento, 90) * 2;
      if (terms.length) {
        const n = VJ.normTexto(p.producto);
        if (n.startsWith(terms[0])) s += 120;
        else if (n.includes(' ' + terms[0])) s += 60;
        if (VJ.normTexto(p.marca).startsWith(terms[0])) s += 40;
        if (p.codigo && VJ.claveCodigo(p.codigo) === VJ.claveCodigo(estado.q)) s += 2000;
      }
      return s;
    };
    const cache = new Map(lista.map(p => [p.id, puntos(p)]));
    return lista.sort((a, b) => cache.get(b.id) - cache.get(a.id) || nom(a, b));
  }

  /* ---------- Plantillas ---------- */
  const PALETAS = { 'despensa': ['#fff2e6', '#c2410c'], 'bebidas': ['#e8f1ff', '#0033a0'], 'lacteos-embutidos': ['#fdf3e7', '#9a3412'], 'snacks-dulces': ['#fdecee', '#b5000c'], 'desayuno-cafe': ['#f5eee6', '#7c4a1e'], 'limpieza-hogar': ['#e8f7f4', '#0f766e'], 'cuidado-personal': ['#f3eefc', '#6d28d9'], 'bebes': ['#e9f6ff', '#0369a1'], 'otros': ['#eef1f6', '#475569'] };
  function marcadorSVG(p) {
    const [bg, fg] = PALETAS[p.categoria] || PALETAS.otros;
    const ini = (VJ.normTexto(p.marca || p.producto).split(' ').filter(Boolean).slice(0, 2).map(w => w[0]).join('') || '?').slice(0, 2);
    return `<svg class="placeholder" viewBox="0 0 100 100" role="img" aria-label="Sin foto: ${esc(p.producto)}"><rect width="100" height="100" rx="10" fill="${bg}"/><path d="M12 72c18 16 50 18 76-6" stroke="${fg}" stroke-opacity=".18" stroke-width="7" fill="none" stroke-linecap="round"/><text x="50" y="54" text-anchor="middle" font-family="Baloo 2, Figtree, sans-serif" font-size="30" font-weight="800" fill="${fg}">${esc(ini)}</text><text x="50" y="72" text-anchor="middle" font-family="Figtree, sans-serif" font-size="7.5" font-weight="600" fill="${fg}" fill-opacity=".75">${esc(nombreCategoria(p.categoria).toUpperCase())}</text></svg>`;
  }
  function imagenHTML(p, src, alt, eager) {
    const u = VJ.urlSegura(src);
    if (!u) return marcadorSVG(p);
    return `<img src="${esc(u)}" alt="${esc(alt || p.producto)}" ${eager ? '' : 'loading="lazy"'} decoding="async" data-fallback="${p.id}">`;
  }
  function precioHTML(valor) {
    const { entero, decimales } = dineroPartes(valor);
    return `<div class="precio" aria-label="${dinero(valor)}"><span class="simbolo">$</span><span class="entero">${entero}</span><span class="decimales">${decimales}</span></div>`;
  }
  function tarjetaHTML(p) {
    const pr = precios.get(p.id);
    const st = VJ.estadoStock(p.stock);
    const enCarrito = pedido.items[p.id] ? pedido.items[p.id].q : 0;
    return `<article class="tarjeta${pr.descuento ? ' con-descuento' : ''}${p.stock <= 0 ? ' agotado' : ''}" data-id="${p.id}">
      <button class="foto" data-accion="ver" aria-label="Ver detalle de ${esc(p.producto)}">
        ${pr.descuento ? `<span class="insignia-desc">-${pr.descuento}%</span>` : ''}
        ${p.destacado ? '<span class="insignia-dest">Destacado</span>' : ''}
        ${imagenHTML(p, p.imagen)}
      </button>
      <div class="cuerpo">
        <button class="nombre" data-accion="ver">${esc(p.producto)}</button>
        <div class="meta"><span>${esc(p.marca)}</span>${p.codigo ? `<span class="codigo">Cód. ${esc(p.codigo)}</span>` : ''}</div>
        ${precioHTML(pr.final)}
        ${pr.descuento ? `<div class="antes">Antes <s>${dinero(pr.base)}</s><span class="sep"> · </span><span class="ahorro">Ahorras ${dinero(pr.ahorro)}</span></div>` : ''}
        <div class="stock ${st.clase}">${st.texto}${enCarrito ? ` · ${enCarrito} en tu pedido` : ''}</div>
        <div class="acciones">
          <div class="cantidad">
            <button type="button" data-accion="menos" aria-label="Restar uno">−</button>
            <input type="number" inputmode="numeric" min="1" max="${Math.max(1, p.stock)}" value="1" aria-label="Cantidad de ${esc(p.producto)}">
            <button type="button" data-accion="mas" aria-label="Sumar uno">+</button>
          </div>
          <button class="btn-agregar" data-accion="agregar" ${p.stock <= 0 ? 'disabled' : ''}>${p.stock <= 0 ? 'Agotado' : 'Agregar'}</button>
        </div>
      </div>
    </article>`;
  }
  const esqueleto = n => Array.from({ length: n }, () => '<div class="tarjeta esqueleto" aria-hidden="true"><div class="foto"></div><div class="cuerpo"><div class="linea"></div><div class="linea" style="width:60%"></div><div class="linea" style="width:40%;height:22px"></div></div></div>').join('');

  /* ---------- Barra de categorías ---------- */
  function renderCategorias() {
    const hayOfertas = productos.some(p => precios.get(p.id).descuento > 0);
    const chips = [`<button class="chip" data-cat="" aria-pressed="${!estado.cat && !estado.ofertas && !estado.promo}">Todo</button>`];
    if (hayOfertas) chips.push(`<button class="chip oferta" data-ofertas="1" aria-pressed="${estado.ofertas}">Ofertas del mes</button>`);
    const presentes = new Set(productos.map(p => p.categoria));
    for (const c of CATEGORIAS) if (presentes.has(c.id)) chips.push(`<button class="chip" data-cat="${c.id}" aria-pressed="${estado.cat === c.id}">${esc(c.nombre)}</button>`);
    $('#barraCategorias').innerHTML = chips.join('');
    const sel = $('#buscarCategoria');
    sel.innerHTML = '<option value="">Todo</option>' + CATEGORIAS.filter(c => presentes.has(c.id)).map(c => `<option value="${c.id}">${esc(c.nombre)}</option>`).join('');
    sel.value = estado.cat;
  }

  /* ---------- Promociones (carrusel) ---------- */
  let autoPromo = null, indicePromo = 0, usuarioTocoPromo = false;
  function arteBanner(color) {
    // Evoca el logo: trazo de la "V" + curva + punto
    const curva = color === 'rojo' ? '#0033a0' : '#e30613';
    const v = color === 'rojo' ? '#f2434d' : '#1d4fc4';
    return `<svg class="banner-arte" viewBox="0 0 1600 460" preserveAspectRatio="xMaxYMid slice" aria-hidden="true">
      <path d="M1130 -30 L1290 520" stroke="${v}" stroke-width="120" stroke-linecap="round"/>
      <path d="M940 330 C1050 470 1330 440 1470 60" stroke="${curva}" stroke-width="44" fill="none" stroke-linecap="round"/>
      <circle cx="1500" cy="-2" r="40" fill="${curva}"/>
    </svg>`;
  }
  function fechaCorta(iso) {
    if (!iso) return '';
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(y, m - 1, d).toLocaleDateString('es-VE', { day: 'numeric', month: 'long' });
  }
  function renderPromos() {
    const activas = VJ.promosActivas(promos);
    const sec = $('#seccionPromos');
    if (!activas.length || hayFiltros()) { sec.hidden = true; detenerAuto(); return; }
    sec.hidden = false;
    $('#pistaPromos').innerHTML = activas.map(p => {
      const img = VJ.urlSegura(p.imagen), imgM = VJ.urlSegura(p.imagenMovil);
      const fechas = p.hasta ? `Válido hasta el ${fechaCorta(p.hasta)}` : '';
      const nProd = p.productos.filter(id => porId.has(id)).length;
      const cta = nProd ? `<span class="banner-cta">Ver ${nProd} producto${nProd === 1 ? '' : 's'}</span>` : '';
      if (img || imgM) {
        return `<button class="banner solo-imagen ${p.color}" data-promo="${esc(p.id)}" aria-label="${esc(p.titulo || 'Promoción')}${fechas ? '. ' + esc(fechas) : ''}">
          <picture>${imgM ? `<source media="(max-width: 767px)" srcset="${esc(imgM)}">` : ''}<img class="banner-img" src="${esc(img || imgM)}" alt="${esc(p.titulo)}" loading="eager"></picture>${cta}</button>`;
      }
      return `<button class="banner ${p.color}" data-promo="${esc(p.id)}">
        ${arteBanner(p.color)}
        <div class="banner-contenido">
          ${p.etiqueta ? `<span class="banner-etiqueta">${esc(p.etiqueta)}</span>` : (p.descuento ? `<span class="banner-etiqueta">-${p.descuento}%</span>` : '')}
          <h2>${esc(p.titulo || 'Promoción del mes')}</h2>
          ${p.descripcion ? `<p>${esc(p.descripcion)}</p>` : ''}
          ${fechas ? `<span class="banner-fechas">${esc(fechas)}</span>` : ''}
          ${cta}
        </div></button>`;
    }).join('');
    const multi = activas.length > 1;
    $('#promoPrev').hidden = $('#promoNext').hidden = !multi;
    $('#puntosPromos').innerHTML = multi ? activas.map((p, i) => `<button aria-label="Ir a la promoción ${i + 1}" data-ir="${i}" aria-current="${i === 0}"></button>`).join('') : '';
    indicePromo = 0;
    iniciarAuto();
  }
  function irPromo(i, suave = true) {
    const pista = $('#pistaPromos'); const n = pista.children.length; if (!n) return;
    indicePromo = (i + n) % n;
    pista.scrollTo({ left: pista.clientWidth * indicePromo, behavior: suave && !reducirMov.matches ? 'smooth' : 'auto' });
  }
  function iniciarAuto() {
    detenerAuto();
    if (reducirMov.matches || usuarioTocoPromo || $('#pistaPromos').children.length < 2) return;
    autoPromo = setInterval(() => { if (!document.hidden) irPromo(indicePromo + 1); }, 7000);
  }
  function detenerAuto() { clearInterval(autoPromo); autoPromo = null; }

  /* ---------- Fila de ofertas ---------- */
  function renderOfertas() {
    const sec = $('#seccionOfertas');
    if (hayFiltros()) { sec.hidden = true; return; }
    let lista = productos.filter(p => precios.get(p.id).descuento > 0 && p.stock > 0)
      .sort((a, b) => precios.get(b.id).descuento - precios.get(a.id).descuento).slice(0, 24);
    let titulo = 'Ofertas del mes';
    if (!lista.length) { lista = productos.filter(p => p.destacado && p.stock > 0).slice(0, 24); titulo = 'Destacados'; }
    if (!lista.length) { sec.hidden = true; return; }
    sec.hidden = false;
    $('#tituloOfertas').textContent = titulo;
    $('#verOfertas').dataset.modo = titulo === 'Destacados' ? 'destacados' : 'ofertas';
    $('#verOfertas').hidden = titulo === 'Destacados';
    $('#filaOfertas').innerHTML = lista.map(tarjetaHTML).join('');
  }

  /* ---------- Filtros ---------- */
  function contar(lista, campo) {
    const m = new Map();
    for (const p of lista) m.set(p[campo], (m.get(p[campo]) || 0) + 1);
    return m;
  }
  function filtrosHTML() {
    const porCat = contar(filtrar('cat'), 'categoria');
    const porMarca = contar(filtrar('marca'), 'marca');
    const marcas = [...porMarca.entries()].concat([...estado.marcas].filter(m => !porMarca.has(m)).map(m => [m, 0]))
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    const descOps = [[0, 'Todos'], [1, 'Con descuento'], [10, '10% o más'], [25, '25% o más'], [50, '50% o más']];
    return `
      <div class="filtro-grupo"><h3>Categoría</h3>
        <label class="opcion"><input type="radio" name="f-cat" value="" ${!estado.cat ? 'checked' : ''}><span>Todas</span></label>
        ${CATEGORIAS.filter(c => porCat.has(c.id) || estado.cat === c.id).map(c => `<label class="opcion"><input type="radio" name="f-cat" value="${c.id}" ${estado.cat === c.id ? 'checked' : ''}><span>${esc(c.nombre)}</span><small>${porCat.get(c.id) || 0}</small></label>`).join('')}
      </div>
      <div class="filtro-grupo"><h3>Marca</h3>
        <input class="marca-buscar" type="search" placeholder="Buscar marca" aria-label="Buscar marca" data-buscar-marca>
        <div class="lista-marcas">
          ${marcas.map(([m, n]) => `<label class="opcion" data-marca-nombre="${esc(VJ.normTexto(m))}"><input type="checkbox" data-f-marca value="${esc(m)}" ${estado.marcas.has(m) ? 'checked' : ''}><span>${esc(m || 'Sin marca')}</span><small>${n}</small></label>`).join('')}
        </div>
      </div>
      <div class="filtro-grupo"><h3>Precio (USD)</h3>
        <div class="rango">
          <input type="text" inputmode="decimal" placeholder="Mín" value="${esc(estado.min)}" data-f-min aria-label="Precio mínimo">
          <span>–</span>
          <input type="text" inputmode="decimal" placeholder="Máx" value="${esc(estado.max)}" data-f-max aria-label="Precio máximo">
        </div>
      </div>
      <div class="filtro-grupo"><h3>Descuento</h3>
        ${descOps.map(([v, t]) => `<label class="opcion"><input type="radio" name="f-desc" value="${v}" ${estado.desc === v ? 'checked' : ''}><span>${t}</span></label>`).join('')}
      </div>
      <div class="filtro-grupo"><h3>Disponibilidad</h3>
        <label class="opcion"><input type="checkbox" data-f-disp ${estado.disp ? 'checked' : ''}><span>Ocultar agotados</span></label>
      </div>
      <button class="btn-limpiar" type="button" data-limpiar>Limpiar filtros</button>`;
  }
  function renderFiltros() {
    const lateral = $('#filtrosLateral'), hoja = $('#filtrosHoja');
    const html = filtrosHTML();
    if (mqEscritorio.matches) { lateral.innerHTML = html; hoja.innerHTML = ''; }
    else { hoja.innerHTML = html; lateral.innerHTML = ''; }
  }
  function numFiltros() {
    return (estado.cat ? 1 : 0) + estado.marcas.size + (estado.min || estado.max ? 1 : 0) + (estado.desc ? 1 : 0) + (estado.disp ? 1 : 0) + (estado.promo ? 1 : 0) + (estado.ofertas ? 1 : 0);
  }
  function renderChips() {
    const chips = [];
    const x = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>';
    if (estado.q) chips.push(['q', `“${estado.q}”`]);
    if (estado.promo) { const p = promos.find(pp => pp.id === estado.promo); chips.push(['promo', 'Promoción: ' + (p ? p.titulo || p.id : estado.promo)]); }
    if (estado.ofertas) chips.push(['ofertas', 'Ofertas del mes']);
    if (estado.cat) chips.push(['cat', nombreCategoria(estado.cat)]);
    for (const m of estado.marcas) chips.push(['marca:' + m, m]);
    if (estado.min || estado.max) chips.push(['precio', `$${estado.min || '0'} – ${estado.max ? '$' + estado.max : 'más'}`]);
    if (estado.desc) chips.push(['desc', estado.desc === 1 ? 'Con descuento' : `${estado.desc}% o más`]);
    if (estado.disp) chips.push(['disp', 'Sin agotados']);
    $('#chipsActivos').innerHTML = chips.map(([k, t]) => `<button class="chip-activo" data-quitar="${esc(k)}" aria-label="Quitar filtro ${esc(t)}">${esc(t)} ${x}</button>`).join('')
      + (chips.length > 1 ? '<button class="enlace" data-limpiar>Limpiar todo</button>' : '');
    const n = numFiltros();
    const b = $('#numFiltros'); b.hidden = !n; b.textContent = n;
  }

  /* ---------- Listado ---------- */
  function tituloListado() {
    if (estado.promo) { const p = promos.find(pp => pp.id === estado.promo); return p ? (p.titulo || 'Promoción') : 'Promoción'; }
    if (estado.ofertas) return 'Ofertas del mes';
    if (estado.q) return `Resultados para “${estado.q}”`;
    if (estado.cat) return nombreCategoria(estado.cat);
    return 'Todos los productos';
  }
  function renderListado() {
    const lista = ordenar(filtrar());
    const total = lista.length;
    const paginas = Math.max(1, Math.ceil(total / POR_PAGINA));
    estado.pag = Math.min(estado.pag, paginas);
    const ini = (estado.pag - 1) * POR_PAGINA;
    const pagina = lista.slice(ini, ini + POR_PAGINA);
    $('#tituloListado').textContent = tituloListado();
    $('#totalResultados').innerHTML = total
      ? `<strong>${(ini + 1).toLocaleString('es-VE')}–${(ini + pagina.length).toLocaleString('es-VE')}</strong> de <strong>${total.toLocaleString('es-VE')}</strong> productos`
      : 'Sin resultados';
    const grid = $('#grid');
    grid.setAttribute('aria-busy', 'false');
    grid.innerHTML = total ? pagina.map(tarjetaHTML).join('')
      : `<div class="vacio" style="grid-column:1/-1"><h3>No encontramos productos con esos filtros</h3><p>Prueba con otra palabra, revisa la ortografía o quita algún filtro.</p><button class="btn btn-azul" data-limpiar>Ver todos los productos</button></div>`;
    renderPaginacion(paginas);
  }
  function renderPaginacion(paginas) {
    const nav = $('#paginacion');
    if (paginas <= 1) { nav.innerHTML = ''; return; }
    const p = estado.pag, ventana = mqMovil.matches ? 1 : 2;
    const nums = new Set([1, paginas]);
    for (let i = p - ventana; i <= p + ventana; i++) if (i > 1 && i < paginas) nums.add(i);
    const orden = [...nums].sort((a, b) => a - b);
    let html = `<button data-pag="${p - 1}" ${p <= 1 ? 'disabled' : ''} aria-label="Página anterior">‹ <span class="sr-only">Anterior</span></button>`;
    let prev = 0;
    for (const n of orden) {
      if (n - prev > 1) html += '<span class="puntos">…</span>';
      html += `<button data-pag="${n}" ${n === p ? 'aria-current="page"' : ''}>${n}</button>`;
      prev = n;
    }
    html += `<button data-pag="${p + 1}" ${p >= paginas ? 'disabled' : ''} aria-label="Página siguiente"><span class="sr-only">Siguiente</span> ›</button>`;
    nav.innerHTML = html;
  }

  function render(opts = {}) {
    renderCategorias();
    renderPromos();
    renderOfertas();
    renderFiltros();
    renderChips();
    renderListado();
    escribirURL(opts.push);
    if (opts.scroll) $('#catalogo').scrollIntoView({ behavior: reducirMov.matches ? 'auto' : 'smooth', block: 'start' });
  }
  const aplicar = (cambios, opts = { scroll: false }) => { Object.assign(estado, cambios); if (!('pag' in cambios)) estado.pag = 1; render(opts); };

  /* ---------- Detalle ---------- */
  function abrirDetalle(id) {
    const p = porId.get(id); if (!p) return;
    const pr = precios.get(p.id), st = VJ.estadoStock(p.stock);
    const fotos = [p.imagen, ...p.galeria].map(u => VJ.urlSegura(u)).filter(Boolean);
    const promoTxt = pr.promo && pr.fuente === 'promo' ? `<span class="promo-nota">${esc(pr.promo.titulo || 'Promoción')}${pr.promo.hasta ? ' · hasta el ' + esc(fechaCorta(pr.promo.hasta)) : ''}</span>` : '';
    $('#contenidoDetalle').innerHTML = `
      <div class="detalle tarjeta-detalle" data-id="${p.id}">
        <div>
          <div class="galeria-principal">${pr.descuento ? `<span class="insignia-desc">-${pr.descuento}%</span>` : ''}<span id="fotoGrande">${fotos.length ? imagenHTML(p, fotos[0], p.producto, true) : marcadorSVG(p)}</span></div>
          ${fotos.length > 1 ? `<div class="miniaturas">${fotos.map((f, i) => `<button data-foto="${esc(f)}" aria-current="${i === 0}" aria-label="Foto ${i + 1}"><img src="${esc(f)}" alt="" loading="lazy"></button>`).join('')}</div>` : ''}
        </div>
        <div>
          <div class="meta" style="margin-bottom:6px"><span>${esc(p.marca)}</span><span>·</span><span>${esc(nombreCategoria(p.categoria))}</span></div>
          <h3>${esc(p.producto)}</h3>
          <div style="margin-top:12px" class="${pr.descuento ? 'con-descuento' : ''}">
            ${pr.descuento ? `<div style="color:var(--rojo-700);font-weight:800;font-size:15px">-${pr.descuento}% de descuento</div>` : ''}
            <div style="${pr.descuento ? 'color:var(--rojo-700)' : ''}">${precioHTML(pr.final)}</div>
            ${pr.descuento ? `<div class="antes">Precio regular <s>${dinero(pr.base)}</s> · <span class="ahorro">Ahorras ${dinero(pr.ahorro)}</span></div>` : ''}
            ${promoTxt}
          </div>
          <div class="stock ${st.clase}" style="margin-top:10px;font-size:14px">${st.texto}${p.stock > 0 ? ` · ${p.stock.toLocaleString('es-VE')} unidades` : ''}</div>
          <div class="acciones" style="margin-top:14px">
            <div class="cantidad">
              <button type="button" data-accion="menos" aria-label="Restar uno">−</button>
              <input type="number" inputmode="numeric" min="1" max="${Math.max(1, p.stock)}" value="1" aria-label="Cantidad">
              <button type="button" data-accion="mas" aria-label="Sumar uno">+</button>
            </div>
            <button class="btn-agregar" data-accion="agregar" ${p.stock <= 0 ? 'disabled' : ''}>${p.stock <= 0 ? 'Agotado' : 'Agregar al pedido'}</button>
          </div>
          <dl class="ficha">
            ${p.codigo ? `<dt>Código</dt><dd>${esc(p.codigo)}</dd>` : ''}
            <dt>Marca</dt><dd>${esc(p.marca || '—')}</dd>
            <dt>Categoría</dt><dd>${esc(nombreCategoria(p.categoria))}</dd>
          </dl>
          ${p.descripcion ? `<p class="descripcion">${esc(p.descripcion)}</p>` : ''}
        </div>
      </div>`;
    abrirHoja('#hojaDetalle');
    const u = new URL(location.href); u.searchParams.set('p', p.id); history.replaceState(null, '', u);
  }

  /* ---------- Pedido (carrito) ---------- */
  function guardarPedido() {
    try {
      const vacio = !Object.keys(pedido.items).length && !Object.values(pedido.cliente).some(v => String(v || '').trim());
      if (vacio) local.removeItem(CLAVE_PEDIDO); else local.setItem(CLAVE_PEDIDO, JSON.stringify(pedido));
    } catch (e) {}
  }
  function cargarPedido() {
    try {
      const d = JSON.parse(local.getItem(CLAVE_PEDIDO) || 'null');
      if (d && d.items) pedido = { items: d.items, cliente: Object.assign(pedido.cliente, d.cliente || {}) };
    } catch (e) {}
    // Pedido de la versión anterior (sessionStorage) — se migra si existe
    try {
      const viejo = JSON.parse(sessionStorage.getItem('digimarket_cart_v1') || 'null');
      if (viejo && !Object.keys(pedido.items).length) {
        for (const [id, it] of Object.entries(viejo)) pedido.items[id] = { q: it.qty, firma: VJ.firmaProducto(it), nombre: it.producto, precioC: VJ.centavos(it.precio) };
      }
      sessionStorage.removeItem('digimarket_cart_v1');
    } catch (e) {}
  }
  // Compara cada línea guardada con el inventario actual: si el ID ya no
  // corresponde al mismo producto (firma distinta) se elimina en vez de cruzarlo.
  function reconciliarPedido() {
    avisosPedido = [];
    for (const [idTxt, it] of Object.entries(pedido.items)) {
      const p = porId.get(Number(idTxt));
      if (!p || (it.firma && it.firma !== VJ.firmaProducto(p))) {
        avisosPedido.push(`“${it.nombre || 'Un producto'}” ya no está en el catálogo y se quitó del pedido.`);
        delete pedido.items[idTxt]; continue;
      }
      if (p.stock <= 0) { avisosPedido.push(`“${p.producto}” se agotó y se quitó del pedido.`); delete pedido.items[idTxt]; continue; }
      if (it.q > p.stock) { avisosPedido.push(`Solo quedan ${p.stock} de “${p.producto}”; ajustamos la cantidad.`); it.q = p.stock; }
      const actual = precios.get(p.id).finalC;
      if (it.precioC != null && it.precioC !== actual) avisosPedido.push(`El precio de “${p.producto}” cambió a ${dinero(actual / 100)}.`);
      it.precioC = actual; it.firma = VJ.firmaProducto(p); it.nombre = p.producto;
    }
    guardarPedido();
  }
  const lineasPedido = () => Object.entries(pedido.items).map(([id, it]) => ({ p: porId.get(Number(id)), q: it.q })).filter(l => l.p);
  function totales() {
    let unidades = 0, baseC = 0, finalC = 0;
    for (const { p, q } of lineasPedido()) {
      const pr = precios.get(p.id);
      unidades += q; baseC += VJ.centavos(pr.base) * q; finalC += pr.finalC * q;
    }
    return { unidades, base: baseC / 100, final: finalC / 100, ahorro: (baseC - finalC) / 100 };
  }
  function actualizarContador(saltar) {
    const c = $('#contadorCarrito'); const n = totales().unidades;
    c.hidden = !n; c.textContent = n > 999 ? '999+' : n;
    if (saltar && !reducirMov.matches) { c.classList.remove('salto'); void c.offsetWidth; c.classList.add('salto'); }
  }
  function agregar(id, q) {
    const p = porId.get(id); if (!p || p.stock <= 0) return false;
    const it = pedido.items[id] || { q: 0 };
    const nuevo = Math.min(p.stock, it.q + q);
    if (it.q + q > p.stock) aviso(`Solo hay ${p.stock} unidades de este producto.`);
    pedido.items[id] = { q: nuevo, firma: VJ.firmaProducto(p), nombre: p.producto, precioC: precios.get(id).finalC };
    guardarPedido(); actualizarContador(true);
    return true;
  }
  function cambiarCantidad(id, q) {
    const p = porId.get(id); if (!p || !pedido.items[id]) return;
    if (q <= 0) delete pedido.items[id];
    else pedido.items[id].q = Math.min(q, p.stock);
    guardarPedido(); actualizarContador(); renderCarrito();
  }
  function renderCarrito() {
    const cuerpo = $('#contenidoCarrito'), pie = $('#pieCarrito');
    const lineas = lineasPedido();
    const avisos = avisosPedido.length ? `<div class="aviso">${avisosPedido.map(esc).join('<br>')}</div>` : '';
    if (!lineas.length) {
      cuerpo.innerHTML = avisos + `<div class="vacio" style="box-shadow:none"><h3>Tu pedido está vacío</h3><p>Agrega productos desde el catálogo con el botón “Agregar”.</p><button class="btn btn-azul" data-cerrar>Seguir comprando</button></div>`;
      pie.innerHTML = ''; return;
    }
    const t = totales();
    cuerpo.innerHTML = avisos + lineas.map(({ p, q }) => {
      const pr = precios.get(p.id);
      return `<div class="linea-pedido tarjeta-linea" data-id="${p.id}">
        <div class="mini">${imagenHTML(p, p.imagen)}</div>
        <div>
          <div class="n">${esc(p.producto)}</div>
          <div class="s">${esc(p.marca)}${p.codigo ? ' · Cód. ' + esc(p.codigo) : ''} · ${dinero(pr.final)} c/u${pr.descuento ? ` <span class="ahorro">(-${pr.descuento}%)</span>` : ''}</div>
          <div class="cantidad">
            <button type="button" data-linea="menos" aria-label="Restar uno">−</button>
            <input type="number" inputmode="numeric" min="0" max="${p.stock}" value="${q}" data-linea="valor" aria-label="Cantidad de ${esc(p.producto)}">
            <button type="button" data-linea="mas" aria-label="Sumar uno">+</button>
          </div>
        </div>
        <div class="total-linea">${dinero(pr.finalC * q / 100)}${pr.descuento ? `<s>${dinero(VJ.centavos(pr.base) * q / 100)}</s>` : ''}<button class="btn-quitar" data-linea="quitar">Quitar</button></div>
      </div>`;
    }).join('') + `
      <div style="margin-top:16px">
        <label class="campo"><span>Nombre</span><input data-cliente="nombre" value="${esc(pedido.cliente.nombre)}" autocomplete="name" placeholder="¿A nombre de quién?"></label>
        <label class="campo"><span>Teléfono</span><input data-cliente="telefono" type="tel" value="${esc(pedido.cliente.telefono)}" autocomplete="tel" placeholder="0414-0000000"></label>
        <label class="campo"><span>Dirección de entrega</span><input data-cliente="direccion" value="${esc(pedido.cliente.direccion)}" autocomplete="street-address" placeholder="Calle, casa, punto de referencia"></label>
        <label class="campo"><span>Nota (opcional)</span><textarea data-cliente="nota" placeholder="Indicaciones para tu pedido">${esc(pedido.cliente.nota)}</textarea></label>
      </div>`;
    pie.innerHTML = `
      <div class="resumen">
        <div><span>Artículos</span><strong>${t.unidades.toLocaleString('es-VE')}</strong></div>
        ${t.ahorro > 0 ? `<div><span>Subtotal</span><span>${dinero(t.base)}</span></div><div class="ahorro-total"><span>Ahorro por promociones</span><span>-${dinero(t.ahorro)}</span></div>` : ''}
        <div class="gran-total"><span>Total</span><span>${dinero(t.final)}</span></div>
      </div>
      <div class="botones-pedido">
        ${TIENDA.whatsapp ? '<button class="btn btn-primario btn-ancho" data-pedido="whatsapp">Enviar por WhatsApp</button>' : ''}
        <button class="btn ${TIENDA.whatsapp ? 'btn-azul' : 'btn-primario'}" data-pedido="imagen">Descargar pedido</button>
        <button class="btn" data-pedido="copiar">Copiar texto</button>
        <button class="btn btn-ancho" data-pedido="vaciar" style="height:38px;font-size:13px;color:var(--gris)">Vaciar pedido</button>
      </div>`;
  }
  function textoPedido() {
    const t = totales(), c = pedido.cliente;
    const l = [`*Pedido ${TIENDA.nombre}*`, new Date().toLocaleString('es-VE'), ''];
    if (c.nombre) l.push('Cliente: ' + c.nombre);
    if (c.telefono) l.push('Teléfono: ' + c.telefono);
    if (c.direccion) l.push('Dirección: ' + c.direccion);
    if (c.nombre || c.telefono || c.direccion) l.push('');
    for (const { p, q } of lineasPedido()) {
      const pr = precios.get(p.id);
      l.push(`• ${q} × ${p.producto}${p.codigo ? ' [' + p.codigo + ']' : ''} — ${dinero(pr.final)} = ${dinero(pr.finalC * q / 100)}`);
    }
    l.push('');
    if (t.ahorro > 0) l.push('Ahorro: ' + dinero(t.ahorro));
    l.push('*Total: ' + dinero(t.final) + '*');
    if (c.nota) l.push('', 'Nota: ' + c.nota);
    return l.join('\n');
  }
  async function descargarPedido(btn) {
    if (typeof html2canvas !== 'function') { aviso('La descarga aún está cargando, intenta de nuevo en un momento.'); return; }
    const t = totales(), c = pedido.cliente;
    const cap = $('#pedidoCaptura');
    cap.innerHTML = `<div class="cab"><img src="logo.png" alt=""><div><h2>${esc(TIENDA.nombre)}</h2><div style="color:var(--gris);font-size:13px">Pedido · ${esc(new Date().toLocaleString('es-VE', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }))}</div></div></div>
      ${c.nombre || c.telefono || c.direccion ? `<div style="font-size:14px;margin-bottom:12px">${c.nombre ? `<div><strong>Cliente:</strong> ${esc(c.nombre)}</div>` : ''}${c.telefono ? `<div><strong>Teléfono:</strong> ${esc(c.telefono)}</div>` : ''}${c.direccion ? `<div><strong>Dirección:</strong> ${esc(c.direccion)}</div>` : ''}</div>` : ''}
      <table><thead><tr><th>Producto</th><th class="num">Cant.</th><th class="num">Precio</th><th class="num">Total</th></tr></thead><tbody>
      ${lineasPedido().map(({ p, q }) => { const pr = precios.get(p.id); return `<tr><td>${esc(p.producto)}<div style="color:var(--gris);font-size:11.5px">${esc(p.marca)}${p.codigo ? ' · Cód. ' + esc(p.codigo) : ''}${pr.descuento ? ' · -' + pr.descuento + '%' : ''}</div></td><td class="num">${q}</td><td class="num">${dinero(pr.final)}</td><td class="num">${dinero(pr.finalC * q / 100)}</td></tr>`; }).join('')}
      </tbody></table>
      <div style="display:flex;justify-content:space-between;margin-top:12px;font-size:14px"><span>Artículos: ${t.unidades}</span>${t.ahorro > 0 ? `<span style="color:var(--rojo-700)">Ahorro: ${dinero(t.ahorro)}</span>` : ''}</div>
      <div style="display:flex;justify-content:space-between;margin-top:8px;border-top:2px solid var(--linea);padding-top:10px"><strong style="font-size:18px">Total</strong><span class="tot">${dinero(t.final)}</span></div>
      ${c.nota ? `<div style="margin-top:10px;font-size:13px"><strong>Nota:</strong> ${esc(c.nota)}</div>` : ''}
      <div style="margin-top:14px;font-size:11px;color:var(--gris)">Solicitud de pedido sujeta a confirmación de disponibilidad y precio. ${esc((window.VJ_LEGAL && VJ_LEGAL.empresa.razon) || '')} · RIF ${esc((window.VJ_LEGAL && VJ_LEGAL.empresa.rif) || '')}</div>`;
    btn.disabled = true; const txt = btn.textContent; btn.textContent = 'Generando…';
    try {
      const canvas = await html2canvas(cap, { backgroundColor: '#ffffff', scale: 2, useCORS: true });
      const a = document.createElement('a');
      a.download = `pedido-${TIENDA.nombre.toLowerCase()}-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.png`;
      a.href = canvas.toDataURL('image/png'); a.click();
      aviso('Pedido descargado como imagen.');
    } catch (e) { aviso('No se pudo generar la imagen: ' + e.message); }
    finally { btn.disabled = false; btn.textContent = txt; }
  }

  /* ---------- Hojas (modales) ---------- */
  let ultimoFoco = null;
  function abrirHoja(sel) {
    document.querySelectorAll('.hoja.abierta').forEach(h => h.classList.remove('abierta'));
    const h = $(sel);
    ultimoFoco = document.activeElement;
    h.classList.add('abierta'); $('#velo').classList.add('abierto');
    document.body.style.overflow = 'hidden';
    setTimeout(() => { const f = h.querySelector('.btn-cerrar'); f && f.focus({ preventScroll: true }); }, 60);
  }
  function cerrarHojas() {
    const detalleAbierto = $('#hojaDetalle').classList.contains('abierta');
    document.querySelectorAll('.hoja.abierta').forEach(h => h.classList.remove('abierta'));
    $('#velo').classList.remove('abierto');
    document.body.style.overflow = '';
    if (detalleAbierto) { const u = new URL(location.href); u.searchParams.delete('p'); history.replaceState(null, '', u); }
    if (ultimoFoco && ultimoFoco.focus) ultimoFoco.focus({ preventScroll: true });
  }

  let tAviso;
  function aviso(t) { const a = $('#avisoFlotante'); a.textContent = t; a.classList.add('visible'); clearTimeout(tAviso); tAviso = setTimeout(() => a.classList.remove('visible'), 2600); }

  /* ---------- Eventos ---------- */
  function cantidadDe(contenedor) {
    const inp = contenedor.querySelector('.cantidad input');
    return { inp, val: Math.max(1, parseInt(inp && inp.value, 10) || 1) };
  }
  function eventos() {
    // Búsqueda
    const buscar = $('#buscar');
    buscar.value = estado.q;
    const alBuscar = VJ.debounce(() => aplicar({ q: buscar.value.trim() }), 220);
    buscar.addEventListener('input', alBuscar);
    $('#formBuscar').addEventListener('submit', e => { e.preventDefault(); aplicar({ q: buscar.value.trim() }, { scroll: true }); buscar.blur(); });
    $('#buscarCategoria').addEventListener('change', e => aplicar({ cat: e.target.value, ofertas: false, promo: '' }));
    $('#orden').value = estado.orden;
    $('#orden').addEventListener('change', e => aplicar({ orden: e.target.value }));

    // Delegación global de clics
    document.addEventListener('click', e => {
      const t = e.target;
      if (t.closest('[data-recargar]')) { location.reload(); return; }
      const chip = t.closest('.subnav .chip');
      if (chip) {
        if (chip.dataset.ofertas) aplicar({ ofertas: !estado.ofertas, cat: '', promo: '' }, { scroll: true });
        else aplicar({ cat: chip.dataset.cat, ofertas: false, promo: '' }, { scroll: !!chip.dataset.cat });
        return;
      }
      const ban = t.closest('[data-promo]');
      if (ban) { aplicar({ promo: ban.dataset.promo, cat: '', ofertas: false, q: '' }, { scroll: true, push: true }); $('#buscar').value = ''; return; }
      if (t.closest('#verOfertas')) { aplicar({ ofertas: true, cat: '', promo: '' }, { scroll: true }); return; }
      if (t.closest('[data-limpiar]')) { estado.marcas = new Set(); $('#buscar').value = ''; aplicar({ q: '', cat: '', min: '', max: '', desc: 0, disp: false, promo: '', ofertas: false }, { scroll: true }); return; }
      const quitar = t.closest('[data-quitar]');
      if (quitar) {
        const k = quitar.dataset.quitar;
        if (k.startsWith('marca:')) { estado.marcas.delete(k.slice(6)); aplicar({}); }
        else if (k === 'q') { $('#buscar').value = ''; aplicar({ q: '' }); }
        else if (k === 'precio') aplicar({ min: '', max: '' });
        else aplicar({ [k]: k === 'desc' ? 0 : (k === 'disp' || k === 'ofertas' ? false : '') });
        return;
      }
      const pag = t.closest('[data-pag]');
      if (pag && !pag.disabled) { aplicar({ pag: Number(pag.dataset.pag) }, { scroll: true }); return; }
      if (t.closest('[data-cerrar]') || t.id === 'velo') { cerrarHojas(); return; }
      const foto = t.closest('[data-foto]');
      if (foto) {
        const cont = foto.closest('.detalle'); const p = porId.get(Number(cont.dataset.id));
        $('#fotoGrande').innerHTML = imagenHTML(p, foto.dataset.foto, p.producto, true);
        cont.querySelectorAll('[data-foto]').forEach(b => b.setAttribute('aria-current', b === foto));
        return;
      }

      // Acciones en tarjetas (siempre por data-id del contenedor)
      const acc = t.closest('[data-accion]');
      if (acc) {
        const cont = acc.closest('[data-id]'); if (!cont) return;
        const id = Number(cont.dataset.id);
        const p = porId.get(id); if (!p) return;
        const a = acc.dataset.accion;
        if (a === 'ver') { abrirDetalle(id); return; }
        const { inp, val } = cantidadDe(cont);
        if (a === 'mas') inp.value = Math.min(Math.max(1, p.stock), val + 1);
        if (a === 'menos') inp.value = Math.max(1, val - 1);
        if (a === 'agregar' && agregar(id, val)) {
          acc.classList.add('listo'); acc.textContent = '✓ Agregado';
          inp.value = 1;
          setTimeout(() => { acc.classList.remove('listo'); acc.textContent = cont.closest('.detalle') ? 'Agregar al pedido' : 'Agregar'; }, 1300);
          document.querySelectorAll(`.tarjeta[data-id="${id}"] .stock`).forEach(s => {
            const st = VJ.estadoStock(p.stock); s.textContent = `${st.texto} · ${pedido.items[id].q} en tu pedido`;
          });
        }
        return;
      }

      // Líneas del pedido
      const lin = t.closest('[data-linea]');
      if (lin && lin.dataset.linea !== 'valor') {
        const id = Number(lin.closest('[data-id]').dataset.id);
        const it = pedido.items[id]; if (!it) return;
        if (lin.dataset.linea === 'mas') cambiarCantidad(id, it.q + 1);
        if (lin.dataset.linea === 'menos') cambiarCantidad(id, it.q - 1);
        if (lin.dataset.linea === 'quitar') cambiarCantidad(id, 0);
        return;
      }
      const ped = t.closest('[data-pedido]');
      if (ped) {
        const a = ped.dataset.pedido;
        if (a === 'vaciar' && confirm('¿Vaciar todo el pedido?')) { pedido.items = {}; avisosPedido = []; guardarPedido(); actualizarContador(); renderCarrito(); renderListado(); }
        if (a === 'copiar') navigator.clipboard?.writeText(textoPedido()).then(() => aviso('Pedido copiado. Pégalo en tu chat.'), () => aviso('No se pudo copiar.'));
        if (a === 'imagen') descargarPedido(ped);
        if (a === 'whatsapp') window.open(`https://wa.me/${TIENDA.whatsapp}?text=${encodeURIComponent(textoPedido())}`, '_blank', 'noopener');
      }
    });

    // Imágenes rotas → marcador
    document.addEventListener('error', e => {
      const img = e.target;
      if (img.tagName === 'IMG' && img.dataset.fallback) {
        const p = porId.get(Number(img.dataset.fallback));
        if (p) img.outerHTML = marcadorSVG(p);
      }
    }, true);

    // Cambios en filtros y cantidades
    document.addEventListener('change', e => {
      const t = e.target;
      if (t.name === 'f-cat') aplicar({ cat: t.value, ofertas: false });
      else if (t.name === 'f-desc') aplicar({ desc: Number(t.value) });
      else if (t.matches('[data-f-marca]')) { t.checked ? estado.marcas.add(t.value) : estado.marcas.delete(t.value); aplicar({}); }
      else if (t.matches('[data-f-disp]')) aplicar({ disp: t.checked });
      else if (t.matches('[data-f-min]') || t.matches('[data-f-max]')) {
        const v = VJ.parseNumero(t.value);
        aplicar({ [t.matches('[data-f-min]') ? 'min' : 'max']: isNaN(v) ? '' : String(v) });
      }
      else if (t.matches('[data-linea="valor"]')) cambiarCantidad(Number(t.closest('[data-id]').dataset.id), parseInt(t.value, 10) || 0);
      else if (t.matches('.cantidad input')) {
        const cont = t.closest('[data-id]'); const p = cont && porId.get(Number(cont.dataset.id));
        if (p) t.value = Math.min(Math.max(1, p.stock), Math.max(1, parseInt(t.value, 10) || 1));
      }
    });
    document.addEventListener('input', e => {
      const t = e.target;
      if (t.matches('[data-buscar-marca]')) {
        const q = VJ.normTexto(t.value);
        t.parentElement.querySelectorAll('[data-marca-nombre]').forEach(l => { l.hidden = q && !l.dataset.marcaNombre.includes(q); });
      }
      if (t.matches('[data-cliente]')) { pedido.cliente[t.dataset.cliente] = t.value; guardarPedido(); }
    });
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') cerrarHojas();
      if (e.key === 'Enter' && e.target.matches('[data-f-min],[data-f-max]')) e.target.blur();
    });

    $('#abrirCarrito').addEventListener('click', () => { reconciliarPedido(); renderCarrito(); abrirHoja('#hojaCarrito'); });
    $('#abrirFiltros').addEventListener('click', () => { renderFiltros(); abrirHoja('#hojaFiltros'); });

    // Carrusel
    const pista = $('#pistaPromos');
    $('#promoPrev').addEventListener('click', () => { usuarioTocoPromo = true; detenerAuto(); irPromo(indicePromo - 1); });
    $('#promoNext').addEventListener('click', () => { usuarioTocoPromo = true; detenerAuto(); irPromo(indicePromo + 1); });
    $('#puntosPromos').addEventListener('click', e => { const b = e.target.closest('[data-ir]'); if (b) { usuarioTocoPromo = true; detenerAuto(); irPromo(Number(b.dataset.ir)); } });
    pista.addEventListener('pointerdown', () => { usuarioTocoPromo = true; detenerAuto(); });
    pista.addEventListener('scroll', VJ.debounce(() => {
      indicePromo = Math.round(pista.scrollLeft / Math.max(1, pista.clientWidth));
      document.querySelectorAll('#puntosPromos button').forEach((b, i) => b.setAttribute('aria-current', i === indicePromo));
    }, 60), { passive: true });
    $('#seccionPromos').addEventListener('mouseenter', detenerAuto);
    $('#seccionPromos').addEventListener('mouseleave', iniciarAuto);

    mqEscritorio.addEventListener('change', () => { if (mqEscritorio.matches && $('#hojaFiltros').classList.contains('abierta')) cerrarHojas(); renderFiltros(); });
    mqMovil.addEventListener('change', () => renderListado());
    window.addEventListener('resize', VJ.debounce(() => irPromo(indicePromo, false), 150));
    window.addEventListener('popstate', () => { leerURL(); $('#buscar').value = estado.q; $('#orden').value = estado.orden; render(); });
    window.addEventListener('storage', e => { if (e.key === CLAVE_PEDIDO) { cargarPedido(); actualizarContador(); } });
  }

  /* ---------- Inicio ---------- */
  (async function iniciar() {
    $('#nombreTienda').textContent = $('#pieNombre').textContent = TIENDA.nombre;
    $('#sloganTienda').textContent = $('#pieSlogan').textContent = TIENDA.slogan;
    $('#grid').innerHTML = esqueleto(12);
    const abrirP = leerURL();
    cargarPedido();
    eventos();
    try {
      await cargarDatos();
    } catch (e) {
      console.error(e);
      $('#grid').innerHTML = `<div class="vacio" style="grid-column:1/-1"><h3>No se pudo cargar el catálogo</h3><p>Revisa tu conexión y recarga la página. Si el problema continúa, verifica que el archivo ${esc(TIENDA.archivoProductos)} exista en el repositorio.</p><button class="btn btn-azul" data-recargar>Recargar</button></div>`;
      $('#totalResultados').textContent = 'Sin datos';
      return;
    }
    reconciliarPedido();
    render();
    actualizarContador();
    if (abrirP && porId.has(abrirP)) abrirDetalle(abrirP);
  })();
})();
