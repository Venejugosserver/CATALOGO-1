# Digimarket: informe de cumplimiento

Revisión del 18 de noviembre de 2026. Este informe es una guía técnica y no sustituye la revisión de un abogado venezolano, que debe validar los tres documentos legales antes de publicarlos.

## 1. Origen

Los documentos legales, los datos de la empresa y el sistema de aceptación se tomaron de NEXUS y se adaptaron a un catálogo público con pedidos. La diferencia principal: **la aceptación no pide el nombre**. Solo se registran las dos casillas, con fecha, hora, versión y forma de aceptación.

## 2. Normas consideradas

| Norma | Cómo se aplica en Digimarket |
|---|---|
| Constitución, art. 28 (habeas data) y art. 60 | La Política de privacidad explica cada dato, su finalidad y cómo ejercer los derechos; enlace para retirar el consentimiento. |
| TSJ, Sala Constitucional, sentencia N.° 1318 del 04/08/2011 | Consentimiento por casilla separada, finalidades cerradas, plazos de conservación y medidas de seguridad descritas. |
| Ley sobre Mensajes de Datos y Firmas Electrónicas (2001) | Registro con fecha y hora de cada casilla, versión y método; hora del servidor de Google si se activa el registro central. |
| Ley Especial contra los Delitos Informáticos (2001) | Citada en los Términos como advertencia sobre el uso indebido del sitio y del panel. |
| Ley sobre el Derecho de Autor y Ley de Propiedad Industrial | Cláusula de propiedad intelectual y uso identificativo de marcas de terceros. |

## 3. Puntos que debe confirmar el abogado

- **Precios en dólares.** Los Términos dicen que los precios en USD son referenciales y que el pago en bolívares se calcula al tipo de cambio oficial del BCV del día del pago. Confirmar que esa redacción cumple la normativa vigente de precios y marcaje (Ley Orgánica de Precios Justos y normas del BCV), y si los precios deben mostrarse también en bolívares.
- **Impuestos.** Los Términos remiten el IVA a la factura. Confirmar si los precios publicados deben indicar si incluyen IVA.
- **Pedido como solicitud.** Se establece que la venta se perfecciona cuando la empresa confirma disponibilidad, precio, pago y entrega. Validar con la normativa de protección al consumidor.
- **Plazos.** Cinco años para las aceptaciones; el tiempo necesario por obligaciones contables y tributarias para los pedidos.
- **Tribunales y plazo de respuesta.** Caracas y 15 días hábiles.

## 4. Imágenes y licencias

| Elemento | Estado |
|---|---|
| Logo de Venejugos | Marca propia. Conviene confirmar su registro ante el SAPI a nombre de la razón social. |
| Fotos de productos | Pertenecen a los fabricantes. Conviene tener autorización por escrito o confirmar que el contrato de distribución permite usarlas para vender. |
| Bricolage Grotesque y Hanken Grotesk | SIL Open Font License 1.1, licencias en `fuentes/`. |
| html2canvas y SheetJS | MIT y Apache 2.0, licencias en `js/vendor/`. |
| Cinta, banners de texto e íconos | Dibujados en código para este sitio. |

## 5. Riesgos que siguen abiertos

- **Sin nombre, la constancia es más débil.** El registro prueba que alguien aceptó desde un navegador y un equipo concretos, no quién fue. Para un catálogo público suele ser suficiente; si se necesita identificar a la persona, habría que volver a pedir el nombre o un dato de contacto.
- **Las claves del panel no son una barrera real**, porque el código del sitio es público. La protección efectiva es el token de GitHub de cada persona.
- **El registro central acepta envíos de cualquiera**, porque el sitio es público. El script valida el formato y evita duplicados; la columna `recibido_servidor` es la hora confiable.
- **No se registra la dirección IP.** Un sitio estático no puede verla.
