/* =====================================================================
   HACIENDA LA PURÍSIMA — Lógica de la aplicación
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
const state = { user:null, role:null, tasa:null, empresa:null, lotes:[], citas:[] };

// ---- Utilidades ----
const $  = s => document.querySelector(s);
const $$ = s => Array.from(document.querySelectorAll(s));
const money = n => "$" + (Number(n)||0).toLocaleString("es-MX",{minimumFractionDigits:2,maximumFractionDigits:2});
const parseMoney = s => Number(String(s).replace(/[^0-9.]/g,"")) || 0;
const esc = s => String(s==null?"":s).replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));

function imprimirHTML(html){
  const w = window.open("", "_blank");
  if(!w){ alert("Permite las ventanas emergentes para exportar el PDF."); return; }
  w.document.open(); w.document.write(html); w.document.close();
  w.onload = () => { w.focus(); w.print(); };
}

// =====================================================================
//  AUTENTICACIÓN
// =====================================================================
$("#loginForm").addEventListener("submit", async (e)=>{
  e.preventDefault();
  const btn = $("#loginBtn"); btn.disabled = true; btn.textContent = "Entrando…";
  $("#loginError").textContent = "";
  const { error } = await sb.auth.signInWithPassword({
    email: $("#email").value.trim(), password: $("#password").value
  });
  btn.disabled = false; btn.textContent = "Entrar";
  if(error) $("#loginError").textContent = "Correo o contraseña incorrectos.";
});

$("#logoutBtn").addEventListener("click", async ()=>{ await sb.auth.signOut(); location.reload(); });

sb.auth.onAuthStateChange(async (_e, session)=>{
  if(session && session.user){ await iniciarSesion(session.user); }
  else { $("#login").hidden = false; $("#app").hidden = true; }
});

async function iniciarSesion(user){
  state.user = user;
  // Rol del usuario
  const { data: perfil } = await sb.from("profiles").select("role,nombre").eq("id", user.id).single();
  state.role = perfil ? perfil.role : "ventas";
  $("#login").hidden = true; $("#app").hidden = false;
  $("#userBadge").textContent = (perfil && perfil.nombre ? perfil.nombre : user.email) + " · " + state.role;
  // Mostrar/ocultar controles de admin
  const esAdmin = state.role === "admin";
  $$(".admin-only").forEach(el => el.hidden = !esAdmin);
  await cargarDatos();
  $("#ctFecha").value = new Date().toISOString().slice(0,10);
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
  const [tasa, lotes] = await Promise.all([
    sb.from("tasa_config").select("*").eq("id",1).single(),
    sb.from("lotes").select("*").order("manzana").order("lote")
  ]);
  state.tasa  = tasa.data || {tiie:6.76, puntos:8, enganche_pct:20};
  state.lotes = lotes.data || [];
  $("#puntosLbl").textContent = state.tasa.puntos;
  $("#calcEnganche").value = state.tasa.enganche_pct;

  // empresa (todos la leen; solo admin la edita)
  const emp = await sb.from("empresa_config").select("*").eq("id",1).single();
  state.empresa = emp.data || {};

  llenarSelectLotes();
  renderLotes();
  renderAjustes();
  await cargarCitas();
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

  const optsCita = ['<option value="">— Opcional —</option>']
    .concat(lotesDisponibles().map(l =>
      `<option value="${l.id}">Mz ${esc(l.manzana)} · Lote ${esc(l.lote)}</option>`));
  $("#citaLote").innerHTML = optsCita.join("");
}

// =====================================================================
//  CALCULADORA
// =====================================================================
let precioPrecargado = null;

$("#calcLote").addEventListener("change", ()=>{
  const l = state.lotes.find(x => String(x.id) === $("#calcLote").value);
  if(l){
    $("#calcManzana").value = l.manzana;
    $("#calcLoteNum").value = l.lote;
    $("#calcPrecio").value  = Number(l.precio).toFixed(2);
    precioPrecargado = Number(l.precio);
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
    $("#precioHint").textContent = "Precio modificado · el lote se definirá al elegir uno específico.";
  }
  actualizarFinanciar();
});

$("#calcEnganche").addEventListener("input", actualizarFinanciar);

function actualizarFinanciar(){
  const precio = parseMoney($("#calcPrecio").value);
  const eng = Math.min(100, Math.max(0, Number($("#calcEnganche").value)||0));
  $("#calcFinanciar").value = money(precio * (1 - eng/100));
}

$("#calcBtn").addEventListener("click", ()=>{
  const precio = parseMoney($("#calcPrecio").value);
  if(precio <= 0){ $("#calcResultado").innerHTML = '<div class="result-empty">Ingresa un precio válido.</div>'; return; }
  const eng = Math.min(100, Math.max(0, Number($("#calcEnganche").value)||0));
  const financiar = precio * (1 - eng/100);
  const tasaAnual = (Number(state.tasa.tiie) + Number(state.tasa.puntos)) / 100;
  const i = tasaAnual / 12;
  const plazos = [12,24,36,48,60];

  let rows = "";
  const filasPDF = [];
  plazos.forEach(n=>{
    const cuota = i > 0 ? financiar * i / (1 - Math.pow(1+i, -n)) : financiar / n;
    const total = cuota * n;
    rows += `<tr><td class="plazo">${n} meses</td><td class="mens">${money(cuota)}</td><td>${money(total)}</td></tr>`;
    filasPDF.push({n, cuota, total});
  });

  $("#calcResultado").innerHTML = `
    <table class="cuotas">
      <thead><tr><th>Plazo</th><th>Mensualidad</th><th>Total a pagar</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <p class="hint">Monto a financiar ${money(financiar)} · tasa anual ${(tasaAnual*100).toFixed(2)}% (TIIE ${state.tasa.tiie}% + ${state.tasa.puntos}).</p>`;

  $("#calcPdfBtn").hidden = false;
  $("#calcPdfBtn").onclick = ()=> exportarCotizacion({precio, eng, financiar, tasaAnual, filasPDF});
});

function exportarCotizacion(d){
  const cliente = $("#calcCliente").value.trim() || "—";
  const manzana = $("#calcManzana").value || "—";
  const loteNum = $("#calcLoteNum").value || "Por definir";
  const hoy = new Date().toLocaleDateString("es-MX",{day:"2-digit",month:"long",year:"numeric"});
  const filas = d.filasPDF.map(f=>`<tr><td>${f.n} meses</td><td style="text-align:right">${money(f.cuota)}</td><td style="text-align:right">${money(f.total)}</td></tr>`).join("");
  const html = `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><title>Cotización La Purísima</title>
  <style>
    @page{size:Letter;margin:2cm}
    body{font-family:Arial,Helvetica,sans-serif;color:#292420;margin:0}
    .head{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px solid #213d2e;padding-bottom:14px;margin-bottom:22px}
    .brand{font-family:Georgia,serif;font-size:26px;color:#213d2e;font-weight:bold;line-height:1}
    .eyebrow{font-size:9px;letter-spacing:2px;text-transform:uppercase;color:#a8842c;font-weight:bold}
    .meta{text-align:right;font-size:12px;color:#6e6557}
    h2{font-size:13px;text-transform:uppercase;letter-spacing:1px;color:#a8842c;margin:22px 0 8px}
    .box{background:#f6f2e9;border:1px solid #dcd4c6;border-radius:8px;padding:14px 16px;font-size:14px}
    .box div{margin-bottom:5px}
    table{width:100%;border-collapse:collapse;margin-top:6px;font-size:14px}
    th,td{padding:9px 8px;border-bottom:1px solid #dcd4c6}
    th{background:#213d2e;color:#fff;text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:.5px}
    th:nth-child(2),th:nth-child(3){text-align:right}
    .foot{margin-top:24px;font-size:10px;color:#6e6557;border-top:1px solid #dcd4c6;padding-top:12px}
    .grand{font-weight:bold;color:#213d2e}
  </style></head><body>
  <div class="head">
    <div><div class="eyebrow">Fraccionamiento Residencial Turístico</div><div class="brand">Hacienda La Purísima</div></div>
    <div class="meta">Cotización<br>${hoy}</div>
  </div>
  <h2>Datos de la cotización</h2>
  <div class="box">
    <div><b>Cliente:</b> ${esc(cliente)}</div>
    <div><b>Lote:</b> Manzana ${esc(manzana)} · Lote ${esc(loteNum)}</div>
    <div><b>Precio:</b> ${money(d.precio)}</div>
    <div><b>Enganche (${d.eng}%):</b> ${money(d.precio*d.eng/100)}</div>
    <div class="grand"><b>Monto a financiar:</b> ${money(d.financiar)}</div>
  </div>
  <h2>Opciones de financiamiento (pagos iguales)</h2>
  <table><thead><tr><th>Plazo</th><th>Mensualidad</th><th>Total a pagar</th></tr></thead><tbody>${filas}</tbody></table>
  <div class="foot">
    Tasa anual estimada ${(d.tasaAnual*100).toFixed(2)}% (TIIE ${state.tasa.tiie}% + ${state.tasa.puntos} puntos), sobre saldos insolutos.
    Estimación con tasa fija al valor de TIIE vigente; el contrato pacta tasa <b>variable</b>, ajustada mensualmente conforme a la TIIE publicada por Banco de México. No constituye oferta vinculante. Sujeta a disponibilidad y aprobación.
  </div>
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
  if(res.error){ alert("No se pudo guardar: " + res.error.message); return; }
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
    <td><button class="btn-mini" data-save="nuevo">Guardar</button></td>`;
  tbody.prepend(tr);
  tr.querySelector("[data-save]").addEventListener("click", ()=>guardarLote("nuevo", tr));
});

// =====================================================================
//  CITAS
// =====================================================================
async function cargarCitas(){
  const { data } = await sb.from("citas").select("*").order("fecha_hora",{ascending:true});
  state.citas = data || [];
  renderCitas();
}

function renderCitas(){
  const tbody = $("#citasTable tbody");
  if(!state.citas.length){ tbody.innerHTML = `<tr><td colspan="5" style="color:#6e6557">Sin citas agendadas.</td></tr>`; return; }
  tbody.innerHTML = state.citas.map(c=>{
    const l = state.lotes.find(x=>x.id===c.lote_id);
    const fecha = new Date(c.fecha_hora).toLocaleString("es-MX",{day:"2-digit",month:"short",hour:"2-digit",minute:"2-digit"});
    const puede = (c.created_by === state.user.id) || state.role === "admin";
    const sel = puede
      ? `<select data-cita="${c.id}">${["agendada","confirmada","realizada","cancelada","no_asistio"].map(s=>`<option ${s===c.estatus?"selected":""}>${s}</option>`).join("")}</select>`
      : esc(c.estatus);
    return `<tr>
      <td>${fecha}</td>
      <td>${esc(c.cliente_nombre)}<br><span class="hint">${esc(c.origen)}</span></td>
      <td>${l?`Mz ${esc(l.manzana)}·L${esc(l.lote)}`:"—"}</td>
      <td>${esc(c.asesor)}</td>
      <td>${sel}</td>
    </tr>`;
  }).join("");
  $$("#citasTable [data-cita]").forEach(s=>{
    s.addEventListener("change", async ()=>{
      const { error } = await sb.from("citas").update({estatus:s.value}).eq("id", s.dataset.cita);
      if(error) alert("No se pudo actualizar: " + error.message);
    });
  });
}

$("#citaBtn").addEventListener("click", async ()=>{
  const nombre = $("#citaNombre").value.trim();
  const fecha  = $("#citaFecha").value;
  if(!nombre || !fecha){ $("#citaMsg").textContent = "Captura al menos el cliente y la fecha/hora."; return; }
  const obj = {
    cliente_nombre: nombre,
    cliente_telefono: $("#citaTel").value.trim(),
    cliente_correo: $("#citaCorreo").value.trim(),
    fecha_hora: new Date(fecha).toISOString(),
    lote_id: $("#citaLote").value ? Number($("#citaLote").value) : null,
    asesor: $("#citaAsesor").value.trim(),
    origen: $("#citaOrigen").value,
    notas: $("#citaNotas").value.trim(),
    created_by: state.user.id
  };
  const { error } = await sb.from("citas").insert(obj);
  if(error){ $("#citaMsg").textContent = "Error: " + error.message; return; }
  $("#citaMsg").textContent = "Cita agendada.";
  ["#citaNombre","#citaTel","#citaCorreo","#citaFecha","#citaAsesor","#citaNotas"].forEach(s=>$(s).value="");
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
    $("#ctSup").value     = l.superficie_m2;
    $("#ctPrecio").value  = Number(l.precio).toFixed(2);
    if(l.estatus === "vendido"){
      $("#ctAviso").hidden = false; $("#ctAviso").textContent = "Atención: este lote está marcado como VENDIDO.";
    } else $("#ctAviso").hidden = true;
  }
  resumenContrato();
});
$("#ctPrecio").addEventListener("input", resumenContrato);

function resumenContrato(){
  const p = parseMoney($("#ctPrecio").value);
  if(p>0) $("#ctResumen").innerHTML = `Precio ${money(p)} · enganche 20% ${money(p*0.20)} · saldo ${money(p*0.80)}.`;
  else $("#ctResumen").textContent = "Selecciona un lote y captura el precio.";
}

$("#ctGenerarBtn").addEventListener("click", ()=>{
  const precio = parseMoney($("#ctPrecio").value);
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
    superficie_m2: $("#ctSup").value, precio: precio
  };
  imprimirHTML(construirContratoHTML(data));
});

// =====================================================================
//  AJUSTES (solo admin)
// =====================================================================
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
                enganche_pct: Number($("#setEnganche").value), updated_at: new Date().toISOString() };
  const { error } = await sb.from("tasa_config").update(obj).eq("id",1);
  $("#tasaMsg").textContent = error ? ("Error: "+error.message) : "Guardado.";
  if(!error) await cargarDatos();
});

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

})();
