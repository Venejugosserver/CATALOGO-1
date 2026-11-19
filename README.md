# Digimarket · Catálogo Venejugos en GitHub Pages

Catálogo de productos con promociones del mes, fotos y pedidos, más un panel de administración con **dos fases de trabajo**. Todo funciona en GitHub Pages, sin servidor.

| Archivo / carpeta | Para qué sirve |
|---|---|
| `index.html` | Catálogo público (lo que ven los clientes). |
| `admin.html` | Panel de administración con dos claves (ver abajo). |
| `precios.json` | Productos: código, nombre, marca, categoría, precio, descuento, stock, fotos. |
| `promociones.json` | Promociones del mes: banner, fechas, % de descuento y productos. |
| `css/`, `js/` | Estilos y lógica. `js/comun.js` tiene la configuración de la tienda; `js/legal.js`, los datos legales. |
| `terminos.html`, `privacidad.html`, `cookies.html` | Documentos legales que se aceptan al entrar. |
| `fuentes/`, `js/vendor/` | Tipografías y librerías alojadas en el propio sitio, con sus licencias. |
| `consentimientos.gs` | Script opcional de Google para guardar las aceptaciones en una hoja central. |
| `CUMPLIMIENTO.md` | Informe legal y técnico, con los puntos que debe revisar un abogado. |
| `img/productos/`, `img/promociones/` | Fotos que sube el panel (se crean solas al publicar). |

> Si vienes de la versión anterior: sube todo y **borra el `styles.css` viejo** de la raíz. Los pedidos que los clientes tenían abiertos se migran solos.

---

## 1. Publicar el sitio

1. Sube el contenido de esta carpeta a la raíz de tu repositorio (ej. `digimarket-precios`).
2. En el repo: **Settings → Pages → Deploy from a branch → `main` / `(root)`**.
3. En 1–2 minutos queda en `https://TU-USUARIO.github.io/digimarket-precios/` y el panel en `…/admin.html`.

## 2. Aceptación de documentos (sin nombre)

La primera vez que alguien abre el catálogo o el panel aparece la ventana **“Antes de entrar a Digimarket”**. Tiene dos casillas separadas y sin marcar, una para los Términos y otra para la Política de privacidad, y no pide el nombre. Se registra la fecha y hora de cada casilla, la versión de cada documento, si se abrió cada enlace, el navegador y un identificador aleatorio del equipo.

- **Datos de la empresa:** se editan solo en `js/legal.js` y se rellenan solos en los tres documentos y en el pie del sitio.
- **Cambiar un documento:** edita su texto y sube su número en `version` dentro de `js/legal.js`. El sitio pedirá aceptarlo de nuevo a todos.
- **Registro central (opcional):** sigue las instrucciones al inicio de `consentimientos.gs` y pega la URL `/exec` en `registroUrl` de `js/legal.js`. Mientras esté vacío, la constancia queda solo en cada navegador. Los registros guardados localmente se envían solos cuando lo actives.
- **Retiro:** el enlace “Retirar mi consentimiento” del pie borra la aceptación y el pedido guardado, y registra la fecha del retiro.

## 3. Las dos fases del panel

| Fase | Clave | Qué puede hacer | Qué NO puede tocar |
|---|---|---|---|
| **Inventario** | `INVENTARIO 2026` | Productos, precios, stock, códigos, categorías, descuentos, promociones (fechas, % y productos), importar Excel, restaurar respaldos. | Fotos y banners. |
| **Visuales** | `VISUALES2026` | Fotos de productos (una por una, galería o en lote) y banners de las promociones. | Precios, stock, nombres, promociones. |

- Las claves no distinguen mayúsculas ni espacios: `inventario 2026` y `INVENTARIO2026` funcionan igual.
- El botón **Salir** cierra la fase. Cada fase ve solo sus pestañas.

### Pueden trabajar al mismo tiempo

Al publicar, el panel **lee la versión más reciente de GitHub** y aplica encima **solo los campos de su fase**. Si Visuales sube fotos mientras Inventario cambia precios, ninguno pisa al otro. Cada publicación es un único commit (`[Inventario] …` o `[Visuales] …`): o se publica todo o nada.

## 4. Conectar con GitHub (una vez por persona)

1. GitHub → **Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate**.
2. *Repository access*: solo este repositorio. *Permissions → Contents*: **Read and write**. Pon una fecha de expiración.
3. En el panel, pestaña **Conexión y respaldo**: usuario, repositorio, rama (`main`) y token → **Guardar y probar conexión**.
   Si el sitio está en `usuario.github.io/repo`, usuario y repositorio se completan solos.

El token se guarda solo en ese navegador (y se borra al cerrar la pestaña, salvo que marques "Recordar").

## 5. Fase Inventario

- **Productos:** edita directo en la tabla (precio acepta `2,50` o `2.50`). Si un precio cambia más de 5 veces, pide confirmación. El lápiz abre el detalle (descripción, módulo). Selecciona varios para aplicar descuento, categoría, destacado o añadirlos a una promoción.
- **Promociones del mes:** "+ Promoción de este mes" crea una con fechas del 1 al último día. Agrega productos buscando por nombre, marca, código o ID ("Agregar todos" suma los resultados). El banner lo carga Visuales.
- **Descuentos desde Excel:** columna de código/ID/producto + columna de descuento (`15`, `15%` o `0,15`).
- **Importar Excel:** detecta solas las columnas aunque el encabezado no esté en la fila 1. Empareja cada fila por **ID → código → nombre + marca**, así no se pierden fotos ni se cruzan productos. Muestra antes de aplicar: cuántos cambian, precios que suben/bajan, filas repetidas y errores con su número de fila real. Modos: *Actualizar y agregar*, *Solo precios y stock*, *Reemplazar lista completa*.
- **Descargar catálogo en Excel:** edítalo y vuelve a subirlo (incluye la columna ID, que es la forma más segura de emparejar).

## 6. Fase Visuales

- **Fotos de productos:** tarjetas con los productos sin foto primero. Toca o arrastra una imagen para la foto principal; "Galería" para varias fotos.
- **Fotos en lote:** nombra cada archivo con el código, el ID o el nombre exacto del producto (`587.jpg`, `7UP-15.png`). Solo se aceptan coincidencias exactas; las demás se asignan a mano con un selector.
- **Banners de promociones:** imagen para computador (1600 × 460 px) y, opcional, para teléfono (1080 × 810 px). Sin imagen, el catálogo muestra un banner de texto con los colores de la marca.
- Todas las fotos se optimizan en el navegador (máx. 900 px, WebP) y las que se reemplazan se borran del repositorio al publicar.

## 7. Regla de precios

Hay una sola función de precio para todo el sitio (`VJ.precioFinal` en `js/comun.js`), calculada en centavos. Si un producto tiene descuento propio y además está en una promoción activa, **se aplica el mayor de los dos**.

## 8. Protecciones contra cruces

- Cada producto tiene un **ID interno que nunca cambia**; toda edición se aplica por ID, no por posición en la tabla.
- Códigos repetidos bloquean la publicación; nombre + marca repetidos y precios en 0 se avisan.
- El carrito del cliente guarda una "firma" de cada producto: si un ID pasa a ser otro artículo, se quita en vez de mostrar el producto equivocado. Si cambió el precio o se agotó, se avisa.
- Si cierras la pestaña con cambios sin publicar, quedan como borrador en ese equipo.

## 9. Cambiar las claves

En `js/admin.js`, objeto `ROLES`, cada fase guarda el SHA-256 de su clave **en mayúsculas y sin espacios**. Para generar uno nuevo, abre la consola del navegador (F12) y ejecuta:

```js
async function h(s){s=s.toUpperCase().replace(/\s+/g,'');const b=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s));return[...new Uint8Array(b)].map(x=>x.toString(16).padStart(2,'0')).join('')}
h('MiNuevaClave').then(console.log)
```

Copia el resultado en `hash:` de la fase correspondiente.

## 10. Seguridad: lo que conviene saber

El sitio no carga nada de terceros: tipografías (Bricolage Grotesque y Hanken Grotesk) y librerías (html2canvas y SheetJS) están en el propio repositorio, y cada página tiene una política de seguridad de contenido que solo permite cargar recursos del sitio y conectarse con GitHub y, si lo activas, con Google Apps Script.

Las claves de fase son una barrera de organización, no de seguridad real: el sitio es estático y su código es visible para cualquiera. Quien sabe programar podría saltarse la pantalla de acceso. **La protección real es el token de GitHub**: sin un token válido nadie puede publicar.

GitHub no permite limitar un token a una sola carpeta, así que la separación entre Inventario y Visuales la impone el panel, no GitHub. Recomendaciones: un token distinto por persona, con expiración corta, y revocarlo si alguien deja el equipo. Para acceso realmente restringido haría falta un hosting con autenticación de servidor.

## 11. Personalizar

En `js/comun.js`, objeto `TIENDA`: nombre, eslogan, umbral de stock bajo y `whatsapp` (ej. `'584141234567'`). Con número, el pedido muestra "Enviar por WhatsApp".

## 12. Pantallas probadas (sin desbordes)

- **Teléfonos:** 320×568, 360×640, 360×800, 375×667, 390×844, 393×873, 412×915, 414×896, 428×926, 430×932.
- **Tabletas:** 600×960, 768×1024, 800×1280, 810×1080, 820×1180, 834×1112, 834×1194, 1024×1366, 1280×800, 1024×768.
- **Computadores:** 1280×720, 1366×768, 1440×900, 1536×864, 1600×900, 1680×1050, 1920×1080, 2048×1152, 2560×1440, 3840×2160.

Las pruebas se hicieron con un navegador automatizado. Conviene revisarlo también en un teléfono real (teclado abierto, muesca, gestos), porque la emulación no reproduce todo.
