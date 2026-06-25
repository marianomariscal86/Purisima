-- =====================================================================
--  HACIENDA LA PURÍSIMA · Esquema de base de datos (Supabase / PostgreSQL)
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
  puntos        numeric not null default 8,      -- puntos sobre la TIIE
  enganche_pct  numeric not null default 20,     -- enganche por defecto (%)
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
  updated_at    timestamptz not null default now(),
  unique (manzana, lote)
);

-- ---------------------------------------------------------------------
-- 5) CITAS  (módulo de citas para ventas y marketing)
-- ---------------------------------------------------------------------
create table if not exists public.citas (
  id               bigint generated always as identity primary key,
  cliente_nombre   text not null,
  cliente_telefono text default '',
  cliente_correo   text default '',
  fecha_hora       timestamptz not null,
  lote_id          bigint references public.lotes(id) on delete set null,
  asesor           text default '',
  origen           text default 'directo',  -- marketing, referido, redes, etc.
  estatus          text not null default 'agendada'
                    check (estatus in ('agendada','confirmada','realizada','cancelada','no_asistio')),
  notas            text default '',
  created_by       uuid references auth.users(id),
  created_at       timestamptz not null default now()
);

-- =====================================================================
--  SEGURIDAD A NIVEL DE FILA (RLS)
--  Regla general: hay que estar autenticado (con contraseña) para todo.
--  Solo 'admin' puede editar precios, tasa, datos de empresa.
-- =====================================================================
alter table public.profiles       enable row level security;
alter table public.tasa_config     enable row level security;
alter table public.empresa_config  enable row level security;
alter table public.lotes           enable row level security;
alter table public.citas           enable row level security;

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

-- CITAS: cualquier usuario autenticado (ventas/marketing/admin) crea y consulta.
-- Puede editar la cita quien la creó, o un admin. Solo admin borra.
drop policy if exists citas_select on public.citas;
create policy citas_select on public.citas for select
  to authenticated using (true);
drop policy if exists citas_insert on public.citas;
create policy citas_insert on public.citas for insert
  to authenticated with check (auth.uid() = created_by);
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
insert into public.lotes (manzana, lote, calle, superficie_m2, precio, estatus) values
  ('1','1','Paseo de los Encinos', 520, 1850000, 'disponible'),
  ('1','2','Paseo de los Encinos', 540, 1920000, 'disponible'),
  ('1','3','Paseo de los Encinos', 610, 2150000, 'apartado'),
  ('2','1','Camino del Ocote',     800, 2750000, 'disponible'),
  ('2','2','Camino del Ocote',     760, 2600000, 'vendido')
on conflict (manzana, lote) do nothing;

-- =====================================================================
--  IMPORTANTE — DESPUÉS DE CORRER ESTE SCRIPT:
--  1. Ve a Authentication > Users > Add user y crea tu usuario.
--  2. Vuelve aquí (SQL Editor) y conviértelo en admin con:
--       update public.profiles set role = 'admin' where email = 'TU_CORREO@ejemplo.com';
--  3. Crea los usuarios de ventas y marketing igual (quedan como 'ventas';
--     a los de marketing cámbiales el rol con:
--       update public.profiles set role = 'marketing' where email = '...';
-- =====================================================================
