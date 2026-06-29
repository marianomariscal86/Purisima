/* =====================================================================
   LA PURÍSIMA — Lógica de la aplicación
===================================================================== */
(function(){
"use strict";

// ---- Conexión a Supabase ----
const cfg = window.PURISIMA_CONFIG || {};
if(!cfg.SUPABASE_URL || cfg.SUPABASE_URL.includes("TU-PROYECTO")){
  alert("Falta configurar supabase-config.js con tu URL y clave anon de Supabase.");
}
const sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);

// ---- Estado ----
const state = {
  user:null, role:null, tasa:null, empresa:null,
  lotes:[], citas:[], ejecutivos:[], horarios:[], excepciones:[],
  miEjecutivo:null // registro de "ejecutivos" ligado al usuario actual (si es ventas)
};

const DIAS = ["Domingo","Lunes","Martes","Miércoles","Jueves","Viernes","Sábado"];

// ---- Utilidades ----
const $  = s => document.querySelector(s);
const $$ = s => Array.from(document.querySelectorAll(s));
const money = n => "$" + (Number(n)||0).toLocaleString("es-MX",{minimumFractionDigits:2,maximumFractionDigits:2});
const parseMoney = s => Number(String(s).replace(/[^0-9.]/g,"")) || 0;
const esc = s => String(s==null?"":s).replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const hhmm = t => String(t||"").slice(0,5);

function imprimirHTML(html){
  const blob = new Blob([html], { type: "text/html" });
  const url = URL.createObjectURL(blob);
  const w = window.open(url, "_blank");
  if(!w){ alert("Permite las ventanas emergentes para exportar el PDF."); URL.revokeObjectURL(url); return; }
  w.addEventListener("load", () => {
    w.focus();
    w.print();
    setTimeout(()=> URL.revokeObjectURL(url), 60000);
  });
}

// =====================================================================
//  AUTENTICACIÓN
// =====================================================================

// ---- Vigía anti-cuelgue de sesión ----
// Si el token guardado en localStorage quedó corrupto/caducado de una sesión
// anterior, el SDK de Supabase puede tardar mucho (o nunca) en resolver el
// refresh automático, dejando la app pegada en "Entrando..." sin error visible.
// Esta función limpia las llaves de sesión de Supabase y recarga, una sola vez,
// si el login no resuelve en un tiempo razonable.
function limpiarSesionLocalYRecargar(){
  try{
    Object.keys(localStorage).forEach(k=>{ if(k.startsWith("sb-")) localStorage.removeItem(k); });
  }catch(e){ /* localStorage puede no estar disponible en algunos navegadores en modo privado */ }
  const yaReintento = sessionStorage.getItem("purisima_reintento_login");
  sessionStorage.setItem("purisima_reintento_login", "1");
  location.reload();
  return !yaReintento;
}

$("#loginForm").addEventListener("submit", async (e)=>{
  e.preventDefault();
  const btn = $("#loginBtn"); btn.disabled = true; btn.textContent = "Entrando…";
  $("#loginError").textContent = "";

  // Vigía: si en 8 segundos no hubo respuesta, asumimos sesión local corrupta.
  let resuelto = false;
  const vigia = setTimeout(()=>{
    if(resuelto) return;
    const yaReintento = sessionStorage.getItem("purisima_reintento_login");
    if(yaReintento){
      // Ya reintentamos una vez automáticamente y sigue sin responder: es un
      // problema real (de red o de Supabase), no de caché — avisamos en vez
      // de recargar en bucle infinito.
      btn.disabled = false; btn.textContent = "Entrar";
      $("#loginError").textContent = "No se pudo conectar. Revisa tu internet e intenta de nuevo.";
    } else {
      limpiarSesionLocalYRecargar();
    }
  }, 8000);

  const { error } = await sb.auth.signInWithPassword({
    email: $("#email").value.trim(), password: $("#password").value
  });
  resuelto = true;
  clearTimeout(vigia);
  sessionStorage.removeItem("purisima_reintento_login"); // login sí respondió: ya no es necesario el resguardo
  btn.disabled = false; btn.textContent = "Entrar";
  if(error) $("#loginError").textContent = "Correo o contraseña incorrectos.";
});

$("#logoutBtn").addEventListener("click", async ()=>{
  await sb.auth.signOut();
  try{ Object.keys(localStorage).forEach(k=>{ if(k.startsWith("sb-")) localStorage.removeItem(k); }); }catch(e){}
  location.reload();
});

sb.auth.onAuthStateChange(async (_e, session)=>{
  if(session && session.user){ await iniciarSesion(session.user); }
  else { $("#login").hidden = false; $("#app").hidden = true; }
});

// Envuelve cualquier promesa con un límite de tiempo; si se pasa, la rechaza
// en vez de dejar la app colgada para siempre esperando una respuesta que
// nunca llega (p.ej. por un token de sesión corrupto en una llamada autenticada).
function conTimeout(promesa, ms, etiqueta){
  return Promise.race([
    promesa,
    new Promise((_, reject)=> setTimeout(()=> reject(new Error(`Tiempo de espera agotado (${etiqueta})`)), ms))
  ]);
}

async function iniciarSesion(user){
  state.user = user;
  try{
    // Rol del usuario (con límite de tiempo: si la sesión local quedó
    // corrupta, esta consulta autenticada puede colgarse sin error visible).
    const { data: perfil } = await conTimeout(
      sb.from("profiles").select("role,nombre").eq("id", user.id).single(),
      10000, "perfil de usuario"
    );
    state.role = perfil ? perfil.role : "ventas";
    $("#login").hidden = true; $("#app").hidden = false;
    $("#userBadge").textContent = (perfil && perfil.nombre ? perfil.nombre : user.email) + " · " + state.role;
    // Mostrar/ocultar controles de admin
    const esAdmin = state.role === "admin";
    $$(".admin-only").forEach(el => el.hidden = !esAdmin);
    await conTimeout(cargarDatos(), 15000, "carga de datos");
    $("#ctFecha").value = new Date().toISOString().slice(0,10);
    $("#citaFecha").value = new Date().toISOString().slice(0,10);
    ajustarVisibilidadCitas();
    intentarActualizarTiieSiViejo(); // en segundo plano, sin bloquear la entrada
    sessionStorage.removeItem("purisima_reintento_sesion");
  }catch(err){
    console.error("Error iniciando sesión:", err);
    // Si esto fue por una sesión local corrupta, una sola limpieza+recarga
    // automática suele resolverlo. Si ya lo intentamos, mostramos el error
    // real en vez de recargar en bucle.
    const yaReintento = sessionStorage.getItem("purisima_reintento_sesion");
    if(!yaReintento){
      sessionStorage.setItem("purisima_reintento_sesion", "1");
      limpiarSesionLocalYRecargar();
    } else {
      $("#login").hidden = false; $("#app").hidden = true;
      $("#loginError").textContent = "No se pudo cargar tu sesión (" + err.message + "). Intenta de nuevo o contacta a soporte.";
    }
  }
}

// Ajusta qué tarjetas de Citas se ven según el rol:
// ventas -> solo su disponibilidad; marketing/admin -> solo agendar (admin ve ambas)
function ajustarVisibilidadCitas(){
  const esAdmin = state.role === "admin";
  const esVentas = state.role === "ventas";
  const esMarketing = state.role === "marketing";
  $("#cardDisponibilidad").hidden = !(esAdmin || esVentas);
  $("#cardAgendar").hidden = !(esAdmin || esMarketing);
}

// =====================================================================
//  NAVEGACIÓN POR PESTAÑAS
// =====================================================================
$("#tabs").addEventListener("click", (e)=>{
  const b = e.target.closest(".tab"); if(!b) return;
  $$(".tab").forEach(t=>t.classList.remove("is-active"));
  b.classList.add("is-active");
  $$(".panel").forEach(p=>p.hidden = true);
  $("#tab-"+b.dataset.tab).hidden = false;
});

// =====================================================================
//  CARGA DE DATOS
// =====================================================================
async function cargarDatos(){
  const [tasa, lotes, ejecutivos] = await Promise.all([
    sb.from("tasa_config").select("*").eq("id",1).single(),
    sb.from("lotes").select("*").order("manzana").order("lote"),
    sb.from("ejecutivos").select("*").order("nombre")
  ]);
  state.tasa  = tasa.data || {tiie:6.76, puntos:8, enganche_pct:35};
  state.lotes = lotes.data || [];
  state.ejecutivos = ejecutivos.data || [];
  state.miEjecutivo = state.ejecutivos.find(e => e.user_id === state.user.id) || null;

  $("#puntosLbl").textContent = state.tasa.puntos;
  $("#calcEnganche").value = state.tasa.enganche_pct;
  renderTiieAjustes();

  // empresa (todos la leen; solo admin la edita)
  const emp = await sb.from("empresa_config").select("*").eq("id",1).single();
  state.empresa = emp.data || {};

  llenarSelectLotes();
  renderLotes();
  renderAjustes();
  renderEjecutivosSelects();
  renderSelectorMasterplan();
  await cargarHorarios();
  await cargarCitas();
  renderEjecutivosTabla();
}

function lotesDisponibles(){ return state.lotes.filter(l => l.estatus === "disponible"); }

function llenarSelectLotes(){
  const optsDisp = ['<option value="">— Elegir lote disponible —</option>']
    .concat(lotesDisponibles().map(l =>
      `<option value="${l.id}">Mz ${esc(l.manzana)} · Lote ${esc(l.lote)} — ${money(l.precio)}</option>`));
  $("#calcLote").innerHTML = optsDisp.join("");

  const optsTodos = ['<option value="">— Elegir lote —</option>']
    .concat(state.lotes.map(l =>
      `<option value="${l.id}">Mz ${esc(l.manzana)} · Lote ${esc(l.lote)} — ${esc(l.estatus)}</option>`));
  $("#ctLote").innerHTML = optsTodos.join("");
}

function renderEjecutivosSelects(){
  const activos = state.ejecutivos.filter(e=>e.activo);
  const opts = ['<option value="">— Elegir ejecutivo —</option>']
    .concat(activos.map(e=>`<option value="${e.id}">${esc(e.nombre)}</option>`));
  $("#citaEjecutivo").innerHTML = opts.join("");

  // Selector de admin para ver/editar el horario de cualquier ejecutivo
  const optsAdmin = activos.map(e=>`<option value="${e.id}">${esc(e.nombre)}</option>`);
  $("#dispEjecutivoSelect").innerHTML = optsAdmin.join("") || '<option value="">Sin ejecutivos</option>';
  if(state.miEjecutivo){
    $("#dispEjecutivoSelect").value = state.miEjecutivo.id;
  }
}

// =====================================================================
//  CALCULADORA
// =====================================================================
let precioPrecargado = null;
let superficieSeleccionada = null;

$("#calcLote").addEventListener("change", ()=>{
  const l = state.lotes.find(x => String(x.id) === $("#calcLote").value);
  if(l){
    $("#calcManzana").value = l.manzana;
    $("#calcLoteNum").value = l.lote;
    $("#calcPrecio").value  = Number(l.precio).toFixed(2);
    precioPrecargado = Number(l.precio);
    superficieSeleccionada = Number(l.superficie_m2) || null;
    $("#precioHint").textContent = "Precio de lista del lote seleccionado.";
  }
  actualizarFinanciar();
});

$("#calcPrecio").addEventListener("input", ()=>{
  const val = parseMoney($("#calcPrecio").value);
  // Si el precio se modifica respecto al de lista, el lote queda "POR DEFINIR"
  if(precioPrecargado !== null && Math.abs(val - precioPrecargado) > 0.5){
    $("#calcManzana").value = "—";
    $("#calcLoteNum").value = "LOTE POR DEFINIR";
    $("#calcLote").value = "";
    precioPrecargado = null;
    superficieSeleccionada = null;
    $("#precioHint").textContent = "Precio modificado · el lote se definirá al elegir uno específico.";
  }
  actualizarFinanciar();
});

// Al escribir: solo actualiza el financiar sin forzar el clamp (para no interferir mientras escribe)
$("#calcEnganche").addEventListener("input", actualizarFinanciar);
// Al salir del campo: sí aplica el clamp (20-100) y corrige si se fue de rango
$("#calcEnganche").addEventListener("blur", ()=>{
  const raw = Number($("#calcEnganche").value);
  if(isNaN(raw) || raw < 20) $("#calcEnganche").value = 20;
  else if(raw > 100) $("#calcEnganche").value = 100;
  actualizarFinanciar();
});

function actualizarFinanciar(){
  const precio = parseMoney($("#calcPrecio").value);
  const raw = Number($("#calcEnganche").value);
  // Mientras el campo está vacío o incompleto al escribir, no calculamos
  if(!raw || raw < 1) return;
  const eng = Math.min(100, Math.max(20, raw));
  $("#calcFinanciar").value = money(precio * (1 - eng/100));
  // Si ya había un resultado calculado, lo invalidamos
  if(!$("#calcResultado").classList.contains("result-empty")){
    $("#calcResultado").innerHTML = '<div class="result-empty">Los datos cambiaron — presiona <b>Calcular</b> de nuevo.</div>';
    $("#calcPdfBtn").hidden = true;
  }
}

$("#calcBtn").addEventListener("click", ()=>{
  const precio = parseMoney($("#calcPrecio").value);
  if(precio <= 0){ $("#calcResultado").innerHTML = '<div class="result-empty">Ingresa un precio válido.</div>'; return; }
  const eng = Math.min(100, Math.max(20, Number($("#calcEnganche").value)||20));
  const financiar = precio * (1 - eng/100);
  const esVersionDos = eng >= 50; // 50%+ enganche → 12 meses sin intereses para liquidar, con 15% si paga a tiempo
  const plazoAnticipado = esVersionDos ? 12 : 90; // en meses para v2, en días para v1
  const descuentoPct = esVersionDos ? 10 : 15;
  const precioConDescuento = precio * (1 - descuentoPct/100);

  const filasPDF = [];
  let html;

  if(esVersionDos){
    // Condición de pago: 50% enganche + 12 meses sin intereses para liquidar el saldo.
    // Se muestra además la tabla de 12 mensualidades iguales como referencia, por si decide pagar en partes.
    const cuota12 = financiar / 12;
    html = `
      <div class="cuota-destacada">
        <p class="hint" style="margin:0 0 .3rem">Enganche ${eng}% · saldo restante ${money(financiar)}</p>
        <p class="mens" style="font-size:18px">12 meses sin intereses para liquidar el saldo</p>
        <p class="hint" style="margin:.4rem 0 0">Si liquida la totalidad dentro de esos 12 meses: <b>${money(precioConDescuento)}</b> (${descuentoPct}% de descuento sobre el precio total).</p>
      </div>
      <table class="cuotas">
        <thead><tr><th>Plazo</th><th>Mensualidad</th></tr></thead>
        <tbody><tr><td class="plazo">12 meses sin intereses</td><td class="mens">${money(cuota12)}</td></tr></tbody>
      </table>
      <p class="hint">Referencia si decide pagar en 12 partes iguales, sin intereses, dentro del plazo de gracia.</p>
      <p class="micro">Si no liquida el saldo dentro de los 12 meses, no habrá descuento y este se financiará a 60 meses con intereses (TIIE + ${state.tasa.puntos} puntos), conforme al contrato.</p>`;
    filasPDF.push({n:12, cuota:cuota12, total:cuota12*12, sinIntereses:true});
  } else {
    // ---- Opción de pago anticipado (90 días, 15%) ----
    html = `
      <div class="cuota-destacada">
        <p class="hint" style="margin:0 0 .3rem">Pagando el saldo total en ${plazoAnticipado} días</p>
        <p class="mens" style="font-size:20px">${money(precioConDescuento)} <span class="hint">(${descuentoPct}% de descuento sobre el precio total)</span></p>
      </div>`;

    const tasaAnual = (Number(state.tasa.tiie) + Number(state.tasa.puntos)) / 100;
    const i = tasaAnual / 12;
    const plazos = [12,24,36,48,60];
    let rows = "";
    plazos.forEach(n=>{
      const cuota = i > 0 ? financiar * i / (1 - Math.pow(1+i, -n)) : financiar / n;
      const total = cuota * n;
      rows += `<tr><td class="plazo">${n} meses</td><td class="mens">${money(cuota)}</td></tr>`;
      filasPDF.push({n, cuota, total});
    });
    html += `
      <table class="cuotas">
        <thead><tr><th>Plazo</th><th>Mensualidad</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <p class="hint">Monto a financiar ${money(financiar)} · tasa anual ${(tasaAnual*100).toFixed(2)}% (TIIE ${state.tasa.tiie}% + ${state.tasa.puntos}).</p>`;
  }

  $("#calcResultado").innerHTML = html;
  $("#calcPdfBtn").hidden = false;
  $("#calcPdfBtn").onclick = ()=> exportarCotizacion({precio, eng, financiar, esVersionDos, plazoAnticipado, descuentoPct, precioConDescuento, filasPDF, superficie: superficieSeleccionada});
});

function exportarCotizacion(d){
  const cliente = $("#calcCliente").value.trim() || "—";
  const manzana = $("#calcManzana").value || "—";
  const loteNum = $("#calcLoteNum").value || "Por definir";
  const hoy = new Date().toLocaleDateString("es-MX",{day:"2-digit",month:"long",year:"numeric"});
  const logoUrl = new URL("assets/logo_arbol.png", window.location.href).href;
  const supTxt = d.superficie ? `${Number(d.superficie).toLocaleString("es-MX")} m²` : "—";
  const filas = d.filasPDF.map(f=>`<tr><td>${f.n} meses${f.sinIntereses?' sin intereses':''}</td><td style="text-align:right">${money(f.cuota)}</td></tr>`).join("");
  const html = `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><title>Cotización</title>
  <style>
    @page{size:Letter;margin:2cm}
    body{font-family:Arial,Helvetica,sans-serif;color:#292420;margin:0}
    .head{display:flex;align-items:center;gap:14px;border-bottom:2px solid #213d2e;padding-bottom:12px;margin-bottom:16px}
    .head img{width:46px;height:auto}
    .head .brand{font-size:18px;font-weight:bold;color:#213d2e}
    .meta{text-align:right;font-size:12px;color:#6e6557;margin-left:auto}
    h2{font-size:13px;text-transform:uppercase;letter-spacing:1px;color:#a8842c;margin:22px 0 8px}
    .box{background:#f6f2e9;border:1px solid #dcd4c6;border-radius:8px;padding:14px 16px;font-size:14px}
    .box div{margin-bottom:5px}
    table{width:100%;border-collapse:collapse;margin-top:6px;font-size:14px}
    th,td{padding:9px 8px;border-bottom:1px solid #dcd4c6}
    th{background:#213d2e;color:#fff;text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:.5px}
    th:nth-child(2){text-align:right}
    .foot{margin-top:24px;font-size:10px;color:#6e6557;border-top:1px solid #dcd4c6;padding-top:12px}
    .grand{font-weight:bold;color:#213d2e}
  </style></head><body>
  <div class="head">
    <img src="${logoUrl}" alt="La Purísima">
    <div class="brand">La Purísima</div>
    <div class="meta">${hoy}</div>
  </div>
  <h2>Datos de la cotización</h2>
  <div class="box">
    <div><b>Cliente:</b> ${esc(cliente)}</div>
    <div><b>Lote:</b> Manzana ${esc(manzana)} · Lote ${esc(loteNum)}</div>
    <div><b>Superficie:</b> ${supTxt}</div>
    <div><b>Precio:</b> ${money(d.precio)}</div>
    <div><b>Enganche (${d.eng}%):</b> ${money(d.precio*d.eng/100)}</div>
    <div class="grand"><b>Monto a financiar:</b> ${money(d.financiar)}</div>
  </div>
  ${d.esVersionDos ? `
  <h2>Condición de pago</h2>
  <div class="box">
    <div>Plazo de 12 meses sin intereses para liquidar el saldo de ${money(d.financiar)}.</div>
    <div class="grand">Si liquida la totalidad dentro de esos 12 meses: ${money(d.precioConDescuento)} (${d.descuentoPct}% de descuento sobre el precio total).</div>
  </div>
  <h2>Referencia: 12 mensualidades iguales sin intereses</h2>
  <table><thead><tr><th>Plazo</th><th>Mensualidad</th></tr></thead><tbody>${filas}</tbody></table>
  <div class="foot">
    Referencia si decide pagar en 12 partes iguales, sin intereses, dentro del plazo de gracia. Si no liquida la totalidad dentro de los 12 meses, o de que haya un retraso en dos o más mensualidades, no aplicará el descuento y el saldo que exista en ese momento se financiará automáticamente a 60 meses con intereses (TIIE + ${state.tasa.puntos} puntos sobre saldos insolutos), conforme al contrato. No constituye oferta vinculante. Sujeta a disponibilidad y aprobación.
  </div>` : `
  <h2>Opción de pago anticipado</h2>
  <div class="box">
    <div class="grand">Pagando el saldo total en ${d.plazoAnticipado} días: ${money(d.precioConDescuento)}</div>
    <div>(${d.descuentoPct}% de descuento sobre el precio total, definitivo y liquidatorio)</div>
  </div>
  <h2>Opciones de financiamiento (pagos iguales)</h2>
  <table><thead><tr><th>Plazo</th><th>Mensualidad</th></tr></thead><tbody>${filas}</tbody></table>
  <div class="foot">
    El descuento no aplica si no se paga la totalidad del saldo dentro de los ${d.plazoAnticipado} días; en ese caso, el saldo que exista en ese momento se financiará automáticamente conforme a las opciones de la tabla anterior, con tasa anual estimada (TIIE ${state.tasa.tiie}% + ${state.tasa.puntos} puntos), sobre saldos insolutos. Estimación con tasa fija al valor de TIIE vigente; el contrato pacta tasa <b>variable</b>, ajustada mensualmente conforme a la TIIE publicada por Banco de México. No constituye oferta vinculante. Sujeta a disponibilidad y aprobación.
  </div>`}
  </body></html>`;
  imprimirHTML(html);
}

// =====================================================================
//  LISTA DE PRECIOS
// =====================================================================
function renderLotes(){
  const esAdmin = state.role === "admin";
  $$("#tab-lotes .admin-only").forEach(el=>el.hidden = !esAdmin);
  const tbody = $("#lotesTable tbody");
  tbody.innerHTML = state.lotes.map(l=>`
    <tr data-id="${l.id}">
      <td>${esc(l.manzana)}</td>
      <td>${esc(l.lote)}</td>
      <td>${esc(l.calle)}</td>
      <td style="text-align:right">${Number(l.superficie_m2).toLocaleString("es-MX")}</td>
      <td style="text-align:right">${money(l.precio)}</td>
      <td><span class="pill ${esc(l.estatus)}">${esc(l.estatus)}</span></td>
      <td>${l.plano_recorte ? '<span class="hint">✓ '+esc(l.plano_recorte)+'</span>' : '<span class="hint">— sin asignar</span>'}</td>
      ${esAdmin ? `<td><button class="btn-mini" data-edit="${l.id}">Editar</button></td>` : ``}
    </tr>`).join("");
}

$("#lotesTable").addEventListener("click", (e)=>{
  const b = e.target.closest("[data-edit]"); if(!b) return;
  editarLote(state.lotes.find(l=>String(l.id)===b.dataset.edit));
});

function editarLote(l){
  const tr = $(`#lotesTable tr[data-id="${l.id}"]`);
  tr.classList.add("editrow");
  tr.innerHTML = `
    <td><input value="${esc(l.manzana)}" data-f="manzana" style="width:46px"></td>
    <td><input value="${esc(l.lote)}" data-f="lote" style="width:46px"></td>
    <td><input value="${esc(l.calle)}" data-f="calle"></td>
    <td><input value="${l.superficie_m2}" data-f="superficie_m2" style="width:70px"></td>
    <td><input value="${l.precio}" data-f="precio" style="width:110px"></td>
    <td><select data-f="estatus">
      ${["disponible","apartado","vendido"].map(s=>`<option ${s===l.estatus?"selected":""}>${s}</option>`).join("")}
    </select></td>
    <td><input value="${esc(l.plano_recorte||"")}" data-f="plano_recorte" placeholder="archivo.jpg" style="width:120px"></td>
    <td><button class="btn-mini" data-save="${l.id}">Guardar</button></td>`;
  tr.querySelector("[data-save]").addEventListener("click", ()=>guardarLote(l.id, tr));
}

async function guardarLote(id, tr){
  const obj = {};
  tr.querySelectorAll("[data-f]").forEach(inp=> obj[inp.dataset.f] = inp.value);
  obj.superficie_m2 = parseMoney(obj.superficie_m2);
  obj.precio = parseMoney(obj.precio);
  obj.updated_at = new Date().toISOString();
  let res;
  if(id === "nuevo"){ res = await sb.from("lotes").insert(obj).select(); }
  else { res = await sb.from("lotes").update(obj).eq("id", id); }
  if(res.error){
    const msg = res.error.message.includes("duplicate key")
      ? `Ya existe un lote con Manzana ${obj.manzana} y Lote ${obj.lote}. Cambia el número de manzana o lote.`
      : res.error.message;
    alert("No se pudo guardar: " + msg);
    return;
  }
  await cargarDatos();
}

$("#nuevoLoteBtn").addEventListener("click", ()=>{
  const tbody = $("#lotesTable tbody");
  const tr = document.createElement("tr");
  tr.className = "editrow"; tr.dataset.id = "nuevo";
  tr.innerHTML = `
    <td><input data-f="manzana" style="width:46px" placeholder="Mz"></td>
    <td><input data-f="lote" style="width:46px" placeholder="Lote"></td>
    <td><input data-f="calle" placeholder="Calle"></td>
    <td><input data-f="superficie_m2" style="width:70px" placeholder="m²"></td>
    <td><input data-f="precio" style="width:110px" placeholder="Precio"></td>
    <td><select data-f="estatus"><option>disponible</option><option>apartado</option><option>vendido</option></select></td>
    <td><input data-f="plano_recorte" placeholder="archivo.jpg" style="width:120px"></td>
    <td><button class="btn-mini" data-save="nuevo">Guardar</button></td>`;
  tbody.prepend(tr);
  tr.querySelector("[data-save]").addEventListener("click", ()=>guardarLote("nuevo", tr));
});

// =====================================================================
//  CITAS — DISPONIBILIDAD (calendario: recurrente + excepciones por fecha)
// =====================================================================
const calState = { weekOffset: 0, modo: "recurrente", selectedDate: null };

async function cargarHorarios(){
  const [hor, exc] = await Promise.all([
    sb.from("horarios_disponibilidad").select("*").eq("activo", true).order("dia_semana").order("hora_inicio"),
    sb.from("horarios_excepciones").select("*")
  ]);
  state.horarios = hor.data || [];
  state.excepciones = exc.data || [];
  renderCalendario();
}

function ejecutivoActivoParaDisponibilidad(){
  // admin puede elegir cualquier ejecutivo desde el select; ventas siempre ve el suyo
  if(state.role === "admin"){
    const id = $("#dispEjecutivoSelect").value;
    return state.ejecutivos.find(e=>String(e.id)===String(id)) || null;
  }
  return state.miEjecutivo;
}

function lunesDeSemana(offset){
  const d = new Date();
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1) + offset*7;
  d.setDate(diff);
  d.setHours(0,0,0,0);
  return d;
}
function fechaISO(d){ return d.toISOString().slice(0,10); }

function renderCalendario(){
  const ej = ejecutivoActivoParaDisponibilidad();
  if(!ej){
    $("#dispEjecutivoHint").textContent = state.role === "ventas"
      ? "Tu usuario aún no está ligado a un ejecutivo. Pide al admin que te ligue desde Ajustes."
      : "Selecciona un ejecutivo para ver/editar su horario.";
    $("#calGrid").innerHTML = "";
    $("#calPanel").innerHTML = '<p class="hint">Sin ejecutivo seleccionado.</p>';
    return;
  }
  $("#dispEjecutivoHint").textContent = "Mostrando horario de: " + ej.nombre;

  const lunes = lunesDeSemana(calState.weekOffset);
  const domingo = new Date(lunes); domingo.setDate(lunes.getDate()+6);
  $("#calWeekLabel").textContent =
    lunes.toLocaleDateString("es-MX",{day:"numeric",month:"short"}) + " – " +
    domingo.toLocaleDateString("es-MX",{day:"numeric",month:"short"});

  const recurrentePorDia = {};
  state.horarios.filter(h=>h.ejecutivo_id===ej.id).forEach(h=>{
    (recurrentePorDia[h.dia_semana] = recurrentePorDia[h.dia_semana] || []).push(h);
  });
  const excepcionesPorFecha = {};
  state.excepciones.filter(x=>x.ejecutivo_id===ej.id).forEach(x=>{ excepcionesPorFecha[x.fecha] = x; });

  const grid = $("#calGrid");
  grid.innerHTML = "";
  const diasOrden = [1,2,3,4,5,6,0]; // lunes..domingo
  diasOrden.forEach((dow, idx)=>{
    const date = new Date(lunes); date.setDate(lunes.getDate()+idx);
    const iso = fechaISO(date);
    const exc = excepcionesPorFecha[iso];
    const rec = recurrentePorDia[dow];

    let clase = "cal-day";
    let hintTxt = "—";
    if(exc){
      if(exc.sin_disponibilidad){ clase += " sin-disponibilidad"; hintTxt = "Bloqueado"; }
      else { clase += " has-especifico"; hintTxt = hhmm(exc.hora_inicio)+"–"+hhmm(exc.hora_fin); }
    } else if(rec && rec.length){
      clase += " has-recurrente"; hintTxt = hhmm(rec[0].hora_inicio)+"–"+hhmm(rec[0].hora_fin);
    }
    if(calState.selectedDate === iso) clase += " is-selected";

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = clase;
    btn.innerHTML = `<span class="cal-day-name">${DIAS[dow].slice(0,3)}</span>
      <span class="cal-day-num">${date.getDate()}</span>
      <span class="cal-day-hint">${hintTxt}</span>`;
    btn.addEventListener("click", ()=>{ calState.selectedDate = iso; calState.selectedDow = dow; renderCalendario(); });
    grid.appendChild(btn);
  });

  renderPanelDia(ej);
}

function renderPanelDia(ej){
  const panel = $("#calPanel");
  if(!calState.selectedDate){
    panel.innerHTML = '<p class="hint">Elige un día del calendario para agregar o quitar disponibilidad.</p>';
    return;
  }
  const dow = calState.selectedDow;
  const iso = calState.selectedDate;
  const dateObj = new Date(iso+"T00:00:00");
  const labelFecha = DIAS[dow] + " " + dateObj.getDate() + " de " + dateObj.toLocaleDateString("es-MX",{month:"long",year:"numeric"});

  if(calState.modo === "recurrente"){
    const existente = state.horarios.find(h=>h.ejecutivo_id===ej.id && h.dia_semana===dow);
    panel.innerHTML = `
      <p class="cal-panel-title">${DIAS[dow]} (se repite todas las semanas)</p>
      <div class="cal-panel-row">
        <input type="time" id="calHi" value="${existente?hhmm(existente.hora_inicio):'09:00'}">
        <span class="hint">a</span>
        <input type="time" id="calHf" value="${existente?hhmm(existente.hora_fin):'13:00'}">
      </div>
      <div class="cal-panel-actions">
        <button class="btn btn-primary" id="calGuardarRec">${existente?'Actualizar':'Agregar'} horario</button>
        ${existente?'<button class="btn-mini" id="calQuitarRec">Quitar</button>':''}
      </div>
      <p id="calMsgRec" class="hint" style="margin-top:.5rem"></p>`;

    $("#calGuardarRec").addEventListener("click", async ()=>{
      const hi = $("#calHi").value, hf = $("#calHf").value;
      if(hf <= hi){ $("#calMsgRec").textContent = "La hora fin debe ser mayor a la hora inicio."; return; }
      let error;
      if(existente){
        ({error} = await sb.from("horarios_disponibilidad").update({hora_inicio:hi, hora_fin:hf}).eq("id", existente.id));
      } else {
        ({error} = await sb.from("horarios_disponibilidad").insert({
          ejecutivo_id: ej.id, dia_semana: dow, hora_inicio: hi, hora_fin: hf, created_by: state.user.id
        }));
      }
      $("#calMsgRec").textContent = error ? ("Error: "+error.message) : "Guardado.";
      if(!error) await cargarHorarios();
    });
    if(existente){
      $("#calQuitarRec").addEventListener("click", async ()=>{
        const { error } = await sb.from("horarios_disponibilidad").update({activo:false}).eq("id", existente.id);
        if(error){ $("#calMsgRec").textContent = "Error: "+error.message; return; }
        await cargarHorarios();
      });
    }
  } else {
    const exc = state.excepciones.find(x=>x.ejecutivo_id===ej.id && x.fecha===iso);
    panel.innerHTML = `
      <p class="cal-panel-title">${labelFecha} (solo este día)</p>
      <div class="cal-panel-row">
        <input type="time" id="calHi2" value="${exc && !exc.sin_disponibilidad?hhmm(exc.hora_inicio):'09:00'}">
        <span class="hint">a</span>
        <input type="time" id="calHf2" value="${exc && !exc.sin_disponibilidad?hhmm(exc.hora_fin):'13:00'}">
      </div>
      <div class="cal-panel-actions">
        <button class="btn btn-primary" id="calGuardarExc">${exc?'Actualizar':'Agregar'} para este día</button>
        <button class="btn-mini" id="calBloquearDia">Bloquear este día (sin disponibilidad)</button>
        ${exc?'<button class="btn-mini" id="calQuitarExc">Quitar excepción</button>':''}
      </div>
      <p id="calMsgExc" class="hint" style="margin-top:.5rem"></p>
      <p class="micro">Esto reemplaza el horario recurrente solo para ${labelFecha}, sin afectar otras semanas.</p>`;

    $("#calGuardarExc").addEventListener("click", async ()=>{
      const hi = $("#calHi2").value, hf = $("#calHf2").value;
      if(hf <= hi){ $("#calMsgExc").textContent = "La hora fin debe ser mayor a la hora inicio."; return; }
      const { error } = await sb.from("horarios_excepciones").upsert({
        ejecutivo_id: ej.id, fecha: iso, hora_inicio: hi, hora_fin: hf, sin_disponibilidad: false, created_by: state.user.id
      }, { onConflict: "ejecutivo_id,fecha" });
      $("#calMsgExc").textContent = error ? ("Error: "+error.message) : "Guardado.";
      if(!error) await cargarHorarios();
    });
    $("#calBloquearDia").addEventListener("click", async ()=>{
      const { error } = await sb.from("horarios_excepciones").upsert({
        ejecutivo_id: ej.id, fecha: iso, hora_inicio: null, hora_fin: null, sin_disponibilidad: true, created_by: state.user.id
      }, { onConflict: "ejecutivo_id,fecha" });
      $("#calMsgExc").textContent = error ? ("Error: "+error.message) : "Día bloqueado.";
      if(!error) await cargarHorarios();
    });
    if(exc){
      $("#calQuitarExc").addEventListener("click", async ()=>{
        const { error } = await sb.from("horarios_excepciones").delete().eq("id", exc.id);
        if(error){ $("#calMsgExc").textContent = "Error: "+error.message; return; }
        await cargarHorarios();
      });
    }
  }
}

$("#dispEjecutivoSelect").addEventListener("change", ()=>{ calState.selectedDate = null; renderCalendario(); });
$("#calPrevBtn").addEventListener("click", ()=>{ calState.weekOffset--; calState.selectedDate = null; renderCalendario(); });
$("#calNextBtn").addEventListener("click", ()=>{ calState.weekOffset++; calState.selectedDate = null; renderCalendario(); });
$("#calModeRecurrente").addEventListener("click", ()=>{
  calState.modo = "recurrente";
  $("#calModeRecurrente").classList.add("is-active"); $("#calModeEspecifico").classList.remove("is-active");
  renderCalendario();
});
$("#calModeEspecifico").addEventListener("click", ()=>{
  calState.modo = "especifico";
  $("#calModeEspecifico").classList.add("is-active"); $("#calModeRecurrente").classList.remove("is-active");
  renderCalendario();
});

// ---- Generación de slots de 2 horas disponibles para agendar ----
// Prioridad: excepción de ese día (bloqueo o horario específico) > horario recurrente.
function slotsDelDia(ejecutivoId, fechaStr){
  const fecha = new Date(fechaStr + "T00:00:00");
  const diaSemana = fecha.getDay();
  const exc = (state.excepciones||[]).find(x => x.ejecutivo_id === Number(ejecutivoId) && x.fecha === fechaStr);

  let bloques;
  if(exc){
    if(exc.sin_disponibilidad) return []; // día bloqueado, sin slots
    bloques = [{ hora_inicio: exc.hora_inicio, hora_fin: exc.hora_fin }];
  } else {
    bloques = state.horarios.filter(h => h.ejecutivo_id === Number(ejecutivoId) && h.dia_semana === diaSemana);
  }

  const ocupadas = state.citas.filter(c => c.ejecutivo_id === Number(ejecutivoId) && c.fecha === fechaStr && c.estatus !== "cancelada");

  const slots = [];
  bloques.forEach(b=>{
    let [h,m] = b.hora_inicio.split(":").map(Number);
    const [hf,mf] = b.hora_fin.split(":").map(Number);
    let actual = h*60+m;
    const fin = hf*60+mf;
    while(actual + 120 <= fin){
      const ini = actual, term = actual + 120;
      const iniStr = String(Math.floor(ini/60)).padStart(2,"0") + ":" + String(ini%60).padStart(2,"0");
      const termStr = String(Math.floor(term/60)).padStart(2,"0") + ":" + String(term%60).padStart(2,"0");
      const choca = ocupadas.some(c => !(termStr <= hhmm(c.hora_inicio) || iniStr >= hhmm(c.hora_fin)));
      if(!choca) slots.push({inicio: iniStr, fin: termStr});
      actual += 120;
    }
  });
  return slots;
}

function actualizarSlotsCita(){
  const ejId = $("#citaEjecutivo").value;
  const fecha = $("#citaFecha").value;
  const sel = $("#citaSlot");
  if(!ejId || !fecha){ sel.innerHTML = '<option value="">— Elige fecha y ejecutivo primero —</option>'; return; }
  const slots = slotsDelDia(ejId, fecha);
  if(!slots.length){ sel.innerHTML = '<option value="">Sin horarios disponibles ese día</option>'; return; }
  sel.innerHTML = slots.map(s=>`<option value="${s.inicio}|${s.fin}">${s.inicio} – ${s.fin}</option>`).join("");
}
$("#citaEjecutivo").addEventListener("change", actualizarSlotsCita);
$("#citaFecha").addEventListener("change", actualizarSlotsCita);

async function cargarCitas(){
  const { data } = await sb.from("citas").select("*").order("fecha",{ascending:true}).order("hora_inicio",{ascending:true});
  state.citas = data || [];
  renderCitas();
  actualizarSlotsCita();
}

function renderCitas(){
  const tbody = $("#citasTable tbody");
  if(!state.citas.length){ tbody.innerHTML = `<tr><td colspan="5" style="color:#6e6557">Sin citas agendadas.</td></tr>`; return; }
  tbody.innerHTML = state.citas.map(c=>{
    const ej = state.ejecutivos.find(x=>x.id===c.ejecutivo_id);
    const fecha = new Date(c.fecha + "T00:00:00").toLocaleDateString("es-MX",{day:"2-digit",month:"short"});
    const puede = (c.created_by === state.user.id) || state.role === "admin";
    const sel = puede
      ? `<select data-cita="${c.id}">${["agendada","confirmada","realizada","cancelada","no_asistio"].map(s=>`<option ${s===c.estatus?"selected":""}>${s}</option>`).join("")}</select>`
      : esc(c.estatus);
    return `<tr>
      <td>${fecha}</td>
      <td>${hhmm(c.hora_inicio)}–${hhmm(c.hora_fin)}</td>
      <td>${esc(c.cliente_nombre)}<br><span class="hint">${esc(c.origen)}</span></td>
      <td>${ej?esc(ej.nombre):"—"}</td>
      <td>${sel}</td>
    </tr>`;
  }).join("");
  $$("#citasTable [data-cita]").forEach(s=>{
    s.addEventListener("change", async ()=>{
      const { error } = await sb.from("citas").update({estatus:s.value}).eq("id", s.dataset.cita);
      if(error) alert("No se pudo actualizar: " + error.message);
      else await cargarCitas();
    });
  });
}

$("#citaBtn").addEventListener("click", async ()=>{
  const nombre = $("#citaNombre").value.trim();
  const ejId = $("#citaEjecutivo").value;
  const fecha = $("#citaFecha").value;
  const slot = $("#citaSlot").value;
  if(!nombre || !ejId || !fecha || !slot){
    $("#citaMsg").textContent = "Completa cliente, ejecutivo, fecha y horario."; return;
  }
  const [hi, hf] = slot.split("|");
  const obj = {
    cliente_nombre: nombre,
    cliente_telefono: $("#citaTel").value.trim(),
    cliente_correo: $("#citaCorreo").value.trim(),
    ejecutivo_id: Number(ejId),
    fecha: fecha,
    hora_inicio: hi,
    hora_fin: hf,
    origen: $("#citaOrigen").value,
    notas: $("#citaNotas").value.trim(),
    created_by: state.user.id
  };
  const { error } = await sb.from("citas").insert(obj);
  if(error){
    $("#citaMsg").textContent = error.message.includes("no_traslape_citas")
      ? "Ese horario ya se ocupó, elige otro."
      : "Error: " + error.message;
    return;
  }
  $("#citaMsg").textContent = "Cita agendada.";
  ["#citaNombre","#citaTel","#citaCorreo","#citaNotas"].forEach(s=>$(s).value="");
  await cargarCitas();
});

// =====================================================================
//  CONTRATO
// =====================================================================
$("#ctLote").addEventListener("change", ()=>{
  const l = state.lotes.find(x=>String(x.id)===$("#ctLote").value);
  if(l){
    $("#ctManzana").value = l.manzana;
    $("#ctLoteNum").value = l.lote;
    $("#ctCalle").value   = l.calle;
    $("#ctSup").value     = l.superficie_m2;   // siempre del inventario, solo lectura
    $("#ctPrecio").value  = Number(l.precio).toFixed(2);
    $("#ctVerPlanoBtn").disabled = false;
    if(l.estatus === "vendido"){
      $("#ctAviso").hidden = false; $("#ctAviso").textContent = "Atención: este lote está marcado como VENDIDO.";
    } else $("#ctAviso").hidden = true;
  } else {
    $("#ctVerPlanoBtn").disabled = true;
  }
  resumenContrato();
});
$("#ctPrecio").addEventListener("input", resumenContrato);
$("#ctEnganche").addEventListener("input", resumenContrato);

function resumenContrato(){
  const p = parseMoney($("#ctPrecio").value);
  const eng = Math.min(100, Math.max(20, Number($("#ctEnganche").value)||20));
  $("#ctEnganche").value = eng;
  const esVersionDos = eng >= 50;
  $("#ctPlazoLabel").hidden = esVersionDos; // el plazo de respaldo solo se elige en la versión <50% (la de 50%+ siempre es 60 meses)
  if(p>0){
    const version = esVersionDos ? "Versión 365 días / 12 mensualidades, 10% si liquida a tiempo" : "Versión 90 días, 15% si liquida a tiempo";
    $("#ctResumen").innerHTML = `Precio ${money(p)} · enganche ${eng}% ${money(p*eng/100)} · saldo ${money(p*(1-eng/100))} · <b>${version}</b>.`;
  } else {
    $("#ctResumen").textContent = "Selecciona un lote y captura el precio.";
  }
}

$("#ctGenerarBtn").addEventListener("click", ()=>{
  const precio = parseMoney($("#ctPrecio").value);
  const engPct = Math.min(100, Math.max(20, Number($("#ctEnganche").value)||20));
  if(!$("#ctNombre").value.trim() || precio<=0){
    alert("Captura el nombre del comprador y un precio válido."); return;
  }
  const e = state.empresa || {};
  const fechaTxt = $("#ctFecha").value
    ? new Date($("#ctFecha").value + "T12:00:00").toLocaleDateString("es-MX",{day:"2-digit",month:"long",year:"numeric"})
    : "";
  const data = {
    ciudad_firma: e.ciudad_firma, razon_social: e.razon_social, representante: e.representante_legal,
    domicilio_vendedora: e.domicilio_vendedora,
    escritura_constitucion_num: e.escritura_constitucion_num, escritura_constitucion_fecha: e.escritura_constitucion_fecha,
    notario_constitucion_num: e.notario_constitucion_num, ciudad_constitucion: e.ciudad_constitucion,
    escritura_fideic_num: e.escritura_fideic_num, notario_fideic_nombre: e.notario_fideic_nombre,
    notario_fideic_num: e.notario_fideic_num, ciudad_fideic: e.ciudad_fideic,
    clabe: e.clabe, banco: e.banco, testigo1: e.testigo1, testigo2: e.testigo2,
    fecha_firma: fechaTxt,
    nombre: $("#ctNombre").value.trim(), nacionalidad: $("#ctNac").value.trim(),
    domicilio_comprador: $("#ctDom").value.trim(), correo: $("#ctCorreo").value.trim(), rfc: $("#ctRfc").value.trim(),
    manzana: $("#ctManzana").value, lote: $("#ctLoteNum").value, calle: $("#ctCalle").value,
    superficie_m2: $("#ctSup").value, precio: precio, enganche_pct: engPct,
    plazo_meses: Number($("#ctPlazo").value) || 60
  };
  imprimirHTML(construirContratoHTML(data));
});

// ---- Botón "Ver plano" en Contrato → navega a la pestaña Masterplan con la manzana ya elegida ----
$("#ctVerPlanoBtn").addEventListener("click", ()=>{
  const l = state.lotes.find(x=>String(x.id)===$("#ctLote").value);
  if(!l) return;
  irAMasterplan(l.manzana);
});

// =====================================================================
//  MASTERPLAN — módulo propio, disponible para cualquier rol logueado
// =====================================================================
function manzanasUnicas(){
  const vistas = new Set();
  const lista = [];
  state.lotes.forEach(l=>{
    if(!vistas.has(l.manzana)){ vistas.add(l.manzana); lista.push(l.manzana); }
  });
  return lista.sort((a,b)=> a.localeCompare(b, "es", {numeric:true}));
}

function renderSelectorMasterplan(){
  const opts = ['<option value="">— Elegir manzana —</option>']
    .concat(manzanasUnicas().map(m=>`<option value="${esc(m)}">Manzana ${esc(m)}</option>`));
  $("#mpManzana").innerHTML = opts.join("");
}

function renderVisorMasterplan(manzana){
  const visor = $("#mpVisor");
  if(!manzana){
    visor.innerHTML = '<p class="hint">Elige una manzana para ver su plano.</p>';
    return;
  }
  const lote = state.lotes.find(l => l.manzana === manzana && l.plano_recorte);
  if(lote){
    visor.innerHTML = `<img src="planos/${esc(lote.plano_recorte)}" alt="Plano manzana ${esc(manzana)}">`;
  } else {
    visor.innerHTML = `<p class="hint">Todavía no se ha cargado el recorte del plano para la Manzana ${esc(manzana)}. El admin puede agregarlo desde Lista de precios (campo "Plano") subiendo la imagen a la carpeta /planos/.</p>`;
  }
}

$("#mpManzana").addEventListener("change", ()=> renderVisorMasterplan($("#mpManzana").value));

// Cambia a la pestaña Masterplan y preselecciona una manzana (usado desde Contrato).
function irAMasterplan(manzana){
  $$(".tab").forEach(t=>t.classList.remove("is-active"));
  $(`.tab[data-tab="masterplan"]`).classList.add("is-active");
  $$(".panel").forEach(p=>p.hidden = true);
  $("#tab-masterplan").hidden = false;
  $("#mpManzana").value = manzana;
  renderVisorMasterplan(manzana);
}

// =====================================================================
//  AJUSTES (solo admin) — Tasa, empresa, TIIE automática, ejecutivos
// =====================================================================
function renderTiieAjustes(){
  const t = state.tasa || {};
  if(t.tiie_auto && t.tiie_fecha){
    $("#tiieAutoHint").textContent = `TIIE actualizada automáticamente desde Banxico (publicación ${t.tiie_fecha}).`;
  } else if(t.tiie_fecha){
    $("#tiieAutoHint").textContent = `Último valor guardado manualmente.`;
  } else {
    $("#tiieAutoHint").textContent = `La TIIE se actualiza automáticamente desde Banxico.`;
  }
}

function renderAjustes(){
  const t = state.tasa || {}, e = state.empresa || {};
  $("#setTiie").value = t.tiie; $("#setPuntos").value = t.puntos; $("#setEnganche").value = t.enganche_pct;
  const map = {
    emCiudadFirma:"ciudad_firma", emRazon:"razon_social", emRep:"representante_legal", emDom:"domicilio_vendedora",
    emEscNum:"escritura_constitucion_num", emEscFecha:"escritura_constitucion_fecha",
    emNotNum:"notario_constitucion_num", emNotCiudad:"ciudad_constitucion",
    emFidEsc:"escritura_fideic_num", emFidNotNum:"notario_fideic_num",
    emFidNotNom:"notario_fideic_nombre", emFidCiudad:"ciudad_fideic",
    emClabe:"clabe", emBanco:"banco", emTest1:"testigo1", emTest2:"testigo2"
  };
  for(const id in map){ const el = $("#"+id); if(el) el.value = e[map[id]] || ""; }
}

$("#saveTasaBtn").addEventListener("click", async ()=>{
  const obj = { tiie: Number($("#setTiie").value), puntos: Number($("#setPuntos").value),
                enganche_pct: Number($("#setEnganche").value), tiie_auto:false,
                updated_at: new Date().toISOString() };
  const { error } = await sb.from("tasa_config").update(obj).eq("id",1);
  $("#tasaMsg").textContent = error ? ("Error: "+error.message) : "Guardado.";
  if(!error) await cargarDatos();
});

// Llama la Edge Function de Supabase que consulta Banxico y guarda la TIIE.
async function actualizarTiieDesdeBanxico(){
  const { data, error } = await sb.functions.invoke("tiie-fetch");
  if(error) throw new Error(error.message || "No se pudo contactar la función de TIIE.");
  if(data && data.error) throw new Error(data.error);
  return data; // { ok, tiie, fecha }
}

$("#actualizarTiieBtn").addEventListener("click", async ()=>{
  const btn = $("#actualizarTiieBtn");
  btn.disabled = true; btn.textContent = "Consultando Banxico…";
  try{
    const r = await actualizarTiieDesdeBanxico();
    $("#tasaMsg").textContent = `TIIE actualizada: ${r.tiie}% (publicación ${r.fecha}).`;
    await cargarDatos();
  }catch(err){
    $("#tasaMsg").textContent = "No se pudo actualizar automáticamente: " + err.message;
  }
  btn.disabled = false; btn.textContent = "Actualizar TIIE ahora (Banxico)";
});

// Auto-actualiza la TIIE al iniciar sesión si el último dato tiene más de 1 día
// (silencioso: si falla, simplemente se queda con el valor guardado).
async function intentarActualizarTiieSiViejo(){
  if(state.role !== "admin") return;
  const t = state.tasa || {};
  const horas = t.updated_at ? (Date.now() - new Date(t.updated_at).getTime()) / 36e5 : 999;
  if(horas < 20) return; // ya está fresca
  try{
    await actualizarTiieDesdeBanxico();
    await cargarDatos();
  }catch(e){ /* silencioso: se queda con el valor manual existente */ }
}

$("#saveEmpresaBtn").addEventListener("click", async ()=>{
  const obj = {
    ciudad_firma:$("#emCiudadFirma").value, razon_social:$("#emRazon").value, representante_legal:$("#emRep").value,
    domicilio_vendedora:$("#emDom").value, escritura_constitucion_num:$("#emEscNum").value,
    escritura_constitucion_fecha:$("#emEscFecha").value, notario_constitucion_num:$("#emNotNum").value,
    ciudad_constitucion:$("#emNotCiudad").value, escritura_fideic_num:$("#emFidEsc").value,
    notario_fideic_num:$("#emFidNotNum").value, notario_fideic_nombre:$("#emFidNotNom").value,
    ciudad_fideic:$("#emFidCiudad").value, clabe:$("#emClabe").value, banco:$("#emBanco").value,
    testigo1:$("#emTest1").value, testigo2:$("#emTest2").value, updated_at:new Date().toISOString()
  };
  const { error } = await sb.from("empresa_config").update(obj).eq("id",1);
  $("#empresaMsg").textContent = error ? ("Error: "+error.message) : "Guardado.";
  if(!error) state.empresa = {...state.empresa, ...obj};
});

// ---- Ejecutivos (alta desde Ajustes) ----
function renderEjecutivosTabla(){
  const tbody = $("#ejecutivosTable tbody");
  if(!state.ejecutivos.length){ tbody.innerHTML = `<tr><td colspan="3" style="color:#6e6557">Sin ejecutivos.</td></tr>`; return; }
  tbody.innerHTML = state.ejecutivos.map(e=>`
    <tr>
      <td>${esc(e.nombre)}</td>
      <td>${e.user_id ? "Sí" : '<span class="hint">Sin ligar — pídele que inicie sesión y liga su correo en Supabase</span>'}</td>
      <td><span class="pill ${e.activo?"disponible":"vendido"}">${e.activo?"activo":"inactivo"}</span></td>
    </tr>`).join("");
}

$("#nuevoEjecutivoBtn").addEventListener("click", async ()=>{
  const nombre = $("#nuevoEjecutivoNombre").value.trim();
  if(!nombre){ $("#ejecutivoMsg").textContent = "Captura el nombre del ejecutivo."; return; }
  const correo = $("#nuevoEjecutivoCorreo").value.trim();
  let user_id = null;
  if(correo){
    const { data: perfil } = await sb.from("profiles").select("id").eq("email", correo).maybeSingle();
    if(perfil) user_id = perfil.id;
    else { $("#ejecutivoMsg").textContent = "Aviso: no encontré ese correo entre los usuarios ya creados; se guardó el ejecutivo sin ligar. Crea primero su usuario en Authentication."; }
  }
  const { error } = await sb.from("ejecutivos").insert({ nombre, user_id });
  if(error){ $("#ejecutivoMsg").textContent = "Error: " + error.message; return; }
  if(!$("#ejecutivoMsg").textContent) $("#ejecutivoMsg").textContent = "Ejecutivo agregado.";
  $("#nuevoEjecutivoNombre").value = ""; $("#nuevoEjecutivoCorreo").value = "";
  await cargarDatos();
});

})();
