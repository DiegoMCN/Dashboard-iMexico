/* ═══════════════════════════════════════════════════════════════
   iMexico — Motor de dashboards (imx-core.js)
   Lee ?proyecto=key, toma su config de proyectos.js y arma todo.
   Requiere: proyectos.js cargado antes, y el shell dashboard.html.
   ═══════════════════════════════════════════════════════════════ */
const API_BASE = "https://script.google.com/macros/s/AKfycbxLGGR1GuNk6-amf_xAMBIikKaXEaDX7xeNPyzg8rXqNGNQlS00qOI3HCo7WbtHSNXq/exec";

const PROJ_KEY = new URLSearchParams(location.search).get("proyecto") || "landmark";
const STATIC_CFG = (window.IMX_PROYECTOS||{})[PROJ_KEY];

/* ── AUTO-CONFIG ──────────────────────────────────────────────────
   Si el proyecto NO tiene entrada en proyectos.js, el dashboard igual
   funciona: usa el mapeo universal que ya expone getInventario() en
   Código.gs (numero/piso/status/tipo/tipologia/m2/precio..precio6) y
   deriva piso/tipo/columnas del inventario en vivo la primera vez que
   carga. Con solo agregar el proyecto a CONFIG.SHEETS + PROYECTOS_META
   en el Apps Script, su tarjeta y su dashboard aparecen solos.
   proyectos.js queda para EXCEPCIONES (torres, monedas, paneles
   especiales, etc.), no para dar de alta cada proyecto nuevo.
   ────────────────────────────────────────────────────────────────── */
const IS_AUTO = !STATIC_CFG;
const UNIVERSAL_APIMAP = { n:"numero", p:"piso", s:"status", t:"tipologia", ubi:"ubicacion",
  m2:"m2", m2i:"m2i", m2e:"m2e", p1:"precio", p2:"precio2", p3:"precio3", p4:"precio4", p5:"precio5", p6:"precio6" };
const prettify = k => k.replace(/_/g,' ').replace(/\b\w/g, c=>c.toUpperCase());

const CFG = STATIC_CFG || {
  nombre: prettify(PROJ_KEY),
  sub: "Dashboard Ejecutivo de Inventario",
  apiMap: UNIVERSAL_APIMAP,
  mapExtra: (o,u) => { if(!o.t) o.t = String(u.tipo||'').trim(); }, // tipologia vacía → usa tipo
  priceLabel: "p1",
};

// Identidad visual + textos del header
document.body.setAttribute("data-proyecto", PROJ_KEY);
document.title = CFG.nombre + " — iMexico";
document.getElementById("hTitle").textContent = CFG.nombre;
document.getElementById("hSub").textContent = CFG.sub || (CFG.ciudad + " · Dashboard Ejecutivo de Inventario");

// Auto: en paralelo, toma nombre/ciudad reales del Apps Script (PROYECTOS_META)
// sin bloquear el resto del render.
if (IS_AUTO) {
  fetch(API_BASE + "?listar=proyectos").then(r=>r.json()).then(json=>{
    const meta = (json.proyectos||[]).find(p=>p.key===PROJ_KEY);
    if (!meta) return;
    CFG.nombre = meta.nombre || CFG.nombre;
    CFG.ciudad = meta.ciudad || "";
    CFG.sub = CFG.ciudad ? (CFG.ciudad + " · Dashboard Ejecutivo de Inventario") : CFG.sub;
    document.title = CFG.nombre + " — iMexico";
    document.getElementById("hTitle").textContent = CFG.nombre;
    document.getElementById("hSub").textContent = CFG.sub;
  }).catch(()=>{});
}

let PISOS = CFG.pisos || [];
const RAW = CFG.raw || [];
let TIPOS = (CFG.tipos && CFG.tipos.length) ? CFG.tipos
  : [...new Set(RAW.map(u=>u.t).filter(Boolean))].sort();
let TIPOS_LABELS = (CFG.tiposLabels && CFG.tiposLabels.length) ? CFG.tiposLabels : TIPOS;
const EDIFICIOS = CFG.edificios || [];
const PRICE_LABEL = CFG.priceLabel || "p1";


let data=[...RAW], filtered=[...RAW];

const fmt=v=>v?'$'+(v/1e6).toFixed(2)+'M':'—';
const MONEDA = CFG.moneda || 'MXN';
const LOCALE = MONEDA==='USD' ? 'en-US' : 'es-MX';
const fmtF=v=>'$'+v.toLocaleString(LOCALE);
const fmtKPI = CFG.kpiFmt==='full' ? (v=>fmtF(Math.round(v))) : fmt;
// Etiquetas de moneda en títulos de panel
if(MONEDA!=='MXN'){
  document.querySelectorAll('.pt').forEach(el=>{ el.textContent = el.textContent.replace('(MXN)','('+MONEDA+')'); });
  document.querySelectorAll('.ks').forEach(el=>{ if(el.textContent.trim()==='MXN') el.textContent=MONEDA; });
}

// Títulos de panel según variantes configuradas
const setPanelTitle=(id,txt)=>{const el=document.getElementById(id);if(!el)return;
  const box=el.closest('.bc')||el.parentElement;const t=box?box.querySelector('.pt'):null;if(t)t.textContent=txt;};
if(CFG.panelUnidades==='dispPiso') setPanelTitle('bT','Disponibles por Piso');
if(CFG.panelPrecio==='tipo') setPanelTitle('bP','Precio Promedio por Tipo ('+MONEDA+')');
if(CFG.rangoTitulo) setPanelTitle('pR',CFG.rangoTitulo);

// Sección opcional de cards por tipología (se inserta antes de la tabla)
if(CFG.tipoCards){
  const tbl=document.getElementById('tbl');
  const box=tbl?(tbl.closest('.bc')||tbl.parentElement.parentElement):null;
  if(box&&box.parentNode){const d=document.createElement('div');d.id='tCards';d.className='tcards';box.parentNode.insertBefore(d,box);}
}
const ns=s=>(s||'').toUpperCase().replace('RESERVADA','RESERVADO').replace('VENDIDA','VENDIDO').replace('DISPONIBLE','DISP');
const GET_PRICE = u => u[PRICE_LABEL] || 0;
const RANGOS_PRECIO = CFG.rangosPrecio || [];
const RANGO_SUF = CFG.rangoSufijo || 'M';   // [{t,min,max}] en millones — panel "Rango de Precios"
const plbl = p => (CFG.pisoLabels && CFG.pisoLabels[p]) || (p==='PB'?'P.Baja':p==='PH'?'PH':'Nivel '+p);

/* ── TABLA DECLARATIVA ──
   CFG.columnas = [{campo, label, fmt}] con fmt ∈:
   id | piso | badge | texto | muted | m2 | m2strong | precio | preciomuted */
const FMT = {
  id:       (u,c)=>`<td><strong style="color:var(--ac2)">${u[c.campo]}</strong></td>`,
  piso:     (u,c)=>`<td>${plbl(u[c.campo])}</td>`,
  badge:    (u,c)=>`<td><span class="badge ${ns(u[c.campo]).toLowerCase()}">${u[c.campo]}</span></td>`,
  texto:    (u,c)=>`<td>${u[c.campo]||''}</td>`,
  muted:    (u,c)=>`<td style="color:var(--muted);font-size:11px">${u[c.campo]||''}</td>`,
  m2:       (u,c)=>`<td>${u[c.campo]>0?u[c.campo]+' m²':'—'}</td>`,
  m2strong: (u,c)=>`<td><strong>${u[c.campo]||0} m²</strong></td>`,
  precio:   (u,c)=>`<td style="color:var(--ac)">${u[c.campo]?fmtF(u[c.campo]):'—'}</td>`,
  preciomuted:(u,c)=>`<td style="color:var(--muted)">${u[c.campo]?fmtF(u[c.campo]):'—'}</td>`,
  precioflex: (u,c)=>`<td style="color:var(--ac)">${u[c.campo]?fmtF(u[c.campo])+(u.usd?' <span style="font-size:9px;color:var(--muted)">USD</span>':''):'—'}</td>`,
  precioflexmuted:(u,c)=>`<td style="color:var(--muted)">${u[c.campo]?fmtF(u[c.campo])+(u.usd?' <span style="font-size:9px">USD</span>':''):'—'}</td>`,
};
let COLUMNAS = (CFG.columnas && CFG.columnas.length) ? CFG.columnas : [];
function defaultColumnas(sample){
  const has = f => sample.some(u => u[f]!==undefined && u[f]!==0 && u[f]!=='');
  const cols = [{campo:'n',label:'Unidad',fmt:'id'}];
  if (has('p')) cols.push({campo:'p',label:'Piso',fmt:'piso'});
  cols.push({campo:'s',label:'Status',fmt:'badge'});
  if (has('t')) cols.push({campo:'t',label:'Tipología',fmt:'muted'});
  if (has('m2')) cols.push({campo:'m2',label:'M²',fmt:'m2strong'});
  for (let i=1;i<=6;i++){ const k='p'+i; if (has(k)) cols.push({campo:k,label:'Precio '+i,fmt:i===1?'precio':'preciomuted'}); }
  return cols;
}
const BUILD_ROW = u => '<tr>' + COLUMNAS.map(c => (FMT[c.fmt]||FMT.texto)(u,c)).join('') + '</tr>';

function renderFilters(){
  const f=document.getElementById('filters');
  if(EDIFICIOS.length && !document.getElementById('edifPills')){
    const wrap=document.createElement('div'); wrap.className='status-pills'; wrap.id='edifPills';
    f.parentElement.insertBefore(wrap, f);
  }
  const pisoOpts=PISOS.map(p=>`<option value="${p}">${plbl(p)}</option>`).join('');
  document.querySelectorAll('.fg').forEach(g=>{ if(g.querySelector('#fT')) g.style.display=TIPOS.length?'':'none'; });
  const bt=document.getElementById('bT'); if(bt){const box=bt.closest('.bc')||bt.parentElement; if(box)box.style.display=TIPOS.length?'':'none';}
  const tipoOpts=TIPOS.map((t,i)=>`<option value="${t}">${TIPOS_LABELS[i]}</option>`).join('');
  f.innerHTML=`
    <div class="fg"><label>Piso</label><select id="fP"><option value="">Todos</option>${pisoOpts}</select></div>
    <div class="status-pills" id="statusPills"></div>
    <div class="fg"><label>Tipo</label><select id="fT"><option value="">Todos</option>${tipoOpts}</select></div>
    <button class="btn" onclick="doReset()">↺ Limpiar</button>`;
  document.getElementById('fP').addEventListener('change',applyF);
  document.getElementById('fT').addEventListener('change',applyF);
  if(EDIFICIOS.length) renderEdifPills();
}
const PALC=['#7c5cbf','#3aa3d8','#2fae7d','#e8a13a','#e05c8a','#5a6acf'];
function renderEdifPills(){
  const c=document.getElementById('edifPills'); if(!c) return;
  const active=window._activeEdificio||'';
  c.innerHTML = `<span class="spill all ${active===''?'active':''}" data-v="">Todos los edificios</span>` +
    EDIFICIOS.map((e,i)=>`<span class="spill ${active===e?'active':''}" data-v="${e}" style="${active===e?'background:'+PALC[i%PALC.length]+';border-color:'+PALC[i%PALC.length]+';color:#fff;':'border-color:'+PALC[i%PALC.length]+';color:'+PALC[i%PALC.length]+';'}">${e}</span>`).join('');
  c.querySelectorAll('.spill').forEach(btn=>{
    btn.addEventListener('click', ()=>{ window._activeEdificio = btn.dataset.v; renderEdifPills(); applyF(); });
  });
}
function renderThead(){
  const headers = COLUMNAS.map(c => c.label);
  document.getElementById('th').innerHTML='<tr>'+headers.map(h=>`<th>${h}</th>`).join('')+'</tr>';
}
renderFilters();
renderThead();

const CACHE_KEY = 'imx_proy_' + PROJ_KEY;

async function load() {
  setLoading(true);
  // 0) PINTADO INMEDIATO desde caché: el usuario ve datos al instante
  try{
    const c = JSON.parse(localStorage.getItem(CACHE_KEY));
    if(c && c.data && c.data.length){
      data = c.data;
      buildStatusPills();
      applyF();
      const el = document.getElementById('upd');
      if(el) el.textContent = 'Actualizando…';
    }
  }catch(e){}
  // 1) Datos frescos en segundo plano
  try {
    const res = await fetch(API_BASE + '?proyecto=' + PROJ_KEY);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const json = await res.json();
    if (json.error) throw new Error(json.error);
    if (json.unidades && json.unidades.length > 0) {
      const NUMERICOS = {m2:1,m2i:1,m2e:1,m2b:1,m2l:1,m2c:1,terr:1,tot:1,rec:1,precio:1,pr:1,p1:1,p2:1,p3:1,p4:1,p5:1,p6:1};
      data = json.unidades.map(u => {
        const o = {};
        for (const campo in CFG.apiMap) {
          const v = u[CFG.apiMap[campo]];
          o[campo] = NUMERICOS[campo] ? (Number(v)||0) : String(v||'');
        }
        if (CFG.mapExtra) CFG.mapExtra(o, u);
        return o;
      });
      // Auto-config: la primera vez que llegan datos reales, deriva piso/tipo/columnas
      // y re-arma filtros y encabezado (solo si el proyecto no trae config propia).
      if (IS_AUTO) {
        if (!CFG.pisos) PISOS = [...new Set(data.map(u=>u.p).filter(Boolean))]
          .sort((a,b)=> (a==='PB'?-1:b==='PB'?1: a.localeCompare(b,undefined,{numeric:true})));
        if (!CFG.tipos) { TIPOS = [...new Set(data.map(u=>u.t).filter(Boolean))].sort(); TIPOS_LABELS = TIPOS; }
        if (!CFG.columnas) COLUMNAS = defaultColumnas(data);
        renderFilters();
        renderThead();
      }
      try{ localStorage.setItem(CACHE_KEY, JSON.stringify({t:Date.now(), data})); }catch(e){}
    }
    const now = new Date().toLocaleTimeString('es-MX');
    const upd = 'Actualizado: ' + now;
    ['lastUpdate','hdr-update','upd'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.textContent = upd;
    });
  } catch(e) {
    console.warn('API error:', e.message, '— usando datos locales');
    ['lastUpdate','hdr-update','upd'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.textContent = '⚠ Datos locales';
    });
  }
  setLoading(false);
  buildStatusPills();
  applyF();
}

function setLoading(v) {
  const dot = document.querySelector('.live-dot');
  if (dot) dot.style.background = v ? '#c9a030' : 'var(--ac)';
}

function applyF(){
  const p=document.getElementById('fP').value;
  const s=window._activeStatus||'';
  const t=document.getElementById('fT').value;
  const ed=window._activeEdificio||'';
  filtered=data.filter(u=>{
    if(p&&u.p!==p)return false;
    if(s&&ns(u.s)!==s)return false;
    if(t&&u.t!==t)return false;
    if(ed&&u.ed!==ed)return false;
    return true;
  });
  render();
}
function doReset(){
  ['fP','fT'].forEach(id=>document.getElementById(id).value='');
  filtered=[...data];render();

  window._activeStatus='';
  window._activeEdificio='';
  if(EDIFICIOS.length) renderEdifPills();
  document.querySelectorAll('.status-pills:not(#edifPills) .spill').forEach(b=>b.classList.remove('active'));
  const allBtn=document.querySelector('.status-pills:not(#edifPills) .spill.all');
  if(allBtn)allBtn.classList.add('active');
  render();
}

function render(){
  const d=filtered.filter(u=>ns(u.s)==='DISP').length;
  const r=filtered.filter(u=>ns(u.s)==='RESERVADO').length;
  const v=filtered.filter(u=>ns(u.s)==='VENDIDO').length;
  const t=filtered.length;
  const prices=filtered.filter(u=>GET_PRICE(u)>0).map(u=>GET_PRICE(u));
  document.getElementById('kD').textContent=d;
  document.getElementById('kR').textContent=r;
  document.getElementById('kV').textContent=v;
  document.getElementById('kMn').textContent=prices.length?fmtKPI(Math.min(...prices)):'—';
  document.getElementById('kMx').textContent=prices.length?fmtKPI(Math.max(...prices)):'—';
  const circ=2*Math.PI*38;
  document.getElementById('cD').setAttribute('stroke-dasharray',`${(d/t)*circ} ${circ-(d/t)*circ}`);
  document.getElementById('cR').setAttribute('stroke-dasharray',`${(r/t)*circ} ${circ-(r/t)*circ}`);
  document.getElementById('cR').setAttribute('stroke-dashoffset',60-(d/t)*circ);
  document.getElementById('cV').setAttribute('stroke-dasharray',`${(v/t)*circ} ${circ-(v/t)*circ}`);
  document.getElementById('cV').setAttribute('stroke-dashoffset',60-(d/t)*circ-(r/t)*circ);
  document.getElementById('cT').textContent=t;
  document.getElementById('lD').textContent=d;
  document.getElementById('lR').textContent=r;
  document.getElementById('lV').textContent=v;
  if(CFG.panelUnidades==='dispPiso'){
    const dc=PISOS.map(p=>({p,n:filtered.filter(u=>u.p===p&&ns(u.s)==='DISP').length})).filter(x=>x.n>0);
    const dmx=Math.max(...dc.map(x=>x.n),1);
    document.getElementById('bT').innerHTML=dc.map(x=>`
      <div class="br2"><div class="bl2">${plbl(x.p)}</div>
      <div class="bt"><div class="bf" style="width:${(x.n/dmx)*100}%"></div></div>
      <div class="bv">${x.n} uds</div></div>`).join('')||'<div style="color:var(--muted);font-size:11px;padding:8px">Sin disponibles con el filtro actual</div>';
  } else {
    const tc={};TIPOS.forEach(tp=>tc[tp]=filtered.filter(u=>u.t===tp).length);
    const mx=Math.max(...Object.values(tc),1);
    document.getElementById('bT').innerHTML=TIPOS.map((tp,i)=>`
      <div class="br2"><div class="bl2">${TIPOS_LABELS[i]}</div>
      <div class="bt"><div class="bf" style="width:${(tc[tp]/mx)*100}%"></div></div>
      <div class="bv">${tc[tp]} uds</div></div>`).join('');
  }
  document.getElementById('pR').innerHTML=(()=>{
    if(!RANGOS_PRECIO.length){const el=document.getElementById("pR");if(el)el.parentElement.style.display="none";return "";}
    const absMax = Math.max(...RANGOS_PRECIO.map(d=>d.max));
    return RANGOS_PRECIO.map(d=>`
      <div class="prr">
        <div class="prh">
          <span class="prt">${d.t}</span>
          <span class="prv">${d.min.toFixed(1)}${RANGO_SUF} – ${d.max.toFixed(1)}${RANGO_SUF} ${MONEDA}</span>
        </div>
        <div class="prtr">
          <div class="prf" style="margin-left:${(d.min/absMax)*100}%;width:${((d.max-d.min)/absMax)*100}%"></div>
        </div>
      </div>`).join('');
  })();
  if(!PISOS.length){
    const hEl=document.getElementById('hM'); const box=hEl?(hEl.closest('.pb')||hEl.parentElement):null;
    if(box) box.style.display='none';
  }
  document.getElementById('hM').innerHTML=PISOS.map(p=>{
    const us=filtered.filter(u=>u.p===p);
    if(!us.length)return'';
    return`<div class="hr2"><div class="hl">${plbl(p)}</div><div class="hcs">${us.map(u=>`<div class="hc ${ns(u.s).toLowerCase()}"
      data-n="${u.n}" data-t="${u.t}" data-s="${u.s}" data-p="${GET_PRICE(u)?fmtF(GET_PRICE(u)):'Sin precio'}" data-m="${u.tot||u.m2||0}" onmouseenter="showTipEl(event,this)" 
      onmouseleave="hideTip()"></div>`).join('')}</div></div>`;
  }).join('');
  if(CFG.panelPrecio==='tipo'){
    const tp2=TIPOS.map((tp,i)=>{
      const us=filtered.filter(u=>u.t===tp&&GET_PRICE(u)>0);
      return{lbl:'Tipo '+tp,i,avg:us.length?us.reduce((a,u)=>a+GET_PRICE(u),0)/us.length:0};
    }).filter(x=>x.avg>0);
    const tmx=Math.max(...tp2.map(x=>x.avg),1);
    document.getElementById('bP').innerHTML=tp2.map(x=>`
      <div class="br2">
        <div class="bl2" style="color:${PALC[x.i%PALC.length]};font-weight:600">${x.lbl}</div>
        <div class="bt"><div class="bf" style="width:${(x.avg/tmx)*100}%;background:${PALC[x.i%PALC.length]}"></div></div>
        <div class="bv" style="font-weight:600">${fmtF(Math.round(x.avg))}</div>
      </div>`).join('');
  } else {
    const pp=PISOS.map(p=>{
      const us=filtered.filter(u=>u.p===p&&GET_PRICE(u)>0);
      return{p,avg:us.length?us.reduce((a,u)=>a+GET_PRICE(u),0)/us.length:0};
    }).filter(x=>x.avg>0);
    const mpx=Math.max(...pp.map(x=>x.avg),1);
    document.getElementById('bP').innerHTML=pp.map(x=>`
      <div class="br2">
        <div class="bl2">${plbl(x.p)}</div>
        <div class="bt"><div class="bf" style="width:${(x.avg/mpx)*100}%"></div></div>
        <div class="bv" style="color:var(--ac2);font-weight:600">${fmtF(Math.round(x.avg))}</div>
      </div>`).join('');
  }
  if(CFG.tipoCards){
    const el=document.getElementById('tCards');
    if(el) el.innerHTML=TIPOS.map((tp,i)=>{
      const us=data.filter(u=>u.t===tp);
      const m2s=us.map(u=>u.tot||u.m2||0).filter(x=>x>0);
      const m2=m2s.length?(m2s.reduce((a,b)=>a+b,0)/m2s.length):0;
      const dd=us.filter(u=>ns(u.s)==='DISP').length,rr=us.filter(u=>ns(u.s)==='RESERVADO').length,vv=us.filter(u=>ns(u.s)==='VENDIDO').length;
      const c=PALC[i%PALC.length];
      return `<div class="tcard" style="border-top-color:${c}">
        <div class="tc-name" style="color:${c}">Tipo ${tp}</div>
        <div class="tc-m2">${m2?m2.toFixed(1)+' m²':'&nbsp;'}</div>
        <div class="tc-row">
          <div><span class="tc-v" style="color:#16a34a">${dd}</span><span class="tc-l">Disp.</span></div>
          <div><span class="tc-v" style="color:#d97706">${rr}</span><span class="tc-l">Res.</span></div>
          <div><span class="tc-v" style="color:#dc2626">${vv}</span><span class="tc-l">Vend.</span></div>
        </div></div>`;
    }).join('');
  }
  document.getElementById('cnt').textContent=filtered.length;
  document.getElementById('tb').innerHTML=filtered.map(u=>BUILD_ROW(u)).join('');
}

function showTipEl(e,el){
  showTip(e,'<strong>'+el.dataset.n+' &middot; '+el.dataset.t+'</strong><br>'+el.dataset.s+'<br>'+el.dataset.p+'<br>'+el.dataset.m+' m²');
}
function showTip(e,h){const t=document.getElementById('tip');t.innerHTML=h;t.style.display='block';t.style.left=(e.clientX+14)+'px';t.style.top=(e.clientY-10)+'px';}
function hideTip(){document.getElementById('tip').style.display='none';}
document.addEventListener('mousemove',e=>{const t=document.getElementById('tip');if(t.style.display==='block'){t.style.left=(e.clientX+14)+'px';t.style.top=(e.clientY-10)+'px';}});

// ── STATUS PILLS v1.2 ──────────────────────────────────────────────────
function buildStatusPills(){
  const container = document.getElementById('statusPills');
  if(!container) return;
  const counts = {
    DISP:     data.filter(u=>ns(u.s)==='DISP').length,
    RESERVADO:data.filter(u=>ns(u.s)==='RESERVADO').length,
    VENDIDO:  data.filter(u=>ns(u.s)==='VENDIDO').length,
  };
  const total = data.length;
  const active = window._activeStatus || '';
  container.innerHTML = `
    <span class="spill all ${active===''?'active':''}" data-v="">
      Todos <span class="scount">${total}</span>
    </span>
    <span class="spill disp ${active==='DISP'?'active':''}" data-v="DISP">
      Disponible <span class="scount">${counts.DISP}</span>
    </span>
    <span class="spill res ${active==='RESERVADO'?'active':''}" data-v="RESERVADO">
      Reservado <span class="scount">${counts.RESERVADO}</span>
    </span>
    <span class="spill vend ${active==='VENDIDO'?'active':''}" data-v="VENDIDO">
      Vendido <span class="scount">${counts.VENDIDO}</span>
    </span>
  `;
  container.querySelectorAll('.spill').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      window._activeStatus = btn.dataset.v;
      applyF();
    });
  });
}
window._activeStatus = '';

load();
setInterval(load,5*60*1000);
