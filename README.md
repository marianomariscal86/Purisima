# Plataforma de Ventas — La Purísima

Sistema web con todo lo pedido: calculadora, lista de precios, citas, contrato, y un visor de planos. Todo el acceso es con **usuario y contraseña**.

## Qué hace

- **Calculadora de pagos** — cotiza a 12, 24, 36, 48 y 60 mensualidades iguales con tasa **TIIE + 8 puntos** (TIIE se actualiza sola, ver abajo). Eliges un **lote disponible** y se precarga su precio (editable); si cambias el precio a mano, el lote pasa a **“LOTE POR DEFINIR”**. Exporta la cotización a **PDF**.
- **Lista de precios** — disponibilidad de lotes. La ve todo el equipo; **solo el admin la edita** (precio, estatus, alta de lotes, y el recorte de plano de cada manzana).
- **Citas** — con horarios reales por ejecutivo:
  - **Ventas** publica/edita su propia disponibilidad semanal (ej. lunes a sábado, 9:00–13:00). Puede agregar o quitar días/horarios cuando quiera.
  - **Marketing** elige un ejecutivo y una fecha, y la app le muestra solo los **huecos libres de 2 horas** dentro de ese horario (ya descuenta las citas ya agendadas).
  - **Admin** puede dar de alta ejecutivos, editar el horario de cualquiera, y también agendar citas.
  - La base de datos **no permite** que dos citas se traslapen para el mismo ejecutivo (doble candado: en el código y en la base).
- **Contrato** — genera el Contrato Privado de Promesa de Compraventa (con su Anexo B) con los datos del cliente y del lote. **La superficie del lote ya no se escribe a mano: siempre se jala del inventario** (lista de precios), para evitar inconsistencias. Incluye un botón **“Ver plano de esta manzana”** que muestra el recorte real del masterplan para ese lote. Exporta a PDF con el importe en número y letra.
- **Ajustes** (solo admin) — datos fijos de la empresa para el contrato, configuración de tasa/enganche, botón para forzar una actualización de TIIE, y alta de ejecutivos de ventas.

> El módulo de **cobranza** queda para una siguiente fase; la base ya está lista para agregarlo sin rehacer nada.

---

## TIIE automática (Banxico)

La tasa TIIE a 28 días se obtiene directo del **Banco de México** (API oficial SIE), sin que nadie tenga que escribirla a mano:

- Se actualiza **sola** cada vez que un admin abre la app, si el último dato tiene más de ~20 horas.
- El admin también puede forzar la actualización en cualquier momento con el botón **“Actualizar TIIE ahora (Banxico)”** en Ajustes.
- Si por algún motivo Banxico no responde, la app simplemente se queda con el último valor guardado — nunca se rompe la calculadora por esto.

### Configuración necesaria (una sola vez)

1. **Obtén tu token gratuito de Banxico:**
   - Entra a **https://www.banxico.org.mx/SieAPIRest/service/v1/token**
   - Llena el formulario (nombre, correo, motivo de uso) y resuelve el captcha.
   - Te llega un token de 64 caracteres a tu correo. Cópialo.

2. **Súbelo como "secreto" en Supabase** (nunca va en el código ni en GitHub):
   - En tu proyecto de Supabase: **Edge Functions → Manage secrets** (o **Project Settings → Edge Functions**).
   - Agrega un secreto: **Nombre:** `BANXICO_TOKEN` · **Valor:** el token que copiaste.

3. **Sube la función a Supabase.** Necesitas el CLI de Supabase (una sola vez en tu computadora):
   ```bash
   npm install -g supabase
   supabase login
   supabase link --project-ref TU_PROJECT_REF
   supabase functions deploy tiie-fetch
   ```
   - `TU_PROJECT_REF` lo ves en la URL de tu proyecto Supabase (`https://supabase.com/dashboard/project/TU_PROJECT_REF`).
   - Si no quieres usar terminal, también puedes pegar el contenido de `supabase/functions/tiie-fetch/index.ts` directo en el editor de Edge Functions del dashboard de Supabase (**Edge Functions → Create a new function** → nómbrala `tiie-fetch` → pega el código → Deploy).

Listo — desde ese momento, la TIIE se actualiza sola.

---

## Arquitectura (en cristiano)

- **Front-end**: archivos estáticos (HTML/CSS/JS). No requiere servidor propio.
- **Base de datos real + login**: **Supabase** (PostgreSQL + autenticación + seguridad por fila “RLS”).
- **TIIE automática**: una pequeña función de servidor (Edge Function) dentro de Supabase consulta a Banxico y guarda el valor — así el token de Banxico nunca queda expuesto en el código público.
- **PDF**: se genera con la función imprimir del navegador → **“Guardar como PDF”**.
- **Plano**: imágenes recortadas del masterplan, una por manzana, en la carpeta `/planos/`.

---

## Puesta en marcha (paso a paso)

### 1) Crea el proyecto en Supabase (gratis)
1. Entra a https://supabase.com → **Start your project** → crea cuenta.
2. **New project**. Ponle nombre (p. ej. `purisima`), elige región **East US** (cercana), define una contraseña de base de datos y crea. Espera ~2 min.

### 2) Crea la base de datos
1. En el menú izquierdo: **SQL Editor → New query**.
2. Abre el archivo **`schema.sql`** de este proyecto, copia **todo** su contenido (sin los acentos de comilla invertida ``` ``` ```, esos solo son del formato de este documento), pégalo en el editor y presiona **Run**.
3. Debe decir *Success*. Eso crea las tablas, los permisos por rol, los ejecutivos/horarios de ejemplo y unos lotes de muestra.

### 3) Crea los usuarios y asigna roles
1. Menú izquierdo: **Authentication → Users → Add user → Create new user**. Pon correo y contraseña (déjalo "confirmado" para uso interno).
2. Crea uno para ti (admin), uno o varios de ventas, y uno o varios de marketing.
3. Vuelve a **SQL Editor** y conviértete en **admin** (cambia el correo):
   ```sql
   update public.profiles set role = 'admin' where email = 'TU_CORREO@ejemplo.com';
   ```
   Para marketing:
   ```sql
   update public.profiles set role = 'marketing' where email = 'marketing@ejemplo.com';
   ```
   Los demás quedan como `ventas` por defecto.
4. **Liga cada persona de ventas a un ejecutivo** (así puede subir su propio horario). Desde la pestaña **Ajustes → Ejecutivos de ventas** (ya logueado como admin), da de alta el ejecutivo poniendo su correo — si ya inició sesión una vez, la app lo liga automáticamente.

### 4) Activa la TIIE automática
Sigue la sección **"TIIE automática (Banxico)"** más arriba (obtener token, subirlo como secreto, desplegar la función). Toma unos 10 minutos la primera vez.

### 5) Conecta el front-end con tu base
1. En Supabase: **Project Settings → Data API** (o **API**). Copia:
   - **Project URL** (algo como `https://abcd1234.supabase.co`)
   - **anon public** key (clave pública; **NO** la `service_role`).
2. Abre **`supabase-config.js`** y pega esos dos valores entre comillas.

### 6) Agrega los recortes del plano (opcional, según vayas teniendo)
1. Genera o recorta una imagen (JPG o PNG) por cada manzana del masterplan.
2. Súbela a la carpeta **`/planos/`** del proyecto, con un nombre simple (ej. `manzana_17.jpg`).
3. En **Lista de precios** (como admin), edita cada lote de esa manzana y en el campo **"Plano"** escribe el nombre exacto del archivo (ej. `manzana_17.jpg`).
4. Ya quedó ligado: el botón **"Ver plano de esta manzana"** en Contrato mostrará esa imagen.

> Esta versión ya incluye 2 recortes de muestra (`manzana_17_recorte.jpg`, `manzana_18_recorte.jpg`) tomados de tu masterplan, ligados a los lotes de ejemplo, para que veas cómo se ve funcionando. Solo falta que completes el resto de manzanas conforme tengas tiempo.

### 7) Pruébalo en tu computadora
```bash
python3 -m http.server 8080
```
Abre http://localhost:8080 e inicia sesión.

### 8) Súbelo a internet (GitHub Pages, Netlify, etc.)
Sube la carpeta completa (incluyendo `/planos/`) a tu hosting estático preferido. Recuerda que `supabase/functions/` **no** se sube al hosting — esa carpeta solo se usa para desplegar la función a Supabase con el CLI (paso 4).

### 9) Ajuste final de seguridad en Supabase
1. **Authentication → URL Configuration → Site URL**: pon tu URL pública.
2. Recomendado: en **Authentication → Providers → Email**, **desactiva “Allow new users to sign up”**.

---

## Cómo se usa (día a día)

- **Ventas:** entra a **Citas → Mi disponibilidad semanal**, agrega tus horarios (ej. Lunes 9:00–13:00, repite para los días que trabajes). Puedes quitar un horario cuando quieras.
- **Marketing:** entra a **Citas → Agendar cita**, elige el ejecutivo, la fecha, y el sistema te muestra solo los horarios de 2 horas que aún están libres ese día.
- **Admin:** en **Ajustes → Ejecutivos de ventas** da de alta a cada ejecutivo (liga su correo si ya tiene usuario). Desde el selector en la tarjeta de disponibilidad puedes ver/editar el horario de cualquiera.
- **Contrato:** elige lote (la superficie se llena sola desde el inventario, ya no se edita a mano), captura datos del comprador, y si quieres, presiona **"Ver plano de esta manzana"** antes de generar el PDF.

> **Tip de PDF:** en el cuadro de impresión elige **“Guardar como PDF”**. Para la **cotización** activa **“Gráficos de fondo”** para que salga el encabezado en color.

---

## Costos
Para un equipo de ventas pequeño todo cabe en los planes **gratuitos** de Supabase y de tu hosting estático. Las Edge Functions también tienen una cuota gratuita generosa (la consulta de TIIE es 1 vez al día por persona admin, así que no la vas a agotar).

## Respaldos
Supabase respalda automáticamente. Para exportar manualmente: **Table Editor →** cada tabla **→ Export to CSV**.

## Lo que sigue (cobranza)
El siguiente módulo de **cobranza de cartera** se conectará a estas mismas tablas: agregaremos `contratos` (al firmar) y `pagos` (calendario y abonos), con la misma lógica de TIIE + 8. Avísame cuando quieras y lo construimos encima de esto.

## Archivos del proyecto
| Archivo / carpeta | Para qué |
|---|---|
| `index.html` | La aplicación |
| `styles.css` | Diseño |
| `app.js` | Lógica (login, calculadora, lotes, citas/horarios, contrato, ajustes, plano) |
| `contrato.js` | Plantilla del contrato + importe en letra |
| `supabase-config.js` | **Tus credenciales** (editar) |
| `schema.sql` | Base de datos + permisos (correr una vez en Supabase) |
| `supabase/functions/tiie-fetch/` | Función de servidor que actualiza la TIIE desde Banxico (desplegar con el CLI de Supabase) |
| `planos/` | Recortes de imagen del masterplan, uno por manzana |

