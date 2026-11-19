/* =========================================================================
   Digimarket · Venejugos — núcleo compartido (catálogo y panel admin)
   Todo lo que toca datos pasa por aquí: normalización, IDs, precios finales,
   categorías y utilidades. Una sola fuente de verdad = cero cruces.
   ========================================================================= */
(function (global) {
  'use strict';

  /* ---------- Configuración de la tienda (edita aquí) ---------- */
  const TIENDA = {
    nombre: 'Digimarket',
    slogan: 'Tu comida en la puerta de tu casa',
    moneda: 'USD',
    // Número de WhatsApp para recibir pedidos, solo dígitos con código de país
    // (ej. '584141234567'). Déjalo vacío para ocultar el botón.
    whatsapp: '',
    stockBajo: 10,
    archivoProductos: 'precios.json',
    archivoPromociones: 'promociones.json',
    carpetaImgProductos: 'img/productos',
    carpetaImgPromos: 'img/promociones'
  };

  /* ---------- Categorías ---------- */
  const CATEGORIAS = [
    { id: 'despensa',          nombre: 'Despensa' },
    { id: 'bebidas',           nombre: 'Bebidas' },
    { id: 'lacteos-embutidos', nombre: 'Lácteos y charcutería' },
    { id: 'snacks-dulces',     nombre: 'Snacks y dulces' },
    { id: 'desayuno-cafe',     nombre: 'Desayuno y café' },
    { id: 'limpieza-hogar',    nombre: 'Hogar y limpieza' },
    { id: 'cuidado-personal',  nombre: 'Cuidado personal' },
    { id: 'bebes',             nombre: 'Bebés' },
    { id: 'otros',             nombre: 'Otros' }
  ];
  const CAT_IDS = new Set(CATEGORIAS.map(c => c.id));
  const nombreCategoria = id => (CATEGORIAS.find(c => c.id === id) || { nombre: 'Otros' }).nombre;

  // Palabras clave por categoría. Gana la palabra que aparece PRIMERO en el
  // nombre del producto (el sustantivo principal), luego la más larga.
  const ORDEN_REGLAS = ['bebes','cuidado-personal','limpieza-hogar','lacteos-embutidos','bebidas','desayuno-cafe','snacks-dulces','despensa'];
  const REGLAS = {"bebes":["GERBER","HUGGIES","PANAL","PANALES","NESTOGENO","CERELAC","COMPOTA","NIDO","NAN"],"cuidado-personal":["CHAMPU","SHAMPOO","ACOND","ACONDICIONADOR","JABON","CREMA DENTAL","DESODORANTE","DEO","KOTEX","ALWAYS","PROTECTOR DIARIO","VASELINE","VASELINA","MASCARILLA","CURAS","PANTENE","HEAD & SHOULDERS","HS SHAMPOO","GEL","AFEITAR","HOJILLAS","RASTRILLO","BALSAMO","CREMA PEINAR","CREMA DE PEINAR","PTN CREMA","TOALLA ALIVE","TOALLA WANITA","TOALLAS HUMEDAS","ALEA TOALLAS","TOALLAS S FRIENDS","FRIENDS PD","SPLASH","VAPORIZE","ORAL B","REXONA","TALCO","COLONIA","BIO CREAM","HORSE POWER"],"limpieza-hogar":["DETERGENTE","LAVAPLATOS","LAVA K SA","CLORO","DESINFECTANTE","SUAVIZANTE","PAPEL HIG","PAPEL HIGIENICO","HIG SEDITA","SERVILLETA","SERVILLETAS","TOALLIN","VELA","VELON","BOMBILLO","ENCENDEDORES","BATERIA","BATERIAS","ENERGIZER","CARBON","BOLIGRAFO","PAPEL DE ALUMINIO","CRYSTAL WRAP","ESPONJA","WASHUP","BRILLANTE","POP 35","CABO MADERA","PALAS RECOGEDOR","RASTRILLO","CREYON","LAPIZ","PEGA LOCA","CIGARRILLOS","PALL MALL","VICEROY","TABACOS","ALPISTE","PEROS","SUPER B","KRIS LAVAPLATOS","NDG","LUCKY STRIKE","BELMONT"],"lacteos-embutidos":["QUESO","LECHE","LECPLV","YOGURT","MANTEQUILLA","JAMON","MORTADELA","SALCHICHA","SALCHIPRADO","CHORIZO","TOCINETA","PECHUGA","MARGARINA","MAVESA","CHULETA","LA CAMPESINA","PARISIENNE","PEPPERONI","SALAMI","CARNATION","CREMA DE LECHE","SVELTY","UPACA LECHE","PIZZA RICA","HUESITO"],"bebidas":["AGUA","AGUAFIEL","REFRESCO","7UP","PEPSI","JUGO","NECTAR","NESTEA","LIPTON","BEBIDA","GLUP","DRINK COLA","MALTA","GOLDEN KOLA","GOLDEN MANZANA","FRUGY","JUSTY","NARANJADA","POWER X","TE DE","TE INFUSION","PARAMO"],"desayuno-cafe":["CAFE","NESCAFE","NESTUM","CEREAL","GRANOLA","AVENA","FLAKES","MERMELADA","CHOCOCAO","KKO","PAN SANDWICH","PAPELON","CAFETIN","AREQUIPE","RICA CHICHA","BEBIDA ACHOC","AIKAS","NESTLE SAVOY BEBIDA"],"snacks-dulces":["CHEETOS","DORITOS","RUFFLES","TOSTITOS","LAYS","GALLETAS","GALLETA","CARAMELOS","CHOCOLATE","GOMITAS","PEPITO","CHICHARRON","MANI","COTUFAS","PONQUECITOS","PANQUE","SAVOY","COCOSETTE","SAMBA","SUSY","TORONTO","MORDISQUITO","RAQUETY","CHUPETA","RIKITI","DELICIAS","CROSTATINA","CARLOTINA","GRISSINIS","PLATANITOS","PLATANO","FLAQUITO","CHOCO LATTE","GALAK","MARILU","BOTECITOS","BOTECITO","DUNGA","CRUST","BIN BIN","VAN ECKEL","DE TODITO","KIT KAT","KITKAT","KK","MARIA SELECTA","MINI MARIA","MENTICAS","MENTITAS","NESTLE OSCURO","NESTSVY","PECAS","STADIUM","FRESINA","PASSION","TAMY","CHEESE TRIS","TORTILLAS","ELITE","KATY","PNGPNG","SODA","GRAGEADO","TODO USO","CHOCOLATES","PUDIN","GELATINA","DIABLITOS","CARAMELO","CHOCOBIN","CRI CRI","RELLENITOS","TORTICAS","NATUCHIPS","BOMBOM"],"despensa":["ACEITE","GRASA VEGETAL","ARROZ","HARINA","PASTA","PASTAS","PASTICHO","RONCO","AZUCAR","SAL","SALSA","SALSAS","MAYONESA","KETCHUP","MOSTAZA","MAGGI","CALDO","ATUN","SDLA ATUN","SARDINA","SARDINAS","CARAOTAS","LENTEJAS","GUISANTES","MAIZ","VINAGRE","MANTECA","LEVADURA","REPOSTERIA","CHAMPINONES","PRIMOR","VATEL","BASE P/COCINAR","CREMA CHANTILLY","CHANTILLY","CREMA P/COCINAR","MELOCOTONES","MEZCLA PARA","DIABLITOS","UW DIABLITOS","PEPITONA","JAMON ENDIABLADO","PREPARADO DE MAYONESA","MONTALBAN AZUCAR","ADOBO","SAZON","PIMIENTA","ONOTO","COMINO","PAN","ARVEJA","MAG","MONTALBAN 0","VEGETALES"]};
  const REGEX_REGLAS = ORDEN_REGLAS.map((cat, pri) => ({
    cat, pri,
    pats: REGLAS[cat].map(k => ({ k, re: new RegExp('(?<![A-Z0-9])' + k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?![A-Z0-9])') }))
  }));

  function normTexto(s) {
    return String(s == null ? '' : s)
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .toUpperCase().replace(/[^A-Z0-9&/ ]/g, ' ')
      .replace(/\s+/g, ' ').trim();
  }

  function clasificar(nombre) {
    const n = ' ' + normTexto(nombre) + ' ';
    let mejor = null;
    for (const g of REGEX_REGLAS) {
      for (const p of g.pats) {
        const m = p.re.exec(n);
        if (m) {
          const key = [m.index, -p.k.length, g.pri];
          if (!mejor || key[0] < mejor.key[0] || (key[0] === mejor.key[0] && (key[1] < mejor.key[1] || (key[1] === mejor.key[1] && key[2] < mejor.key[2])))) {
            mejor = { key, cat: g.cat };
          }
        }
      }
    }
    return mejor ? mejor.cat : 'otros';
  }

  /* ---------- Utilidades ---------- */
  const esc = s => String(s == null ? '' : s).replace(/[&<>"'`]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '`': '&#96;' }[c]));

  // Solo se permiten rutas locales seguras, https, y (en el admin) blob:/data:image
  function urlSegura(u, permitirLocalesTemporales) {
    const s = String(u || '').trim();
    if (!s) return '';
    if (/^https:\/\/[^\s"'<>]+$/i.test(s)) return s;
    if (permitirLocalesTemporales && (/^blob:/i.test(s) || /^data:image\/(png|jpe?g|webp|gif);base64,/i.test(s))) return s;
    if (/^(\.\/)?[\w\-]+(\/[\w\-.]+)*\.(webp|png|jpe?g|gif|avif|svg)$/i.test(s) && !s.includes('..')) return s.replace(/^\.\//, '');
    return '';
  }

  const centavos = n => Math.round((Number(n) || 0) * 100);
  const deCentavos = c => c / 100;
  function dinero(n) {
    const v = Number(n) || 0;
    return '$' + v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function dineroPartes(n) {
    const [ent, dec] = (Number(n) || 0).toFixed(2).split('.');
    return { entero: Number(ent).toLocaleString('en-US'), decimales: dec };
  }

  // Lee números en formato venezolano (2,22 / 1.234,56) o inglés (2.22 / 1,234.56)
  function parseNumero(v) {
    if (typeof v === 'number') return isFinite(v) ? v : NaN;
    let s = String(v == null ? '' : v).trim();
    if (!s) return NaN;
    s = s.replace(/[^\d.,\-]/g, '');
    if (!s || s === '-' ) return NaN;
    const ultPunto = s.lastIndexOf('.'), ultComa = s.lastIndexOf(',');
    if (ultPunto > -1 && ultComa > -1) {
      if (ultComa > ultPunto) s = s.replace(/\./g, '').replace(',', '.');
      else s = s.replace(/,/g, '');
    } else if (ultComa > -1) {
      s = (s.match(/,/g).length > 1) ? s.replace(/,/g, '') : s.replace(',', '.');
    } else if ((s.match(/\./g) || []).length > 1) {
      s = s.replace(/\./g, '');
    }
    const n = parseFloat(s);
    return isFinite(n) ? n : NaN;
  }
  function parsePorcentaje(v) {
    let n = parseNumero(v);
    if (isNaN(n)) return NaN;
    if (n > 0 && n < 1 && !/%/.test(String(v))) n = n * 100; // celdas con formato % de Excel (0.15)
    return n;
  }
  const limitarDescuento = d => Math.min(90, Math.max(0, Math.round((Number(d) || 0) * 10) / 10));

  // Firma estable de un producto: si el ID se reutiliza para otro artículo,
  // la firma cambia y el carrito lo detecta (evita cruzar productos).
  const firmaProducto = p => normTexto(p.producto) + '|' + normTexto(p.marca);
  const claveCodigo = c => normTexto(c).replace(/\s/g, '');

  /* ---------- Normalización de productos ---------- */
  function normalizarProducto(p) {
    const o = p && typeof p === 'object' ? p : {};
    const producto = String(o.producto ?? o.nombre ?? '').replace(/\s+/g, ' ').trim();
    const precio = parseNumero(o.precio);
    const stock = parseNumero(o.stock ?? o.cantidad);
    const categoria = CAT_IDS.has(o.categoria) ? o.categoria : clasificar(producto);
    return {
      id: Number.isInteger(Number(o.id)) && Number(o.id) > 0 ? Number(o.id) : null,
      codigo: String(o.codigo ?? '').trim(),
      producto,
      marca: String(o.marca ?? '').replace(/\s+/g, ' ').trim(),
      categoria,
      modulo: String(o.modulo ?? '').trim(),
      precio: isNaN(precio) || precio < 0 ? 0 : Math.round(precio * 100) / 100,
      descuento: limitarDescuento(o.descuento),
      stock: isNaN(stock) || stock < 0 ? 0 : Math.floor(stock),
      imagen: String(o.imagen ?? '').trim(),
      galeria: Array.isArray(o.galeria) ? o.galeria.map(String).map(s => s.trim()).filter(Boolean).slice(0, 8) : [],
      descripcion: String(o.descripcion ?? '').trim(),
      destacado: o.destacado === true || o.destacado === 'true' || o.destacado === 1
    };
  }

  // Normaliza la lista completa y repara IDs faltantes o duplicados.
  function normalizarInventario(lista) {
    const arr = Array.isArray(lista) ? lista : [];
    const usados = new Set();
    const reparados = [];
    const salida = arr.map(normalizarProducto).filter(p => p.producto);
    let max = salida.reduce((m, p) => (p.id && p.id > m ? p.id : m), 0);
    for (const p of salida) {
      if (!p.id || usados.has(p.id)) {
        const viejo = p.id;
        p.id = ++max;
        reparados.push({ producto: p.producto, idAnterior: viejo, idNuevo: p.id });
      }
      usados.add(p.id);
    }
    return { productos: salida, reparados };
  }

  /* ---------- Promociones ---------- */
  function normalizarPromo(p, i) {
    const o = p && typeof p === 'object' ? p : {};
    return {
      id: String(o.id || ('promo-' + (i + 1))).replace(/[^\w\-]/g, '').slice(0, 40) || ('promo-' + (i + 1)),
      titulo: String(o.titulo || '').trim(),
      descripcion: String(o.descripcion || '').trim(),
      etiqueta: String(o.etiqueta || '').trim().slice(0, 24),
      imagen: String(o.imagen || '').trim(),
      imagenMovil: String(o.imagenMovil || '').trim(),
      color: o.color === 'rojo' ? 'rojo' : 'azul',
      desde: /^\d{4}-\d{2}-\d{2}$/.test(o.desde) ? o.desde : '',
      hasta: /^\d{4}-\d{2}-\d{2}$/.test(o.hasta) ? o.hasta : '',
      descuento: limitarDescuento(o.descuento),
      productos: Array.isArray(o.productos) ? [...new Set(o.productos.map(Number).filter(n => Number.isInteger(n) && n > 0))] : [],
      activo: o.activo !== false
    };
  }
  function normalizarPromociones(data) {
    const lista = Array.isArray(data) ? data : (data && Array.isArray(data.promociones) ? data.promociones : []);
    const vistos = new Set();
    return lista.map(normalizarPromo).map(p => {
      let id = p.id, n = 2;
      while (vistos.has(id)) id = p.id + '-' + (n++);
      vistos.add(id); p.id = id; return p;
    });
  }

  const hoyISO = (d = new Date()) => {
    const z = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`;
  };
  function estadoPromo(p, hoy = hoyISO()) {
    if (!p.activo) return 'inactiva';
    if (p.desde && hoy < p.desde) return 'programada';
    if (p.hasta && hoy > p.hasta) return 'vencida';
    return 'activa';
  }
  const promosActivas = (promos, hoy) => (promos || []).filter(p => estadoPromo(p, hoy) === 'activa');

  // Índice id → mejor promo activa con descuento
  function indicePromos(promos, hoy) {
    const idx = new Map();
    for (const p of promosActivas(promos, hoy)) {
      for (const id of p.productos) {
        const prev = idx.get(id);
        if (!prev || p.descuento > prev.descuento) idx.set(id, p);
      }
    }
    return idx;
  }

  /* ---------- Precio final: ÚNICA función de precios del sistema ----------
     Regla: se aplica el MAYOR descuento entre el del producto y el de las
     promociones activas que lo incluyan. Cálculo en centavos enteros. */
  function precioFinal(p, idxPromos) {
    const promo = idxPromos ? idxPromos.get(p.id) : null;
    const dProd = limitarDescuento(p.descuento);
    const dPromo = promo ? limitarDescuento(promo.descuento) : 0;
    const desc = Math.max(dProd, dPromo);
    const baseC = centavos(p.precio);
    const finalC = Math.round(baseC * (100 - desc) / 100);
    return {
      base: deCentavos(baseC),
      final: deCentavos(finalC),
      finalC,
      descuento: desc,
      ahorro: deCentavos(baseC - finalC),
      fuente: desc === 0 ? null : (dPromo > dProd ? 'promo' : 'producto'),
      promo: dPromo > dProd ? promo : (promo && dPromo === dProd && dPromo > 0 ? promo : null)
    };
  }

  function estadoStock(stock) {
    const n = Number(stock) || 0;
    if (n <= 0) return { clase: 'agotado', texto: 'Agotado' };
    if (n < TIENDA.stockBajo) return { clase: 'bajo', texto: n === 1 ? 'Queda 1' : `Quedan ${n}` };
    return { clase: 'ok', texto: 'Disponible' };
  }

  /* ---------- Búsqueda ---------- */
  const terminosBusqueda = q => normTexto(q).split(' ').filter(Boolean);
  function textoIndexable(p) {
    return normTexto([p.producto, p.marca, p.codigo, nombreCategoria(p.categoria), p.descripcion].join(' '));
  }

  /* ---------- Hash git (SHA-1 de blob) para detectar versiones ---------- */
  async function shaGitBlob(textoOBytes) {
    const bytes = typeof textoOBytes === 'string' ? new TextEncoder().encode(textoOBytes) : textoOBytes;
    const cab = new TextEncoder().encode('blob ' + bytes.length + '\0');
    const todo = new Uint8Array(cab.length + bytes.length);
    todo.set(cab, 0); todo.set(bytes, cab.length);
    const h = await crypto.subtle.digest('SHA-1', todo);
    return [...new Uint8Array(h)].map(b => b.toString(16).padStart(2, '0')).join('');
  }

  const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

  function almacen(tipo) {
    try { const s = global[tipo]; const k = '__vj_test__'; s.setItem(k, '1'); s.removeItem(k); return s; }
    catch (e) { const m = new Map(); return { getItem: k => m.has(k) ? m.get(k) : null, setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) }; }
  }

  global.VJ = {
    TIENDA, CATEGORIAS, nombreCategoria, clasificar, normTexto, esc, urlSegura,
    centavos, deCentavos, dinero, dineroPartes, parseNumero, parsePorcentaje, limitarDescuento,
    firmaProducto, claveCodigo, normalizarProducto, normalizarInventario,
    normalizarPromociones, estadoPromo, promosActivas, indicePromos, hoyISO,
    precioFinal, estadoStock, terminosBusqueda, textoIndexable, shaGitBlob, debounce, almacen
  };
})(window);
