'use strict';
// Excel の読み込み(今お使いの時間割の Excel → 教員の時間割)と、書き出し(教員の時間割 → Excel)。
// 読み込みは外部ライブラリを使わず、ブラウザに入っている ZIP の展開(DecompressionStream)と XML の読み取りで行う。
// Excel の形の決まりは、変換ツール(timetable_converter.html)と同じ:
//   A列に「担当」と書いた見出しの行 → 次の行に曜日ごとの 1,2,3… の時限 → そのあとに「担当・教科・教員・各コマ」の行が続く。

//////////////////////// xlsx を読む ////////////////////////
async function unzipEntries(buf){
  const u8 = new Uint8Array(buf), dv = new DataView(buf);
  let eocd = -1;
  for(let i=u8.length-22; i>=Math.max(0, u8.length-65557); i--){ if(dv.getUint32(i, true)===0x06054b50){ eocd = i; break; } }
  if(eocd<0) throw new Error('Excel のファイル(.xlsx)として読めませんでした。');
  const count = dv.getUint16(eocd+10, true);
  let p = dv.getUint32(eocd+16, true);
  const dec = new TextDecoder();
  const entries = {};
  for(let k=0; k<count; k++){
    if(dv.getUint32(p, true)!==0x02014b50) break;
    const method = dv.getUint16(p+10, true), csize = dv.getUint32(p+20, true);
    const nlen = dv.getUint16(p+28, true), xlen = dv.getUint16(p+30, true), clen = dv.getUint16(p+32, true);
    const off = dv.getUint32(p+42, true);
    const name = dec.decode(u8.subarray(p+46, p+46+nlen));
    entries[name] = { method, csize, off };
    p += 46 + nlen + xlen + clen;
  }
  return {
    has: name => !!entries[name],
    async text(name){
      const e = entries[name];
      if(!e) return null;
      const lnlen = dv.getUint16(e.off+26, true), lxlen = dv.getUint16(e.off+28, true);
      const data = u8.subarray(e.off+30+lnlen+lxlen, e.off+30+lnlen+lxlen+e.csize);
      if(e.method===0) return dec.decode(data);
      if(e.method!==8) throw new Error('この Excel のファイルは読めない形式で保存されています。');
      const ds = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
      return await new Response(ds).text();
    }
  };
}
function xmlDoc(text){ return new DOMParser().parseFromString(text, 'application/xml'); }
function colIndex(ref){ const m = ref.match(/^([A-Z]+)/); let n = 0; for(const ch of m[1]) n = n*26 + ch.charCodeAt(0)-64; return n-1; }
// 戻り値: [{ name:シート名, rows:[[値…]…] }]。値は 文字 / 数 / null
async function readXlsx(file){
  if(!('DecompressionStream' in window)) throw new Error('このブラウザでは Excel を読み込めません。Chrome か Edge の新しい版で開いてください。');
  const zip = await unzipEntries(await file.arrayBuffer());
  const shared = [];
  const sst = await zip.text('xl/sharedStrings.xml');
  if(sst){
    xmlDoc(sst).querySelectorAll('si').forEach(si=>{
      // ふりがな(rPh)の文字は入れない
      let s = '';
      si.querySelectorAll('t').forEach(t=>{ if(!t.closest('rPh')) s += t.textContent; });
      shared.push(s);
    });
  }
  const wb = xmlDoc(await zip.text('xl/workbook.xml'));
  const rels = xmlDoc(await zip.text('xl/_rels/workbook.xml.rels'));
  const target = {};
  rels.querySelectorAll('Relationship').forEach(r=>{ target[r.getAttribute('Id')] = r.getAttribute('Target'); });
  const out = [];
  for(const sh of wb.querySelectorAll('sheet')){
    const rid = sh.getAttribute('r:id') || sh.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id');
    let t = target[rid] || '';
    t = t.startsWith('/') ? t.slice(1) : 'xl/' + t;
    const text = await zip.text(t);
    if(!text) continue;
    const rows = [];
    xmlDoc(text).querySelectorAll('sheetData > row').forEach(row=>{
      const r = Number(row.getAttribute('r')) - 1;
      const arr = rows[r] = [];
      row.querySelectorAll('c').forEach(c=>{
        const ci = colIndex(c.getAttribute('r')), type = c.getAttribute('t');
        const v = c.querySelector('v');
        let val = null;
        if(type==='s') val = v ? shared[Number(v.textContent)] : null;
        else if(type==='inlineStr'){ val = ''; c.querySelectorAll('is t').forEach(x=>{ if(!x.closest('rPh')) val += x.textContent; }); }
        else if(type==='str' || type==='e') val = v ? v.textContent : null;
        else if(type==='b') val = v ? (v.textContent==='1' ? 'TRUE' : 'FALSE') : null;
        else if(v){ const n = Number(v.textContent); val = Number.isFinite(n) ? n : v.textContent; }
        arr[ci] = (val==='' ? null : val);
      });
    });
    for(let i=0; i<rows.length; i++) if(!rows[i]) rows[i] = [];
    out.push({ name: sh.getAttribute('name'), rows });
  }
  return out;
}
// Excel が「1-2」を日付(1月2日)に変えてしまった数を、元の「1-2」に戻す
function excelSerialToMD(n){ const d = new Date(Date.UTC(1899, 11, 30) + n*86400000); return (d.getUTCMonth()+1)+'-'+d.getUTCDate(); }
function excelSerialWeekday(n){ return new Date(Date.UTC(1899, 11, 30) + n*86400000).getUTCDay(); }

//////////////////////// 時間割の Excel を読み取る ////////////////////////
function isTantoRow(row){ return row && typeof row[0]==='string' && row[0].replace(/\s/g,'')==='担当'; }
// 戻り値: { days:[{ wd, periods }], teachers:[{ role, subject, name, cells:{ '1-3':'1-2' } }], warnings:[] }
function parseTimetableRows(rows){
  const h = rows.findIndex(isTantoRow);
  if(h<0) throw new Error('「担当」と書いた見出しの行が見つかりませんでした。');
  const pRow = rows[h+1] || [];
  const flat = [];
  for(let c=3; c<pRow.length; c++){
    const v = typeof pRow[c]==='string' ? Number(pRow[c].normalize('NFKC')) : pRow[c];
    if(Number.isInteger(v) && v>=1 && v<=20) flat.push({ col:c, period:v });
    else if(flat.length) break;
  }
  if(!flat.length) throw new Error('「担当」の次の行に、時限の番号(1・2・3…)が見つかりませんでした。');
  const blocks = []; let cur = [];
  flat.forEach(x=>{ if(x.period===1 && cur.length){ blocks.push(cur); cur = []; } cur.push(x); });
  if(cur.length) blocks.push(cur);
  if(blocks.length>6) throw new Error('曜日が7つ以上あります。1週間分(月〜金、または月〜土)の時間割のシートを選んでください。');
  // 曜日: 見出しの日付、または「月」「火」などの文字から決める。分からなければ月曜から順に
  const warnings = [];
  const used = new Set();
  const dayWd = blocks.map((b, i)=>{
    const v = rows[h][b[0].col];
    let wd = null;
    if(typeof v==='number' && v>1000) wd = excelSerialWeekday(v);
    else if(typeof v==='string'){ const m = v.match(/[日月火水木金土]/); if(m) wd = CONFIG.weekdays.indexOf(m[0]); }
    if(wd==null || wd===0 || used.has(wd)) wd = i+1;
    used.add(wd);
    return wd;
  });
  const days = blocks.map((b, i)=>({ wd:dayWd[i], periods:Math.max(...b.map(x=>x.period)) }));
  const teachers = [];
  for(let r=h+2; r<rows.length; r++){
    const row = rows[r] || [];
    if(isTantoRow(row)) break;
    const s = i => row[i]==null ? '' : String(row[i]).replace(/\s*\n\s*/g,'・').trim();
    if(!s(0) && !s(1) && !s(2)) continue;
    const cells = {};
    blocks.forEach((b, i)=>b.forEach(x=>{
      let v = row[x.col];
      if(v==null || v==='') return;
      if(typeof v==='number') v = v>1000 ? excelSerialToMD(v) : String(v);
      const nv = normCell(v);
      if(nv) cells[dayWd[i]+'-'+x.period] = nv;
    }));
    teachers.push({ role:normCellKeepText(s(0)), subject:s(1), name:s(2), cells });
  }
  if(!teachers.length) throw new Error('先生の行が見つかりませんでした。');
  return { days, teachers, warnings };
}

ACTIONS.importXlsx = ()=>pickFile(importXlsxFile, '.xlsx');
// 選んだ Excel のファイルを読み込む(テストのときは、ここに File を直接渡して試せる)
async function importXlsxFile(file){
  let sheets;
  try{ sheets = await readXlsx(file); }
  catch(e){ alert('Excel のファイルを読めませんでした。\n'+e.message+'\n\n.xlsx の形式のファイルを選んでください(.xls のときは、Excel で開いて「.xlsx」で保存し直してください)。'); return; }
  const ok = sheets.filter(s=>s.rows.some(isTantoRow));
  if(!ok.length){ alert('「担当」と書いた見出しのある時間割のシートが見つかりませんでした。\n\n先生ごとの時間割(A列に「担当」、その右に曜日と時限が並ぶ形)のシートがあるか確かめてください。'); return; }
  let sheet = ok[0];
  if(ok.length>1){
    const list = ok.map((s,i)=>(i+1)+': '+s.name).join('\n');
    const ans = prompt('時間割のシートがいくつかあります。読み込むシートの番号を入れてください。\n(ふつうは、基本の時間割「正規」などのシート)\n\n'+list, '1');
    if(ans===null) return;
    sheet = ok[Number(String(ans).normalize('NFKC'))-1];
    if(!sheet){ alert('番号が正しくありません。もう一度やり直してください。'); return; }
  }
  let res;
  try{ res = parseTimetableRows(sheet.rows); }
  catch(e){ alert('シート「'+sheet.name+'」を読み取れませんでした。\n'+e.message); return; }
  const dayText = res.days.map(d=>CONFIG.weekdays[d.wd]+d.periods).join('・');
  const nCells = res.teachers.reduce((a,t)=>a+Object.keys(t.cells).length, 0);
  if(!confirm('シート「'+sheet.name+'」から、次の内容を読み込みます。\n\n先生: '+res.teachers.length+'人\n曜日と時限: '+dayText+'\n入力のあるマス: '+nCells+'\n\n今の「基本時間割」の「教員」(先生の一覧と時間割)は、すべて置き換わります。よろしいですか？')) return;
  pushUndo();
  state.meta.days = res.days.slice().sort((a,b)=>a.wd-b.wd);
  state.teachers = []; state.base = {};
  res.teachers.forEach(x=>{
    const t = { id:newId('t'), role:x.role, subject:subjectFromInput(x.subject), name:x.name };
    state.teachers.push(t); state.base[t.id] = x.cells;
    // 設定にない教科は、教科の一覧に足しておく
    if(t.subject && !state.subjects.some(s=>s.name===t.subject)) state.subjects.push({ name:t.subject, short:t.subject });
  });
  // 学級数を、時間割に出てくる学級に合わせる(Excel の時間割のほうを正しいとみなす)
  const maxNum = {};
  Object.values(state.base).forEach(row=>Object.values(row).forEach(v=>{ const c = parseCell(v); if(c.kind==='class') c.classes.forEach(id=>{ const [g,n] = id.split('-').map(Number); maxNum[g] = Math.max(maxNum[g]||0, n); }); }));
  state.teachers.forEach(t=>{ const hr = homeroomOf(t); if(hr){ const [g,n] = hr.split('-').map(Number); maxNum[g] = Math.max(maxNum[g]||0, n); } });
  const grew = [];
  state.meta.grades.forEach(g=>{ if(maxNum[g.grade] && maxNum[g.grade] !== g.classes){ grew.push(g.grade+'年を'+maxNum[g.grade]+'学級に'); g.classes = maxNum[g.grade]; } });
  markDirty(); renderAll();
  alert('読み込みました。'+(grew.length ? '\n(時間割に合わせて、学級数を '+grew.join('、')+'しました)' : '')+'\n\n「基本時間割」の「生徒」で、学級ごとの時間割と、確認が必要なところを見てください。');
}

//////////////////////// Excel に書き出す ////////////////////////
// 変換ツールと同じ形(担当・教科・教員・各コマ)で書き出す。下に学級ごとの時間割も付ける。
// このファイルは、このアプリの「Excel から読み込む」でそのまま読み込める(見本の Excel としても使える)。
ACTIONS.exportXlsx = ()=>{
  const slots = slotList(), tt = buildTimetable();
  const dayHead = slots.map(s=>s.dayFirst ? CONFIG.weekdays[s.wd] : null);
  const rows = [];
  rows.push(['担当','教科','教員', ...dayHead]);
  rows.push([null,null,null, ...slots.map(s=>s.p)]);
  state.teachers.forEach(t=>{ const row = state.base[t.id]||{}; rows.push([t.role, subjectShort(t.subject), t.name, ...slots.map(s=>row[s.key]||null)]); });
  rows.push(['担当','教科','教員', ...slots.map(s=>s.p)]);
  rows.push([]);
  rows.push([null,'学年','組', ...dayHead]);
  rows.push([null,null,null, ...slots.map(s=>s.p)]);
  let prevGrade = null;
  tt.classes.forEach(c=>{
    rows.push([null, c.grade!==prevGrade ? c.grade+'年' : null, c.num+'組', ...slots.map(s=>tt.byClass[c.id][s.key].text || null)]);
    prevGrade = c.grade;
  });
  const name = '時間割_' + state.meta.fiscalYear + '年度' + (isSample ? '_見本' : '') + '_' + todayYmd() + '.xlsx';
  downloadXlsx(name, [{ name:'基本時間割', rows, colWidths:[12,6,9, ...slots.map(()=>4.5)], headerRows:2 }]);
};
