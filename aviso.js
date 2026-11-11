// HARMONIX · aviso en el móvil por Telegram
// Abre HarmonixSenales.html en un navegador sin ventana, busca igual que la sección «Cerca de su zona»
// y manda a Telegram solo las zonas nuevas. Lo ejecuta GitHub Actions cada 15 min de 08:00 a 22:00 (hora de Nicaragua).
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');

const ZONA_HORARIA = 'America/Managua';
const DESDE = 8 * 60;              // 08:00
const HASTA = 22 * 60 + 30;        // 22:00 + 30 min de margen por si GitHub arranca tarde la última búsqueda
const OLVIDAR_MIN = 50;            // una zona vuelve a avisarse solo si estuvo fuera de la lista más de 50 min
const ESTADO = path.join(__dirname, 'estado.json');

const TOKEN = process.env.TELEGRAM_TOKEN, CHAT = process.env.TELEGRAM_CHAT_ID, PRUEBA = process.env.PRUEBA === 'true';

async function telegram(texto){
  const r = await fetch(`https://api.telegram.org/bot${TOKEN}/sendMessage`, {
    method:'POST', headers:{'Content-Type':'application/json'},
    body:JSON.stringify({chat_id:CHAT, text:texto.slice(0, 4000), disable_web_page_preview:true})
  });
  if(!r.ok) throw new Error('Telegram: ' + r.status + ' ' + await r.text());
}

function minutosNicaragua(){
  const p = new Intl.DateTimeFormat('en-GB', {timeZone:ZONA_HORARIA, hour:'2-digit', minute:'2-digit', hourCycle:'h23'}).formatToParts(new Date());
  return +p.find(x => x.type === 'hour').value * 60 + +p.find(x => x.type === 'minute').value;
}

(async () => {
  if(!TOKEN || !CHAT) throw new Error('Faltan los secretos TELEGRAM_TOKEN y TELEGRAM_CHAT_ID.');
  let estado = {};
  try { estado = JSON.parse(fs.readFileSync(ESTADO, 'utf8')); } catch(e){}
  const guardar = () => fs.writeFileSync(ESTADO, JSON.stringify(estado));
  guardar();

  const m = minutosNicaragua();
  if(!PRUEBA && (m < DESDE || m > HASTA)){ console.log('Fuera de horario, no se busca.'); return; }

  // ajustes.json: una lista de búsquedas (sintéticos, mercados…). También acepta un solo bloque.
  let busquedas = [{}];
  try { const a = JSON.parse(fs.readFileSync(path.join(__dirname, 'ajustes.json'), 'utf8')); busquedas = Array.isArray(a) ? a : [a]; }
  catch(e){ console.log('Sin ajustes.json: se usan los ajustes por defecto.'); }

  const navegador = await puppeteer.launch({executablePath:process.env.CHROME_PATH || '/usr/bin/google-chrome', args:['--no-sandbox']});
  const resultados = [];
  try {
    const pag = await navegador.newPage();
    await pag.emulateTimezone(ZONA_HORARIA);
    pag.on('pageerror', e => console.log('Error en la página:', e.message));
    await pag.goto('file://' + path.join(__dirname, 'HarmonixSenales.html'), {waitUntil:'load', timeout:60000});
    for(const cfg of busquedas){
      const nombre = cfg.band === 'mkt' ? 'Mercados' : 'Sintéticos';
      try {
        const r = await pag.evaluate(c => window.HX_AVISO(c), cfg);
        console.log(`${nombre}: gráficos revisados ${r.charts}/${r.total}, zonas en la lista ${r.items.length}.`);
        if(r.errors.length) console.log(`${nombre}, errores:`, r.errors.join(' | '));
        resultados.push({nombre, ...r});
      } catch(e){ console.log(`${nombre}: la búsqueda falló:`, e.message); resultados.push({nombre, charts:0, total:1, errors:[e.message], items:[]}); }
    }
  } finally { await navegador.close(); }

  if(PRUEBA) await telegram('✅ HARMONIX conectado.\n' + resultados.map(r => `${r.nombre}: ${r.charts}/${r.total} gráficos, ${r.items.length} zonas ahora mismo.`).join('\n'));
  const fallidas = resultados.filter(r => r.total && !r.charts).map(r => r.nombre);
  if(fallidas.length) await telegram(`⚠️ HARMONIX no pudo leer los datos de Deriv (${fallidas.join(', ')}) en esta búsqueda. Lo intentará otra vez en 15 min.`);

  // sin velas recientes (mercado cerrado, por ejemplo forex el fin de semana) no se avisa
  const items = resultados.flatMap(r => r.items).filter(z => !z.stale);
  const ahora = Date.now(), nuevas = [];
  items.forEach(z => { if(PRUEBA || !estado[z.key]) nuevas.push(z); estado[z.key] = ahora; });
  Object.keys(estado).forEach(k => { if(ahora - estado[k] > OLVIDAR_MIN * 60000) delete estado[k]; });
  guardar();

  for(const z of nuevas) await telegram(z.text);
  console.log(`Avisos enviados: ${nuevas.length}.`);
})().catch(e => { console.error(e); process.exit(1); });
