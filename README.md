# Plataforma de Ventas — Hacienda La Purísima

Sistema web con tres módulos pedidos (calculadora, lista de precios, contrato) **más** un módulo de **citas** para ventas y marketing. Todo el acceso es con **usuario y contraseña**.

## Qué hace

- **Calculadora de pagos** — cotiza a 12, 24, 36, 48 y 60 mensualidades iguales con tasa **TIIE + 8 puntos**. Eliges un **lote disponible** y se precarga su precio (editable); si cambias el precio a mano, el lote pasa a **“LOTE POR DEFINIR”**. Exporta la cotización a **PDF**.
- **Lista de precios** — disponibilidad de lotes. La ve todo el equipo; **solo el admin la edita** (precio, estatus, alta de lotes).
- **Citas** — ventas y marketing agendan citas con clientes, ligadas a un lote de interés, con estatus (agendada, confirmada, realizada, etc.).
- **Contrato** — genera el Contrato Privado de Promesa de Compraventa (con su Anexo B) ya con los datos del cliente y del lote, **listo para imprimir/firmar en PDF**, incluyendo el importe **con número y letra**.
- **Ajustes** (solo admin) — TIIE/puntos/enganche y los datos fijos de la empresa que aparecen en el contrato.

## Arquitectura (en cristiano)

- **Front-end**: archivos estáticos (HTML/CSS/JS). No requiere servidor propio.
- **Base de datos real + login**: **Supabase** (PostgreSQL + autenticación + seguridad por fila “RLS”). Cuando alguien edita un precio o agenda una cita, **se guarda de verdad** en la base y todos lo ven.
- **PDF**: se genera con la función imprimir del navegador → **“Guardar como PDF”**.

> El módulo de **cobranza** vendrá después; la base ya queda lista para agregarlo sin rehacer nada.

---

## Puesta en marcha (paso a paso)

### 1) Crea el proyecto en Supabase (gratis)
1. Entra a https://supabase.com → **Start your project** → crea cuenta.
2. **New project**. Ponle nombre (p. ej. `purisima`), elige región **East US** (cercana), define una contraseña de base de datos y crea. Espera ~2 min.

### 2) Crea la base de datos
1. En el menú izquierdo: **SQL Editor → New query**.
2. Abre el archivo **`schema.sql`** de este proyecto, copia **todo** su contenido, pégalo y presiona **Run**.
3. Debe decir *Success*. Eso crea las tablas, los permisos por rol y unos lotes de ejemplo.

### 3) Crea los usuarios y asigna roles
1. Menú izquierdo: **Authentication → Users → Add user → Create new user**. Pon correo y contraseña (desmarca “Auto-confirm” solo si quieres verificación por correo; para uso interno déjalo confirmado).
2. Crea uno para ti (admin), y los de ventas y marketing.
3. Vuelve a **SQL Editor** y conviértete en **admin** (cambia el correo):
   ```sql
   update public.profiles set role = 'admin' where email = 'TU_CORREO@ejemplo.com';
   ```
   Para los de marketing:
   ```sql
   update public.profiles set role = 'marketing' where email = 'marketing@ejemplo.com';
   ```
   Los demás quedan como `ventas` por defecto.

### 4) Conecta el front-end con tu base
1. En Supabase: **Project Settings → Data API** (o **API**). Copia:
   - **Project URL** (algo como `https://abcd1234.supabase.co`)
   - **anon public** key (clave pública; **NO** la `service_role`).
2. Abre **`supabase-config.js`** y pega esos dos valores entre comillas.

> La clave `anon` es pública a propósito y es segura: lo que protege los datos son las políticas RLS del `schema.sql` (por eso solo el admin puede editar precios, etc.). **Nunca** pongas la clave `service_role` en el front-end.

### 5) Pruébalo en tu computadora
- Lo más sencillo: instala una extensión de servidor local o usa Python. En la carpeta del proyecto:
  ```bash
  python3 -m http.server 8080
  ```
  Abre http://localhost:8080 e inicia sesión.
- (Abrir el `index.html` con doble clic también suele funcionar, pero un servidor local evita problemas.)

### 6) Súbelo a internet (elige una opción gratuita)

**Opción A — Netlify (la más fácil, sin instalar nada):**
1. Entra a https://app.netlify.com → **Add new site → Deploy manually**.
2. **Arrastra la carpeta completa** del proyecto a la ventana. Listo: te da una URL pública (`https://algo.netlify.app`). Puedes cambiarle el nombre o conectar tu dominio después.

**Opción B — Vercel o Cloudflare Pages:** sube la carpeta como sitio estático (sin build). Mismo resultado.

**Opción C — GitHub Pages:** sube los archivos a un repositorio y actívalo en *Settings → Pages*.

### 7) Ajuste final de seguridad en Supabase
1. **Authentication → URL Configuration → Site URL**: pon la URL pública (la de Netlify/Vercel).
2. Recomendado para uso interno: en **Authentication → Providers → Email**, **desactiva “Allow new users to sign up”** para que solo tú des de alta usuarios.

---

## Cómo se usa (día a día)

- **Primera vez (admin):** entra a **Ajustes** y llena los **datos de la empresa** (razón social, representante, escrituras, CLABE, banco, testigos) y la **TIIE** vigente. Eso se imprime en cada contrato.
- **Lista de precios (admin):** **+ Nuevo lote** o **Editar** para fijar precio y estatus (disponible / apartado / vendido).
- **Calculadora (cualquiera):** elige lote, ajusta enganche si hace falta, **Calcular** y **Exportar cotización (PDF)**.
- **Citas (ventas/marketing):** llena los datos y **Agendar**. Cada quien actualiza el estatus de sus citas; el admin puede actualizar todas.
- **Contrato:** elige lote, captura datos del comprador y fecha, **Generar contrato (PDF)**.

> **Tip de PDF:** en el cuadro de impresión elige **“Guardar como PDF”**. Para la **cotización** activa **“Gráficos de fondo”** para que salga el encabezado en color. El contrato es texto, sale bien con los ajustes normales (tamaño Carta).

---

## Costos
Para un equipo de ventas pequeño todo cabe en los planes **gratuitos** de Supabase y Netlify. Si creces, el plan Pro de Supabase ronda los ~25 USD/mes.

## Respaldos
Supabase respalda automáticamente. Para exportar manualmente: **Table Editor →** cada tabla **→ Export to CSV**.

## Lo que sigue (cobranza)
El siguiente módulo de **cobranza de cartera** se conectará a estas mismas tablas: agregaremos `contratos` (al firmar) y `pagos` (calendario y abonos), con la misma lógica de TIIE + 8. Avísame cuando quieras y lo construimos encima de esto.

## Archivos del proyecto
| Archivo | Para qué |
|---|---|
| `index.html` | La aplicación |
| `styles.css` | Diseño |
| `app.js` | Lógica (login, calculadora, lotes, citas, contrato, ajustes) |
| `contrato.js` | Plantilla del contrato + importe en letra |
| `supabase-config.js` | **Tus credenciales** (editar) |
| `schema.sql` | Base de datos + permisos (correr una vez en Supabase) |
