/* =====================================================================
   numeroALetras — convierte un importe a letra en español (mayúsculas)
   Devuelve, p.ej.: "UN MILLÓN OCHOCIENTOS CINCUENTA MIL PESOS 00/100 M.N."
===================================================================== */
function numeroALetras(num){
  num = Number(num) || 0;
  const ent = Math.floor(num);
  const cent = Math.round((num - ent) * 100);

  function unidades(n){
    return ["","UNO","DOS","TRES","CUATRO","CINCO","SEIS","SIETE","OCHO","NUEVE"][n];
  }
  function decenas(n){
    const d = Math.floor(n/10), u = n%10;
    const especiales = {10:"DIEZ",11:"ONCE",12:"DOCE",13:"TRECE",14:"CATORCE",15:"QUINCE"};
    if(n < 10) return unidades(n);
    if(especiales[n]) return especiales[n];
    if(n < 20) return "DIECI" + unidades(u);
    if(n < 30) return (u === 0) ? "VEINTE" : "VEINTI" + unidades(u);
    const tens = ["","","VEINTE","TREINTA","CUARENTA","CINCUENTA","SESENTA","SETENTA","OCHENTA","NOVENTA"][d];
    return u ? tens + " Y " + unidades(u) : tens;
  }
  function centenas(n){
    const c = Math.floor(n/100), r = n%100;
    if(n === 100) return "CIEN";
    const huns = ["","CIENTO","DOSCIENTOS","TRESCIENTOS","CUATROCIENTOS","QUINIENTOS",
                  "SEISCIENTOS","SETECIENTOS","OCHOCIENTOS","NOVECIENTOS"][c];
    return (huns + (r ? " " + decenas(r) : "")).trim();
  }
  function seccion(n, divisor, sing, plur){
    const cantidad = Math.floor(n/divisor);
    const resto = n - cantidad*divisor;
    let letras = "";
    if(cantidad > 0){
      letras = (cantidad > 1) ? miles(cantidad) + " " + plur : sing;
    }
    return {letras, resto};
  }
  function miles(n){
    if(n < 1000) return centenas(n);
    const s = seccion(n, 1000, "MIL", "MIL");
    const r = s.resto ? " " + centenas(s.resto) : "";
    return (s.letras + r).trim();
  }
  function millones(n){
    if(n === 0) return "CERO";
    if(n < 1000000) return miles(n);
    const s = seccion(n, 1000000, "UN MILLÓN", "MILLONES");
    const r = s.resto ? " " + miles(s.resto) : "";
    return (s.letras + r).trim();
  }

  let letras = millones(ent);
  letras = letras.replace(/UNO MIL/g, "UN MIL")          // veintiún mil, treinta y un mil…
                 .replace(/UNO MILLONES/g, "UN MILLONES")
                 .replace(/UNO$/, "UN");                  // un peso, veintiún…
  const peso = (ent === 1) ? "PESO" : "PESOS";
  return `${letras} ${peso} ${String(cent).padStart(2,"0")}/100 M.N.`;
}

/* =====================================================================
   construirContratoHTML — arma el contrato completo (HTML imprimible)
   d = objeto con todos los datos de empresa, comprador, lote e importes
===================================================================== */
function construirContratoHTML(d){
  const v = (x, ph) => (x && String(x).trim()) ? x : `<span class="ph">[${ph}]</span>`;
  const precio = Number(d.precio) || 0;
  const engPct = Number(d.enganche_pct) || 20;
  const enganche = precio * (engPct / 100);
  const esVersionDosFinal = engPct >= 50; // 50%+ → plazo de gracia de 365 días / 12 mensualidades / 10% descuento
  const plazoMeses = Number(d.plazo_meses) || 60; // solo aplica en la versión <50% (la de 50%+ siempre es 60 fijo)
  const plazoLetras = {12:"doce",24:"veinticuatro",36:"treinta y seis",48:"cuarenta y ocho",60:"sesenta"}[plazoMeses] || "sesenta";
  const precioLetra = numeroALetras(precio);
  const engancheLetra = numeroALetras(enganche);
  const fmt = n => "$" + (Number(n)||0).toLocaleString("es-MX",{minimumFractionDigits:2, maximumFractionDigits:2});

  const css = `
    @page{size:Letter;margin:2.2cm 2.4cm}
    *{box-sizing:border-box}
    body{font-family:"Times New Roman",Georgia,serif;font-size:11.5pt;line-height:1.5;color:#1a1a1a;margin:0}
    h1{font-size:14pt;text-align:center;text-transform:uppercase;letter-spacing:.5px;margin:0 0 4pt}
    h2{font-size:12pt;text-align:center;margin:18pt 0 8pt;text-transform:uppercase;letter-spacing:.4px}
    h3{font-size:11.5pt;margin:14pt 0 4pt}
    p{margin:0 0 7pt;text-align:justify}
    .sub{text-align:center;font-size:9.5pt;letter-spacing:1px;text-transform:uppercase;color:#555;margin:0 0 14pt}
    .cl{margin:0 0 7pt;text-align:justify}
    .cl b{text-transform:uppercase}
    ul{margin:0 0 7pt;padding-left:20pt}
    li{margin-bottom:4pt;text-align:justify}
    .ph{background:#fff3c4;padding:0 2px;border-bottom:1px dashed #c79a00;font-style:italic}
    .firmas{margin-top:36pt;width:100%;border-collapse:collapse}
    .firmas td{width:50%;text-align:center;vertical-align:bottom;padding:0 14pt}
    .lineafirma{border-top:1px solid #000;margin-top:46pt;padding-top:5pt;font-weight:bold}
    .testigos td{padding-top:30pt}
    .pagebreak{page-break-before:always}
    @media screen{body{max-width:760px;margin:24px auto;padding:0 20px;background:#fff}}
  `;

  // ----- Cuerpo del contrato -----
  return `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8">
  <title>Contrato — ${v(d.nombre,"COMPRADOR")}</title><style>${css}</style></head><body>

  <h1>Contrato Privado de Promesa de Compraventa</h1>
  <p class="sub">Fraccionamiento Residencial Turístico La Purísima</p>

  <p>En ${v(d.ciudad_firma,"CIUDAD")}, a ${v(d.fecha_firma,"FECHA DE FIRMA")}, comparecen por una parte, ${v(d.razon_social,"RAZÓN SOCIAL")}, representada en este acto por ${v(d.representante,"REPRESENTANTE LEGAL")}, a quien en lo sucesivo se le denominará “PROMITENTE VENDEDORA”, y por la otra parte, ${v(d.nombre,"NOMBRE COMPLETO DEL COMPRADOR")}, a quien en lo sucesivo se le denominará “LA PROMITENTE COMPRADORA”. Las partes se reconocen mutuamente la personalidad con la que comparecen y manifiestan su voluntad de celebrar el presente contrato de promesa de compraventa, sujetándose a los siguientes:</p>

  <h2>Declaraciones</h2>
  <p><b>I. Declara “LA PROMITENTE VENDEDORA”:</b></p>
  <p>a) Ser una sociedad legalmente constituida en la escritura número ${v(d.escritura_constitucion_num,"N° ESCRITURA")} de fecha ${v(d.escritura_constitucion_fecha,"FECHA")} ante la fe del notario público número ${v(d.notario_constitucion_num,"N° NOTARIO")} de la ciudad de ${v(d.ciudad_constitucion,"CIUDAD")}, con domicilio en ${v(d.domicilio_vendedora,"DOMICILIO EN LA CIUDAD DE MÉXICO")}.</p>
  <p>b) De acuerdo con el contrato de fideicomiso celebrado con Banco Nacional de México, S.A., en escritura pública número 242765 ante la fe del licenciado Tomás Lozano Molina, Notario Público número 10 del Distrito Federal, la fideicomisaria en segundo lugar está autorizada para celebrar contratos de compraventa de los lotes del Fraccionamiento Residencial Turístico La Purísima en los términos de este contrato.</p>
  <p>c) De acuerdo con la escritura pública número ${v(d.escritura_fideic_num,"N° ESCRITURA")} ante la fe del licenciado ${v(d.notario_fideic_nombre,"NOMBRE DEL NOTARIO")}, Notario Público número ${v(d.notario_fideic_num,"N° NOTARIO")} de ${v(d.ciudad_fideic,"CIUDAD")}, “LA PROMITENTE VENDEDORA” es fideicomisaria en segundo lugar respecto a los derechos fiduciarios sobre diversos lotes ubicados en el Fraccionamiento Residencial Turístico La Purísima, situado en el Municipio de Ixtlahuaca, Estado de México, México, el cual se encuentra debidamente autorizado y urbanizado conforme a la legislación vigente y las normas municipales aplicables.</p>
  <p>d) Que adjunta como Anexo B el Reglamento de Construcción y Uso del Fraccionamiento.</p>
  <p>e) El lote objeto de la presente promesa de compraventa se identifica como Manzana ${v(d.manzana,"MANZANA")}, Lote ${v(d.lote,"LOTE")}, con frente a la calle ${v(d.calle,"CALLE")}, con una superficie nominal de ${v(d.superficie_m2,"SUPERFICIE")} metros cuadrados, según se detalla en el Anexo A adjunto, que consiste en el plano del lote. Las partes acuerdan que la eventual escrituración se realizará ad corpus, es decir, el inmueble se transfiere en su totalidad tal como se encuentra, habiendo “LA PROMITENTE COMPRADORA” inspeccionado y aceptado el lote en su estado actual.</p>
  <p>f) “LA PROMITENTE VENDEDORA” se dedica entre otras actividades a la comercialización de lotes urbanizados en dicho fraccionamiento y promete hacer las gestiones que le sean requeridas para formalizar la compraventa del lote descrito mediante escritura pública ante notario a favor de “LA PROMITENTE COMPRADORA” una vez cumplidas las condiciones pactadas.</p>

  <p><b>II. Declara “LA PROMITENTE COMPRADORA”:</b></p>
  <p>a) Ser de nacionalidad ${v(d.nacionalidad,"NACIONALIDAD")}, mayor de edad, con domicilio en ${v(d.domicilio_comprador,"DOMICILIO COMPLETO")}, correo electrónico ${v(d.correo,"CORREO ELECTRÓNICO")} y Registro Federal de Contribuyentes ${v(d.rfc,"RFC")}.</p>
  <p>b) Haber inspeccionado el lote y aceptarlo en su estado actual, renunciando a cualquier reclamo futuro por diferencias en características.</p>
  <p>c) Que los recursos utilizados para el pago provienen de fuentes lícitas, y autoriza a “LA PROMITENTE VENDEDORA” a realizar las verificaciones y reportes necesarias conforme a las Leyes aplicables.</p>
  <p>d) Que adjunta como Anexo C copia de su identificación oficial, comprobante de domicilio y, si aplica, acta constitutiva o poder notarial, para cumplir con las obligaciones de debida diligencia en materia de prevención de lavado de dinero.</p>
  <p><b>III.</b> Ambas partes declaran que el presente contrato se celebra de conformidad con los artículos 2243 al 2247 del Código Civil Federal, y que es un contrato preparatorio que obliga a formalizar la compraventa definitiva ante notario público una vez cumplidas las condiciones.</p>

  <h2>Definiciones</h2>
  <p>Para efectos del presente contrato, se entenderá por:</p>
  <ul>
    <li>“LA PROMITENTE VENDEDORA”: titular de los derechos fiduciarios del Fraccionamiento.</li>
    <li>“LA PROMITENTE COMPRADORA”: la persona que promete adquirir el lote.</li>
    <li>“FRACCIONAMIENTO”: El Fraccionamiento Residencial Turístico La Purísima.</li>
    <li>“REGLAMENTO”: El Reglamento de Construcción y Uso del Fraccionamiento anexo al contrato.</li>
    <li>“TIIE”: Tasa de Interés Interbancaria de Equilibrio a 28 días publicada por el Banco de México.</li>
    <li>“TASA SUSTITUTA”: La Tasa de Fondeo Gubernamental publicada por el Banco de México, o cualquier otra que oficialmente la sustituya en caso de que la TIIE deje de publicarse.</li>
    <li>“COMITÉ DE ARQUITECTURA”: Órgano designado por la Asociación de Colonos para supervisar proyectos y obras dentro del Fraccionamiento, cuya composición, funciones y procedimientos se detallan en el Anexo B.</li>
    <li>“ASOCIACIÓN DE COLONOS”: La entidad formada por los propietarios del Fraccionamiento para la administración y mantenimiento común.</li>
    <li>“NOTIFICACIONES”: Cualquier comunicación requerida por este contrato, que deberá realizarse por escrito a los domicilios o correos electrónicos proporcionados por las partes.</li>
    <li>“RESCISIÓN”: La terminación unilateral o mutua del contrato por las causas establecidas en este instrumento.</li>
  </ul>

  <h2>Cláusulas</h2>
  <p class="cl"><b>Primera. Objeto.</b> “LA PROMITENTE VENDEDORA” promete vender el lote descrito en los Antecedentes mediante escritura pública ante notario a “LA PROMITENTE COMPRADORA”, quien promete adquirirlo por el precio pactado, sujeto al cumplimiento de las condiciones del presente instrumento.</p>

  <p class="cl"><b>Segunda. Precio y Forma de Pago.</b></p>
  <p>a) El precio total es de ${fmt(precio)} pesos M.N. (${precioLetra}).</p>
  <p>b) “LA PROMITENTE COMPRADORA” pagará un enganche del ${engPct}% del precio total, equivalente a ${fmt(enganche)} pesos M.N. (${engancheLetra}), al momento de la firma de este contrato.</p>
  ${esVersionDosFinal ? `
  <p>c) Si “LA PROMITENTE COMPRADORA” paga la totalidad del saldo pendiente después de descontar el enganche en 12 mensualidades iguales y consecutivas en un plazo de 365 (trescientos sesenta y cinco) días naturales contados a partir de la firma, se aplicará un descuento del 10% sobre el precio total, el cual será definitivo y liquidatorio.</p>
  <p>d) En caso de no pagar la totalidad en el plazo señalado, o de que haya un retraso en dos o más mensualidades, no aplicará el descuento mencionado en el inciso anterior y el saldo que exista en ese momento se financiará en 60 (sesenta) pagos mensuales consecutivos, con una tasa de interés variable equivalente a la Tasa de Interés Interbancaria de Equilibrio (TIIE) a 28 días publicada por el Banco de México, más 8 (ocho) puntos porcentuales sobre saldos insolutos. La tasa se ajustará mensualmente conforme a la publicación oficial de la TIIE. En caso de dejar de publicarse la TIIE, se aplicará la Tasa Sustituta definida en este contrato. El Primer Pago será el primer día del mes siguiente al término del plazo de los 365 días, y el último pago se realizará al cumplimiento de los 60 meses.</p>` : `
  <p>c) Si “LA PROMITENTE COMPRADORA” paga la totalidad del saldo pendiente después de descontar el enganche en un plazo de 90 (noventa) días naturales contados a partir de la firma, se aplicará un descuento del 15% sobre el precio total, el cual será definitivo y liquidatorio.</p>
  <p>d) En caso de no pagar la totalidad en el plazo señalado, no aplicará el descuento mencionado en el inciso anterior y el saldo se financiará en ${plazoMeses} (${plazoLetras}) pagos mensuales consecutivos, con una tasa de interés variable equivalente a la Tasa de Interés Interbancaria de Equilibrio (TIIE) a 28 días publicada por el Banco de México, más 8 (ocho) puntos porcentuales sobre saldos insolutos. La tasa se ajustará mensualmente conforme a la publicación oficial de la TIIE. En caso de dejar de publicarse la TIIE, se aplicará la Tasa Sustituta definida en este contrato. El Primer Pago será el primer día del mes siguiente al término del plazo de los 90 días, y el último pago se realizará al cumplimiento de los ${plazoMeses} meses.</p>`}
  <p>e) Todos los pagos se realizarán mediante transferencia bancaria a la cuenta ${v(d.clabe,"CLABE")} en ${v(d.banco,"BANCO")}, a nombre de ${v(d.razon_social,"RAZÓN SOCIAL")}, o en su defecto, en el domicilio de “LA PROMITENTE VENDEDORA” señalado en este contrato.</p>
  <p>f) No habrá penalizaciones por pagos anticipados.</p>

  <p class="cl"><b>Tercera. Pagarés.</b> Las partes convienen en que “LA PROMITENTE COMPRADORA” suscriba a favor de “LA PROMITENTE VENDEDORA” uno o varios pagarés por la cantidad o cantidades establecidas en el presente contrato. Dichos pagarés los recibe “LA PROMITENTE VENDEDORA” salvo buen cobro y establece expresamente que la entrega de los mismos no obliga a ésta a otorgar la escritura correspondiente sino hasta la liquidación total de los adeudos, pues dicha entrega no implica el pago del precio. Al quedar liquidado cada pagaré, se devolverá a “LA PROMITENTE COMPRADORA”.</p>

  <p class="cl"><b>Cuarta. Intereses Moratorios y Penalidades.</b></p>
  <p>a) En caso de retraso en cualquier pago, se aplicarán intereses moratorios equivalentes a 1.5 (una y media) veces la tasa de interés ordinaria pactada (TIIE + 8%).</p>
  <p>b) Todos los pagos se aplicarán primero a intereses moratorios y penalidades, después a intereses ordinarios, impuestos y gastos del inmueble y finalmente a capital.</p>
  <p>c) Si algún retraso en pagos alcanza 6 (seis) meses o más, “LA PROMITENTE VENDEDORA” podrá rescindir unilateralmente el contrato, notificando por escrito a los domicilios o correos electrónicos proporcionados por “LA PROMITENTE COMPRADORA”. Será obligación de ambas partes mantener actualizados sus datos de contacto, notificando cualquier cambio a la otra parte dentro de los 10 días siguientes a que ocurra.</p>
  <p>d) En caso de rescisión por incumplimiento de “LA PROMITENTE COMPRADORA”, se aplicará una pena convencional del 20% del valor total del contrato, la cual se retendrá de los pagos realizados, sin perjuicio de reclamar daños y perjuicios adicionales.</p>

  <p class="cl"><b>Quinta. Posesión.</b></p>
  <p>a) La posesión material y jurídica del lote se entregará una vez liquidados los pagos y cumplido el contrato en su totalidad.</p>
  <p>b) Uso Temporal del Lote. Por autorización expresa de “LA PROMITENTE VENDEDORA”, “LA PROMITENTE COMPRADORA” podrá hacer uso temporal y precario del lote únicamente para realizar actividades de limpieza, resguardo y construcción de obras, siempre bajo su exclusiva responsabilidad y conforme al Reglamento del Fraccionamiento. Este uso temporal no constituye transmisión de la posesión jurídica, ni reconocimiento de derecho real o personal alguno distinto al derivado de la promesa contenida en este contrato.</p>
  <p>c) “LA PROMITENTE COMPRADORA” queda obligada a mantener limpio el inmueble, permitiendo inicie las construcciones en su lote sin que esto implique que se le ha dado la posesión jurídica y material del inmueble.</p>
  <p>d) En caso de rescisión del presente contrato, “LA PROMITENTE COMPRADORA” reconoce expresamente que la posesión del lote corresponde a “LA PROMITENTE VENDEDORA”. El uso temporal autorizado quedará automáticamente terminado en caso de que el contrato sea rescindido por cualquier causa. En ese supuesto, “LA PROMITENTE COMPRADORA” se obliga a desocupar el lote de inmediato y sin necesidad de resolución judicial previa.</p>

  <p class="cl"><b>Sexta. Obligaciones.</b></p>
  <p>a) A partir de la firma de este contrato y hasta la formalización de la compraventa definitiva o, en su caso, la rescisión, todos los gastos inherentes al lote (impuestos, servicios, mantenimiento, etc.) serán por cuenta de “LA PROMITENTE COMPRADORA”, quien se obliga a cubrirlos puntualmente. En caso de que “LA PROMITENTE VENDEDORA” deba cubrirlos por cualquier motivo, podrá exigir su reembolso inmediato a “LA PROMITENTE COMPRADORA” como cantidad líquida y exigible. Dicha obligación se deriva del uso temporal que por este contrato se le autoriza.</p>
  <p>b) “LA PROMITENTE COMPRADORA” se obliga a respetar en todo momento los reglamentos del fraccionamiento, particularmente el de construcción y uso, y a cubrir puntualmente las cuotas de colonos, mantenimiento o cualquier otra que establezca la asociación de colonos.</p>
  <p>c) “LA PROMITENTE COMPRADORA” no podrá residir, rentar, transmitir, enajenar ni gravar el inmueble —incluyendo darlo en garantía— hasta que se otorgue la escritura definitiva a su favor. Una vez escriturado, sólo podrá destinarlo a uso residencial unifamiliar, conforme a lo establecido en el Anexo B.</p>

  <p class="cl"><b>Séptima. Prevención de Lavado de Dinero.</b> Las partes se comprometen a cumplir con la Ley de Lavado de Dinero y Recursos de Procedencia Ilícita y sus disposiciones reglamentarias vigentes. “LA PROMITENTE COMPRADORA” declara bajo protesta de decir verdad que no realiza actividades vulnerables y que los fondos son de procedencia lícita, autorizando cualquier verificación necesaria.</p>

  <p class="cl"><b>Octava. Formalización.</b></p>
  <p>a) Una vez finiquitadas todas las obligaciones establecidas en el presente instrumento, las partes formalizarán la compraventa mediante escritura pública ante notario, ad corpus, asumiendo “LA PROMITENTE COMPRADORA” los gastos notariales, registrales e impuestos correspondientes.</p>
  <p>b) “LA PROMITENTE COMPRADORA” se obliga a realizar todas aquellas gestiones y pagos necesarios para la escrituración en un plazo de 6 (seis) meses a partir de que termine el plazo pactado de financiamiento. En caso de que no se escriture en dicho plazo por causas imputables a “LA PROMITENTE COMPRADORA”, deberá pagar adicionalmente el 1% (uno por ciento) mensual por concepto de gastos de administración y de fideicomiso sobre el valor de la operación. La falta de formalización y gestión del cliente es causa de rescisión en atención al fideicomiso al que está sujeto y su liberación, por lo cual en caso de no realizar dichas gestiones y pagos en tiempo y forma “LA PROMITENTE COMPRADORA” renuncia al inmueble dando por rescindido el contrato.</p>

  <p class="cl"><b>Novena. Cesión de Derechos.</b> “LA PROMITENTE VENDEDORA” podrá ceder los derechos y obligaciones derivados del presente contrato a instituciones fiduciarias o entidades financieras, sin necesidad de autorización expresa de “LA PROMITENTE COMPRADORA”. Por su parte, “LA PROMITENTE COMPRADORA” podrá ceder sus derechos u obligaciones derivados de este contrato con la autorización previa y por escrito de “LA PROMITENTE VENDEDORA”, la cual no podrá negarse sin causa justificada. En caso de cesión por parte de “LA PROMITENTE COMPRADORA” y con el fin de cubrir gastos en la elaboración de nuevos contratos y documentos relacionados con la cesión, “LA PROMITENTE COMPRADORA” se obliga a pagar 5% (cinco por ciento) del valor de la operación.</p>

  <p class="cl"><b>Décima. Causas de Rescisión.</b> Además de lo establecido en las Cláusulas Cuarta y Octava, el contrato podrá rescindirse por mutuo acuerdo, fuerza mayor o incumplimiento de las prohibiciones establecidas en la Cláusula Sexta.</p>

  <p class="cl"><b>Undécima. Jurisdicción y Ley Aplicable.</b> Para todo lo no previsto en este contrato, se aplicará el Código Civil para el Estado de México y, en lo conducente, la legislación federal. Cualquier controversia derivada de este contrato se someterá a los tribunales competentes del Estado de México, en razón de que el inmueble objeto del contrato se encuentra en dicho territorio. Las partes renuncian a cualquier otro fuero que pudiera corresponderles.</p>

  <p class="cl"><b>Duodécima. Anexos.</b> Forman parte integral de este contrato: Anexo A: Plano del Lote. Anexo B: Reglamento de Construcción y Uso del Fraccionamiento. Anexo C: Documentación de “LA PROMITENTE COMPRADORA”.</p>

  <p style="margin-top:14pt">Las partes firman el presente contrato en dos tantos de igual tenor y valor, habiendo leído y entendido su contenido.</p>

  <table class="firmas">
    <tr>
      <td><div class="lineafirma">${v(d.representante,"NOMBRE DEL REPRESENTANTE")}</div>“LA PROMITENTE VENDEDORA”<br>${v(d.razon_social,"RAZÓN SOCIAL")}</td>
      <td><div class="lineafirma">${v(d.nombre,"NOMBRE DEL COMPRADOR")}</div>“LA PROMITENTE COMPRADORA”</td>
    </tr>
    <tr class="testigos">
      <td><div class="lineafirma">${v(d.testigo1,"TESTIGO 1")}</div>Testigo</td>
      <td><div class="lineafirma">${v(d.testigo2,"TESTIGO 2")}</div>Testigo</td>
    </tr>
  </table>

  <!-- ===================== ANEXO B ===================== -->
  <div class="pagebreak"></div>
  <h2>Anexo B · Reglamento de Construcción y Uso del Fraccionamiento Residencial Turístico La Purísima</h2>
  <p>El presente reglamento establece las normas y lineamientos aplicables a la construcción y uso de los lotes en el Fraccionamiento Residencial Turístico La Purísima, ubicado en el Municipio de Ixtlahuaca, Estado de México, con el propósito de garantizar la armonía urbanística, la seguridad y la preservación del entorno natural del fraccionamiento. El incumplimiento de estas disposiciones será considerado una causal de rescisión del contrato de promesa de compraventa, conforme a lo estipulado en dicho instrumento.</p>

  <h3>Disposiciones Generales</h3>
  <p>1. Uso del Lote: Los lotes están destinados exclusivamente para uso residencial unifamiliar, conforme a las disposiciones municipales y el presente reglamento. Queda estrictamente prohibido utilizar los lotes para cualquier otro fin, incluyendo actividades comerciales, industriales, multifamiliares o de renta antes de la escrituración, salvo autorización expresa del Comité de Arquitectura.</p>
  <p>2. Aprobación de Proyectos: Toda construcción, modificación o instalación deberá contar con la aprobación previa del Comité de Arquitectura, el cual verificará el cumplimiento de este reglamento y la normativa municipal aplicable.</p>

  <h3>Normas de Construcción</h3>
  <p><b>1. Cercados:</b></p>
  <ul>
    <li>Los cercados deberán tener una altura máxima de 2 metros sobre el perfil natural del terreno o la vialidad.</li>
    <li>Deberán ser exclusivamente de malla ciclónica, europea, arbustos o setos vivos. Está prohibida la delimitación mediante muros de cualquier tipo, malla ganadera, alambre de púas o similares, salvo lo dispuesto para muros de contención.</li>
  </ul>
  <p><b>2. Instalaciones y Elementos Urbanos:</b></p>
  <ul>
    <li>Antenas, tinacos y cualquier instalación que afecte la imagen urbana deberán ocultarse mediante soluciones arquitectónicas que garanticen su integración estética, previa aprobación del Comité de Arquitectura.</li>
    <li>Las instalaciones deberán diseñarse para no ser visibles desde el exterior del lote, con materiales y acabados que armonicen con el entorno.</li>
    <li>Todas las construcciones deberán contar con biodigestor o planta de tratamiento para aguas residuales conforme a la norma aplicable.</li>
  </ul>
  <p><b>3. Forestación:</b></p>
  <ul>
    <li>Cada lote deberá contar con un árbol por cada 200 m² de superficie, con distancia mínima de 5 metros entre ellos. Especies: pino, encino u ocote, con altura mínima de 1.50 m al plantarse.</li>
    <li>Como mínimo, 2 árboles al frente de cada lote, en la zona de restricción frontal.</li>
  </ul>
  <p><b>4. Muros de Contención:</b></p>
  <ul>
    <li>De ser necesarios, deberán ser aprobados por el Comité de Arquitectura.</li>
    <li>Acabado de piedra natural, recubiertos con vegetación para integrarlos al entorno.</li>
  </ul>
  <p><b>5. Materiales y Acabados:</b></p>
  <ul>
    <li>Toda construcción deberá realizarse con materiales que prevengan o combatan riesgos de incendio.</li>
    <li>Prohibido el uso de cancelería brillosa, vidrios oscuros, espejeados, polarizados o reflejantes en fachadas y exteriores.</li>
    <li>Prohibidas pinturas fosforescentes y tonalidades azul o morado en exteriores. Paleta preferentemente cálida y terrosa.</li>
    <li>Prohibido dejar a la vista block simple sin acabados o muros aparentes sin recubrimiento.</li>
    <li>Se incentiva el uso de piedra, madera, barro, mármol, acero, cantera o similares.</li>
  </ul>
  <p><b>6. Cubiertas y Techos:</b></p>
  <ul>
    <li>Todas las losas, salvo terrazas o instalaciones específicas (p. ej. paneles solares), deberán ser inclinadas y recubiertas exclusivamente con teja de barro.</li>
    <li>Prohibido el uso de techos de lámina o materiales que imiten teja, salvo autorización excepcional del Comité de Arquitectura.</li>
  </ul>
  <p><b>7. Restricciones de Construcción:</b></p>
  <ul>
    <li>Restricción frontal: 5.5 metros. Restricción posterior: 10 metros. Restricciones laterales: 2.5 metros en colindancias.</li>
    <li>Altura máxima: 2 niveles o 9 metros, medidos desde el nivel de desplante sobre terreno natural. Se permiten estacionamientos y bodegas subterráneos.</li>
    <li>Mayor altura para tinacos u otros elementos requiere aprobación del Comité de Arquitectura.</li>
  </ul>
  <p><b>8. Superficie Libre:</b> Al menos el 70% de la superficie total del lote deberá permanecer sin construir (áreas verdes, jardines u otros usos sin edificaciones permanentes).</p>
  <p><b>9. Plazo de Obra:</b> Queda estrictamente prohibido iniciar una construcción y detenerla sin terminarla. Si esto sucede por más de 180 días, la asociación de colonos y/o “LA PROMITENTE VENDEDORA” calcularán el monto para terminar el exterior y paisajismo o hacer la demolición y restauración del predio, y podrán ejecutarlo a cargo de “LA PROMITENTE COMPRADORA”.</p>

  <h3>Disposiciones Finales</h3>
  <p>1. Cumplimiento de Normativa: Toda construcción deberá cumplir con las disposiciones municipales, estatales y federales aplicables, incluyendo licencias, normas de seguridad y protección ambiental. “LA PROMITENTE COMPRADORA” será responsable de obtener las autorizaciones necesarias antes de iniciar cualquier obra.</p>
  <p>2. Supervisión y Sanciones: El Comité de Arquitectura supervisará el cumplimiento y podrá emitir recomendaciones, requerimientos y sanciones para corregir desviaciones, de carácter obligatorio.</p>
  <p>3. Modificaciones: Cualquier excepción deberá ser aprobada por escrito por el Comité de Arquitectura y, en su caso, por “LA PROMITENTE VENDEDORA”, sin que ello implique renuncia a las demás disposiciones.</p>
  <p>Este reglamento forma parte integral del contrato de promesa de compraventa y deberá formar parte integral de la escritura cuando se formalice dicha compraventa. Es de cumplimiento obligatorio para “LA PROMITENTE COMPRADORA”. Su aceptación se confirma con la firma del contrato principal.</p>

  </body></html>`;
}
