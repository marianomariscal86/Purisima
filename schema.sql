-- =====================================================================
--  LA PURÍSIMA · Esquema de base de datos (Supabase / PostgreSQL)
--  Ejecuta este script COMPLETO en:  Supabase > SQL Editor > New query > Run
--  Crea tablas, roles, políticas de seguridad (RLS) y datos de ejemplo.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) PERFILES Y ROLES
--    Cada usuario que des de alta en Authentication tendrá aquí su rol.
--    Roles válidos: 'admin', 'ventas', 'marketing'
-- ---------------------------------------------------------------------
create table if not exists public.profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  email      text,
  nombre     text,
  role       text not null default 'ventas' check (role in ('admin','ventas','marketing')),
  created_at timestamptz not null default now()
);

-- Al crear un usuario en Authentication, se crea su perfil automáticamente
-- (rol inicial 'ventas'; luego lo cambias a admin/marketing si quieres).
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, nombre, role)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'nombre', new.email), 'ventas')
  on conflict (id) do nothing;
  return new;
end; $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Helper: ¿el usuario actual es admin?  (security definer evita recursión en RLS)
create or replace function public.es_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin');
$$;

-- ---------------------------------------------------------------------
-- 2) CONFIGURACIÓN DE TASA  (la usa la calculadora)
--    Una sola fila (id = 1). Solo admin la edita.
-- ---------------------------------------------------------------------
create table if not exists public.tasa_config (
  id            int primary key default 1,
  tiie          numeric not null default 6.76,   -- TIIE 28 días vigente (%)
  tiie_fecha    text default '',                 -- fecha de publicación (Banxico)
  tiie_auto     boolean not null default false,  -- true si el último valor vino de Banxico automático
  puntos        numeric not null default 8,      -- puntos sobre la TIIE
  enganche_pct  numeric not null default 35,     -- enganche por defecto (%), mínimo permitido 20%
  updated_at    timestamptz not null default now(),
  constraint solo_una_fila check (id = 1)
);

-- ---------------------------------------------------------------------
-- 3) CONFIGURACIÓN DE EMPRESA  (datos fijos que se imprimen en el contrato)
--    Una sola fila (id = 1). Solo admin la edita.
-- ---------------------------------------------------------------------
create table if not exists public.empresa_config (
  id                          int primary key default 1,
  ciudad_firma                text default 'Ciudad de México',
  razon_social                text default 'ZAACHILA',
  representante_legal         text default '',
  domicilio_vendedora         text default '',
  escritura_constitucion_num  text default '',
  escritura_constitucion_fecha text default '',
  notario_constitucion_num    text default '',
  ciudad_constitucion         text default '',
  escritura_fideic_num        text default '',
  notario_fideic_nombre       text default '',
  notario_fideic_num          text default '',
  ciudad_fideic               text default '',
  clabe                       text default '',
  banco                       text default '',
  testigo1                    text default '',
  testigo2                    text default '',
  updated_at                  timestamptz not null default now(),
  constraint solo_una_fila_emp check (id = 1)
);

-- ---------------------------------------------------------------------
-- 4) LOTES  (la lista de precios)
--    plano_recorte: nombre del recorte de imagen de esa manzana (para el
--    visor de plano). Lo llenas conforme subas los recortes a /planos/.
-- ---------------------------------------------------------------------
create table if not exists public.lotes (
  id            bigint generated always as identity primary key,
  manzana       text not null,
  lote          text not null,
  calle         text default '',
  superficie_m2 numeric not null default 0,
  precio        numeric not null default 0,
  estatus       text not null default 'disponible'
                 check (estatus in ('disponible','apartado','vendido')),
  plano_recorte text default '',
  updated_at    timestamptz not null default now(),
  unique (manzana, lote)
);

-- ---------------------------------------------------------------------
-- 5) EJECUTIVOS DE VENTAS
--    Cada ejecutivo de ventas tiene su propio calendario de horarios.
--    Se crea uno por cada usuario con rol 'ventas' (o lo da de alta admin).
-- ---------------------------------------------------------------------
create table if not exists public.ejecutivos (
  id          bigint generated always as identity primary key,
  user_id     uuid references auth.users(id) on delete set null,
  nombre      text not null,
  activo      boolean not null default true,
  created_at  timestamptz not null default now(),
  unique (nombre)
);

-- ---------------------------------------------------------------------
-- 6) HORARIOS DE DISPONIBILIDAD
--    Ventas (o admin) publica bloques recurrentes por día de semana
--    (0=domingo ... 6=sábado) o fechas específicas. Marketing agenda
--    citas de 2 horas dentro de estos bloques.
-- ---------------------------------------------------------------------
create table if not exists public.horarios_disponibilidad (
  id            bigint generated always as identity primary key,
  ejecutivo_id  bigint not null references public.ejecutivos(id) on delete cascade,
  dia_semana    int not null check (dia_semana between 0 and 6), -- 0=domingo, 6=sábado
  hora_inicio   time not null,
  hora_fin      time not null,
  activo        boolean not null default true,
  created_by    uuid references auth.users(id),
  created_at    timestamptz not null default now(),
  constraint horario_valido check (hora_fin > hora_inicio),
  unique (ejecutivo_id, dia_semana, hora_inicio, hora_fin)
);

-- ---------------------------------------------------------------------
-- 6b) EXCEPCIONES DE DISPONIBILIDAD (fecha específica)
--     Permite: dar horario distinto un día puntual, o bloquear el día
--     por completo (sin_disponibilidad = true), sin tocar el patrón
--     recurrente de horarios_disponibilidad.
-- ---------------------------------------------------------------------
create table if not exists public.horarios_excepciones (
  id                 bigint generated always as identity primary key,
  ejecutivo_id       bigint not null references public.ejecutivos(id) on delete cascade,
  fecha              date not null,
  hora_inicio        time,
  hora_fin           time,
  sin_disponibilidad boolean not null default false,
  created_by         uuid references auth.users(id),
  created_at         timestamptz not null default now(),
  unique (ejecutivo_id, fecha),
  constraint excepcion_valida check (
    sin_disponibilidad = true
    or (hora_inicio is not null and hora_fin is not null and hora_fin > hora_inicio)
  )
);

-- ---------------------------------------------------------------------
-- 7) CITAS  (módulo de citas — cada cita dura 2 horas con un ejecutivo)
-- ---------------------------------------------------------------------
create table if not exists public.citas (
  id               bigint generated always as identity primary key,
  cliente_nombre   text not null,
  cliente_telefono text default '',
  cliente_correo   text default '',
  ejecutivo_id     bigint references public.ejecutivos(id) on delete set null,
  fecha            date not null,
  hora_inicio      time not null,
  hora_fin         time not null,
  origen           text default 'directo',  -- marketing, referido, redes, etc.
  estatus          text not null default 'agendada'
                    check (estatus in ('agendada','confirmada','realizada','cancelada','no_asistio')),
  notas            text default '',
  created_by       uuid references auth.users(id),
  created_at       timestamptz not null default now()
);

-- Evita que un mismo ejecutivo tenga dos citas que se traslapen el mismo día
-- (requiere la extensión btree_gist, se activa abajo).
create extension if not exists btree_gist;

alter table public.citas drop constraint if exists no_traslape_citas;
alter table public.citas add constraint no_traslape_citas
  exclude using gist (
    ejecutivo_id with =,
    fecha with =,
    tsrange(fecha + hora_inicio, fecha + hora_fin) with &&
  ) where (estatus not in ('cancelada'));

-- =====================================================================
--  SEGURIDAD A NIVEL DE FILA (RLS)
--  Regla general: hay que estar autenticado (con contraseña) para todo.
--  Solo 'admin' puede editar precios, tasa, datos de empresa.
-- =====================================================================
alter table public.profiles              enable row level security;
alter table public.tasa_config            enable row level security;
alter table public.empresa_config         enable row level security;
alter table public.lotes                  enable row level security;
alter table public.ejecutivos             enable row level security;
alter table public.horarios_disponibilidad enable row level security;
alter table public.citas                  enable row level security;

-- PROFILES: cada quien ve el suyo; admin ve todos; admin edita roles.
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select
  using (id = auth.uid() or public.es_admin());
drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles for update
  using (public.es_admin()) with check (public.es_admin());

-- TASA: cualquier usuario autenticado la lee; solo admin la edita.
drop policy if exists tasa_select on public.tasa_config;
create policy tasa_select on public.tasa_config for select
  to authenticated using (true);
drop policy if exists tasa_update on public.tasa_config;
create policy tasa_update on public.tasa_config for update
  to authenticated using (public.es_admin()) with check (public.es_admin());

-- EMPRESA: autenticado lee; solo admin edita.
drop policy if exists emp_select on public.empresa_config;
create policy emp_select on public.empresa_config for select
  to authenticated using (true);
drop policy if exists emp_update on public.empresa_config;
create policy emp_update on public.empresa_config for update
  to authenticated using (public.es_admin()) with check (public.es_admin());

-- LOTES: autenticado lee toda la lista; solo admin crea/edita/borra.
drop policy if exists lotes_select on public.lotes;
create policy lotes_select on public.lotes for select
  to authenticated using (true);
drop policy if exists lotes_insert on public.lotes;
create policy lotes_insert on public.lotes for insert
  to authenticated with check (public.es_admin());
drop policy if exists lotes_update on public.lotes;
create policy lotes_update on public.lotes for update
  to authenticated using (public.es_admin()) with check (public.es_admin());
drop policy if exists lotes_delete on public.lotes;
create policy lotes_delete on public.lotes for delete
  to authenticated using (public.es_admin());

-- EJECUTIVOS: todos los autenticados ven la lista; admin da de alta/edita/borra.
-- Un ejecutivo de ventas también puede editar su propio registro (p.ej. activarse/desactivarse).
drop policy if exists ejecutivos_select on public.ejecutivos;
create policy ejecutivos_select on public.ejecutivos for select
  to authenticated using (true);
drop policy if exists ejecutivos_insert on public.ejecutivos;
create policy ejecutivos_insert on public.ejecutivos for insert
  to authenticated with check (public.es_admin());
drop policy if exists ejecutivos_update on public.ejecutivos;
create policy ejecutivos_update on public.ejecutivos for update
  to authenticated using (public.es_admin() or user_id = auth.uid())
  with check (public.es_admin() or user_id = auth.uid());
drop policy if exists ejecutivos_delete on public.ejecutivos;
create policy ejecutivos_delete on public.ejecutivos for delete
  to authenticated using (public.es_admin());

-- HORARIOS DE DISPONIBILIDAD:
-- Todos los autenticados los leen (marketing necesita verlos para agendar).
-- Los crea/edita/borra: admin, o el propio ejecutivo de ventas dueño del horario (rol 'ventas').
drop policy if exists horarios_select on public.horarios_disponibilidad;
create policy horarios_select on public.horarios_disponibilidad for select
  to authenticated using (true);
drop policy if exists horarios_insert on public.horarios_disponibilidad;
create policy horarios_insert on public.horarios_disponibilidad for insert
  to authenticated with check (
    public.es_admin() or
    exists (select 1 from public.ejecutivos e where e.id = ejecutivo_id and e.user_id = auth.uid())
  );
drop policy if exists horarios_update on public.horarios_disponibilidad;
create policy horarios_update on public.horarios_disponibilidad for update
  to authenticated using (
    public.es_admin() or
    exists (select 1 from public.ejecutivos e where e.id = ejecutivo_id and e.user_id = auth.uid())
  ) with check (
    public.es_admin() or
    exists (select 1 from public.ejecutivos e where e.id = ejecutivo_id and e.user_id = auth.uid())
  );
drop policy if exists horarios_delete on public.horarios_disponibilidad;
create policy horarios_delete on public.horarios_disponibilidad for delete
  to authenticated using (
    public.es_admin() or
    exists (select 1 from public.ejecutivos e where e.id = ejecutivo_id and e.user_id = auth.uid())
  );

-- EXCEPCIONES DE FECHA (mismo criterio que horarios_disponibilidad)
alter table public.horarios_excepciones enable row level security;
drop policy if exists excepciones_select on public.horarios_excepciones;
create policy excepciones_select on public.horarios_excepciones for select
  to authenticated using (true);
drop policy if exists excepciones_insert on public.horarios_excepciones;
create policy excepciones_insert on public.horarios_excepciones for insert
  to authenticated with check (
    public.es_admin() or
    exists (select 1 from public.ejecutivos e where e.id = ejecutivo_id and e.user_id = auth.uid())
  );
drop policy if exists excepciones_update on public.horarios_excepciones;
create policy excepciones_update on public.horarios_excepciones for update
  to authenticated using (
    public.es_admin() or
    exists (select 1 from public.ejecutivos e where e.id = ejecutivo_id and e.user_id = auth.uid())
  ) with check (
    public.es_admin() or
    exists (select 1 from public.ejecutivos e where e.id = ejecutivo_id and e.user_id = auth.uid())
  );
drop policy if exists excepciones_delete on public.horarios_excepciones;
create policy excepciones_delete on public.horarios_excepciones for delete
  to authenticated using (
    public.es_admin() or
    exists (select 1 from public.ejecutivos e where e.id = ejecutivo_id and e.user_id = auth.uid())
  );

-- CITAS: marketing y admin agendan; ventas solo consulta (son sus horarios los que se ocupan).
-- Puede editar/cancelar la cita quien la creó, o un admin.
drop policy if exists citas_select on public.citas;
create policy citas_select on public.citas for select
  to authenticated using (true);
drop policy if exists citas_insert on public.citas;
create policy citas_insert on public.citas for insert
  to authenticated with check (
    auth.uid() = created_by and
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('admin','marketing'))
  );
drop policy if exists citas_update on public.citas;
create policy citas_update on public.citas for update
  to authenticated using (created_by = auth.uid() or public.es_admin())
  with check (created_by = auth.uid() or public.es_admin());
drop policy if exists citas_delete on public.citas;
create policy citas_delete on public.citas for delete
  to authenticated using (public.es_admin());

-- =====================================================================
--  DATOS INICIALES
-- =====================================================================
insert into public.tasa_config (id) values (1) on conflict (id) do nothing;
insert into public.empresa_config (id) values (1) on conflict (id) do nothing;

-- Lotes de ejemplo (bórralos o edítalos a tu gusto desde la app)
insert into public.lotes (manzana, lote, calle, superficie_m2, precio, estatus, plano_recorte) values
  ('17','1','El Batán', 905.76, 1850000, 'disponible', 'manzana_17_recorte.jpg'),
  ('17','2','El Batán', 850.00, 1920000, 'disponible', 'manzana_17_recorte.jpg'),
  ('17','3','El Batán', 878.75, 2150000, 'apartado',   'manzana_17_recorte.jpg'),
  ('18','1','El Batán', 800.00, 2750000, 'disponible', 'manzana_18_recorte.jpg'),
  ('18','2','El Batán', 760.00, 2600000, 'vendido',    'manzana_18_recorte.jpg')
on conflict (manzana, lote) do nothing;

-- Ejecutivo de ejemplo (sin usuario ligado todavía) con horario L-S 9:00-13:00.
-- Edítalo o bórralo desde Ajustes una vez que tengas tus ejecutivos reales.
insert into public.ejecutivos (nombre) values ('Ejecutivo de ejemplo')
on conflict (nombre) do nothing;

insert into public.horarios_disponibilidad (ejecutivo_id, dia_semana, hora_inicio, hora_fin)
select e.id, d, '09:00', '13:00'
from public.ejecutivos e, unnest(array[1,2,3,4,5,6]) as d  -- lunes(1) a sábado(6)
where e.nombre = 'Ejecutivo de ejemplo'
on conflict (ejecutivo_id, dia_semana, hora_inicio, hora_fin) do nothing;

-- =====================================================================
--  IMPORTANTE — DESPUÉS DE CORRER ESTE SCRIPT:
--  1. Ve a Authentication > Users > Add user y crea tu usuario.
--  2. Vuelve aquí (SQL Editor) y conviértelo en admin con:
--       update public.profiles set role = 'admin' where email = 'TU_CORREO@ejemplo.com';
--  3. Crea los usuarios de ventas y marketing igual (quedan como 'ventas';
--     a los de marketing cámbiales el rol con:
--       update public.profiles set role = 'marketing' where email = '...';
--  4. Para cada persona de VENTAS, ligar su usuario a un ejecutivo
--     (así puede subir/editar su propio horario). Si ya existe el
--     ejecutivo de ejemplo, puedes reusar su fila:
--       update public.ejecutivos set user_id = 'UUID_DEL_USUARIO', nombre = 'Nombre real'
--       where nombre = 'Ejecutivo de ejemplo';
--     O da de alta uno nuevo desde la pestaña Ajustes > Ejecutivos (admin).
-- =====================================================================
