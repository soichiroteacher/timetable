'use strict';
// データのフォルダ・年度ごとのファイル・自動バックアップ
// (共通ルール ../CLAUDE.md「データとバックアップ」「データファイルの置き方と自動バックアップ」。2026-11-21 にユーザーと決めた)
//
// - データは、アプリ(index.html)と同じフォルダの「時間割_YYYY年度.js」(本体)。中身は JSON に先頭の一言を付けた形(toDataJs)。
// - 見るだけの先生は、フォルダを選ばない。起動したら <script src> で来年度・今年度・前年度の本体を順に試し、一番新しい年度を開く。
//   (ブラウザは、直接開いたページから、そばの .json を自動では読めないが、<script src> なら読めるため)
// - 編集する先生だけ、一度「データのフォルダを選ぶ」でアプリのフォルダを選び、IndexedDB に覚える(書き込むには選んでもらった許可が要るため)。
//   フォルダからは、名前の年度が一番新しい本体を開く。今の年度の本体がまだなければ「○年度のファイルを作る」の案内を出す(ボタンのときだけ作る)。
// - 編集を始めるとき、その本体のその日のバックアップがまだなければ、「バックアップ」フォルダに1つ取る。
//   復元する前・新しい年度のファイルを作る前にも取る。アプリではバックアップを消さない。
// - 手で開いたファイル(バックアップ・古い年度・ほかの名前)は見るだけ。「この内容に戻す」で本体へ書き込む。

let dataDir = null;      // データのフォルダ(= アプリのフォルダ)
let mainHandle = null;   // 本体(いつものファイル)。フォルダから開いたときだけある
let mainFy = 0;          // 本体の年度
let viewOnly = null;     // 手で開いたファイルを見ているとき { name, migrate:bool }。いつものファイルのときは null
let fromScript = false;  // フォルダを選ばずに <script src> で本体を読んで表示しているか(編集するときにフォルダが要る)
let backupCount = null;  // 「バックアップ」フォルダの中の、このアプリのバックアップの数(設定の画面に出す)

const BACKUP_DIR = 'バックアップ';
function mainFileName(fy){ return CONFIG.appName+'_'+fy+'年度.js'; }
const MAIN_RE = new RegExp('^'+CONFIG.appName+'_(\\d{4})年度\\.js$');
function nowStamp(){ const d = new Date(); return todayYmd()+'_'+pad2(d.getHours())+pad2(d.getMinutes()); }
function backupFileName(fy){ return CONFIG.appName+'_'+fy+'年度_バックアップ_'+nowStamp()+'.js'; }

//////////////////////// .js のデータファイルの形 ////////////////////////
// 1行目 window.KOMU_DATA = window.KOMU_DATA || {};
// 2行目 window.KOMU_DATA["時間割_2026年度"] =
// 3行目から JSON、最後に ;
// キーはファイル名(拡張子なし)。何年度分・何アプリ分を読み込んでもぶつからないようにするため。
function dataKeyOf(fileName){ return String(fileName).replace(/\.(js|json|dat)$/i, ''); }
function toDataJs(obj, key){
  return 'window.KOMU_DATA = window.KOMU_DATA || {};\nwindow.KOMU_DATA['+JSON.stringify(key)+'] =\n'+JSON.stringify(obj, null, 2)+';\n';
}
// .js(上の形)と、以前の .json(JSON そのまま)の両方を、プログラムとして動かさずに文字として読む。
// キーの名前には頼らない(バックアップを本体の名前にコピーし直しても読めるように)
function parseDataText(text){
  const t = String(text).replace(/^﻿/, '').trim();
  if(t[0]==='{') return JSON.parse(t);
  const at = t.indexOf('window.KOMU_DATA[');
  const eq = at<0 ? -1 : t.indexOf('=', t.indexOf(']', at));
  const end = t.lastIndexOf('}');
  if(eq<0 || end<0) throw new Error('データのファイルの形ではありません。');
  return JSON.parse(t.slice(eq+1, end+1));
}
// <script src> で .js を読む(フォルダを選ばずに読める)。読めないときは null。
// キーの名前に頼らず、読む前になかったキーを探す。ブラウザに前の中身が残らないよう ?t=時刻 を付ける
function loadDataScript(src){
  return new Promise(res=>{
    window.KOMU_DATA = window.KOMU_DATA || {};
    const before = new Set(Object.keys(window.KOMU_DATA));
    const s = document.createElement('script');
    s.src = encodeURI(src) + '?t=' + Date.now();
    const done = v=>{ s.remove(); res(v); };
    s.onload = ()=>{
      const k = Object.keys(window.KOMU_DATA).find(x=>!before.has(x));
      const v = k ? window.KOMU_DATA[k] : null;
      if(k) delete window.KOMU_DATA[k]; // 次にもう一度読んだときも「新しいキー」として見つけられるように
      done(v);
    };
    s.onerror = ()=>done(null);
    document.head.appendChild(s);
  });
}
// 来年度・今年度・前年度の順に試し、読めた中で一番新しい年度の本体 { fy, obj, name }(フォルダの中の一覧はブラウザから見られないため)
async function loadLatestByScript(prefix, base){
  const fy = currentFiscalYear();
  for(const y of [fy+1, fy, fy-1]){
    const name = prefix+'_'+y+'年度.js';
    const obj = await loadDataScript((base||'')+name);
    if(obj) return { fy:y, obj, name };
  }
  return null;
}

//////////////////////// フォルダの道具 ////////////////////////
async function dirEntries(dir){ const out = []; for await (const [name, h] of dir.entries()) out.push({ name, h }); return out; }
// フォルダを読み書きする許可があるか。ask のときは、なければ聞く(ボタンを押したときだけ聞ける)
async function dirPermission(dir, ask, mode){
  const opts = { mode: mode || 'readwrite' };
  try{
    if(await dir.queryPermission(opts) === 'granted') return true;
    return ask ? (await dir.requestPermission(opts)) === 'granted' : false;
  }catch(e){ return false; }
}
// 名前が「アプリ名_YYYY年度.js」のファイルを、年度の新しい順に [{ fy, h, name }]
async function findYearFiles(dir, re){
  return (await dirEntries(dir)).filter(e=>e.h.kind==='file' && re.test(e.name))
    .map(e=>({ fy:Number(e.name.match(re)[1]), h:e.h, name:e.name })).sort((a,b)=>b.fy-a.fy);
}
async function writeText(h, text){ const w = await h.createWritable(); await w.write(text); await w.close(); }

//////////////////////// 起動したとき ////////////////////////
// 見るだけで開く: フォルダを選ばずに、<script src> で一番新しい年度の本体を読む
async function openByScript(){
  const r = await loadLatestByScript(CONFIG.appName);
  if(!r) return false;
  let obj; try{ obj = normalizeState(r.obj); }catch(e){ return false; }
  state = obj; fileHandle = null; mainHandle = null; mainFy = r.fy; viewOnly = null; fromScript = true;
  isSample = false; editing = false; dirty = false;
  resetUndo(); setStatus(''); renderAll();
  return true;
}
// 「編集する」を押したとき、フォルダから開いていなければ、フォルダを開く(許可を取り直す・はじめてなら選んでもらう)。開けたら true
async function ensureFolderForEdit(){
  if(fileHandle || isSample) return true;
  if(viewOnly) return false;
  if(!supportsFSA){ alert('このブラウザでは編集できません(データのファイルに保存できないため)。Chrome か Edge で開いてください。'); return false; }
  if(dataDir && await dirPermission(dataDir, true)){ await openFromDir(); return !!fileHandle; }
  alert('はじめて編集するときは、このアプリ(index.html)と同じフォルダを選んでください。\n次からは選ばなくても編集できます(パソコン・ブラウザごとに一度だけです)。');
  await chooseDataDir();
  return !!fileHandle;
}

//////////////////////// データのフォルダを選ぶ・開く ////////////////////////
async function chooseDataDir(){
  if(!supportsFSA){ alert('このブラウザでは、データのフォルダを使えません。Chrome か Edge で開いてください。'); return; }
  if(!(await confirmDiscard())) return;
  if(editing) await stopEditing();
  let d;
  try{ d = await window.showDirectoryPicker({ id:'timetable-data', mode:'readwrite', ...(dataDir?{startIn:dataDir}:{}) }); }
  catch(e){ if(e.name!=='AbortError') alert('フォルダを選べませんでした。\n'+e.message); return; }
  // アプリと同じフォルダか確かめる(本体は index.html と同じフォルダに置く決まり)
  const names = (await dirEntries(d)).map(e=>e.name);
  if(!names.includes('index.html') && !names.some(n=>MAIN_RE.test(n))){
    alert('選んだフォルダ「'+d.name+'」には、このアプリ(index.html)がありません。\nこのアプリ(時間割の index.html)と同じフォルダを選んでください。'); return;
  }
  dataDir = d;
  try{ await idbSet('dataDir', d); }catch(e){}
  await openFromDir();
}
// 覚えているフォルダを開く(フォルダを選んだとき・編集するとき・「いつものファイルに戻る」)
async function openFromDir(){
  try{
    const mains = await findYearFiles(dataDir, MAIN_RE);
    if(mains.length){ await openMain(mains[0].h, mains[0].fy); return; }
    // 決まった名前の本体がないとき(今までのファイル名・.json で使っていた場合): フォルダの中の一番新しい .json・.dat を見るだけで開き、名前を付けて保存し直す案内を出す
    const files = [];
    for(const e of await dirEntries(dataDir)){
      if(e.h.kind!=='file' || !/\.(json|dat)$/i.test(e.name) || /_バックアップ_/.test(e.name)) continue;
      files.push({ e, t:(await e.h.getFile()).lastModified });
    }
    files.sort((a,b)=>b.t-a.t);
    for(const f of files){
      let obj; try{ obj = (await readHandle(f.e.h)).obj; }catch(err){ continue; } // 時間割のファイルでないものは飛ばす
      mainHandle = null; mainFy = 0;
      openViewOnly(obj, f.e.name, true);
      return;
    }
    state = null; fileHandle = null; mainHandle = null; viewOnly = null; fromScript = false; editing = false;
    renderAll();
    showBanner('フォルダ「'+esc(dataDir.name)+'」には、時間割のデータファイルがまだありません。はじめて使うときは「新規作成」を押してください。');
  }catch(e){
    state = null; renderAll();
    showBanner('データのフォルダ「'+esc(dataDir.name)+'」を開けませんでした(移動・削除されたか、共有サーバーにつながっていない可能性があります)。「データのフォルダを選ぶ」で選び直してください。<br><small>'+esc(e.message)+'</small>');
  }
}
async function openMain(h, fy){
  const { obj, modified } = await readHandle(h);
  state = obj; fileHandle = h; mainHandle = h; mainFy = fy; viewOnly = null; fromScript = false;
  isSample = false; editing = false; dirty = false;
  lastKnownModified = modified;
  resetUndo();
  setStatus('');
  renderAll();
  refreshBackupCount();
}
function openViewOnly(obj, name, migrate){
  state = obj; fileHandle = null; viewOnly = { name, migrate:!!migrate }; fromScript = false;
  isSample = false; editing = false; dirty = false;
  resetUndo();
  setStatus('');
  renderAll();
}
function showBanner(html){ $('bnLast').hidden = false; $('bnLast').innerHTML = html; }

// 「ファイルを開く(見るだけ)」: バックアップ・古い年度などを見る。いつものファイルを選んだときは、いつもどおり開く
async function openFileViewOnly(){
  if(!(await confirmDiscard())) return;
  if(editing) await stopEditing();
  if(!supportsFSA){ pickFileText((text, name)=>{ try{ openViewOnly(normalizeState(parseDataText(text)), name, false); }catch(e){ alert('開けませんでした。\n'+e.message); } }); return; }
  let h;
  try{ [h] = await window.showOpenFilePicker({ types:FILE_TYPES, ...(dataDir?{startIn:dataDir}:{}) }); }
  catch(e){ if(e.name!=='AbortError') alert('開けませんでした。\n'+e.message); return; }
  try{
    if(mainHandle && await h.isSameEntry(mainHandle)){ await openMain(mainHandle, mainFy); return; }
    const { obj } = await readHandle(h);
    openViewOnly(obj, h.name, false);
  }catch(e){ alert('開けませんでした。\n'+e.message+'\n\n時間割のデータファイル(.js または以前の .json)を選んでいるか確かめてください。'); }
}

//////////////////////// 自動バックアップ ////////////////////////
// 本体の今の中身を「バックアップ」フォルダに控える(キーだけバックアップのファイル名にする)。daily のときは、その日の分がもうあれば取らない
async function takeBackup(h, fy, daily){
  const dir = await dataDir.getDirectoryHandle(BACKUP_DIR, { create:true });
  const names = (await dirEntries(dir)).map(e=>e.name);
  if(daily){
    const head = CONFIG.appName+'_'+fy+'年度_バックアップ_'+todayYmd();
    if(names.some(n=>n.startsWith(head))) return false;
  }
  // 同じ分に2つ取るとき(復元してすぐ新年度を作るなど)に上書きしないよう、名前の後ろに番号を付ける
  let name = backupFileName(fy);
  for(let i=2; names.includes(name); i++) name = backupFileName(fy).replace(/\.js$/, '_'+i+'.js');
  const obj = parseDataText(await (await h.getFile()).text());
  await writeText(await dir.getFileHandle(name, { create:true }), toDataJs(obj, dataKeyOf(name)));
  refreshBackupCount();
  return true;
}
async function refreshBackupCount(){
  if(!dataDir){ backupCount = null; return; }
  try{
    const dir = await dataDir.getDirectoryHandle(BACKUP_DIR);
    backupCount = (await dirEntries(dir)).filter(e=>e.name.startsWith(CONFIG.appName+'_') && /_バックアップ_/.test(e.name)).length;
  }catch(e){ backupCount = 0; } // まだ「バックアップ」フォルダがない
  if(state && view.tab==='settings' && !editing) renderAll();
}

//////////////////////// この内容に戻す(復元) ////////////////////////
// obj(見ているファイル・選んだバックアップ)の内容を、いつものファイル(本体)に書き込む。先に本体のバックアップを取る
async function restoreToMain(obj, name){
  if(!mainHandle){
    if(!dataDir || !(await dirPermission(dataDir, true))){ alert('戻すには、先にデータのフォルダ(このアプリと同じフォルダ)を選んでください。「設定」の「データのフォルダを選び直す」で選べます。'); return; }
    const m = (await findYearFiles(dataDir, MAIN_RE)).find(x=>x.fy===obj.meta.fiscalYear);
    if(!m){ alert('戻す先の「'+mainFileName(obj.meta.fiscalYear)+'」が、データのフォルダにありません。'); return; }
    mainHandle = m.h; mainFy = m.fy;
  }
  if(obj.meta.fiscalYear !== mainFy){ alert('「'+name+'」は '+obj.meta.fiscalYear+'年度のデータなので、'+mainFy+'年度のファイル「'+mainFileName(mainFy)+'」には戻せません。'); return; }
  if(editing){ if(!confirm('いったん「編集を終える」(保存)をしてから戻します。よろしいですか？')) return; await stopEditing(); if(editing) return; }
  let cur;
  try{ cur = await readHandle(mainHandle); }catch(e){ alert('いつものファイルを読めませんでした。共有サーバーにつながっているか確かめてください。\n'+e.message); return; }
  if(isLockFresh(cur.obj.editLock) && cur.obj.editLock.session !== SESSION_ID){
    alert('いま '+sensei(cur.obj.editLock.by)+'が編集中なので、戻せません。編集が終わってから、もう一度押してください。'); return;
  }
  if(!confirm('「'+name+'」の内容を、いつものファイル「'+mainFileName(mainFy)+'」に書き込みます。\n今のいつものファイルの内容は、「'+BACKUP_DIR+'」フォルダに控えてから置き換えます。\n\nよろしいですか？')) return;
  try{ await takeBackup(mainHandle, mainFy, false); }
  catch(e){ alert('バックアップを取れなかったので、戻すのをやめました。\n'+e.message); return; }
  const o = clone(obj);
  o.editLog = cur.obj.editLog;                                    // 編集の記録は、いつものファイルのものを残す
  o.editLock = { active:false, since:null, by:'', session:'' };
  state = o; fileHandle = mainHandle; lastKnownModified = cur.modified; viewOnly = null;
  try{ await writeFile({ force:true }); }
  catch(e){ alert('書き込めませんでした。\n'+e.message); }
  await openMain(mainHandle, mainFy);
  alert('戻しました。');
}

//////////////////////// 移し替え・新しい年度 ////////////////////////
// 今までのファイル名(.json など)で使っていたファイルを、決まった名前の本体(.js)として保存し直す
async function saveAsMainName(){
  const fy = state.meta.fiscalYear, name = mainFileName(fy);
  try{
    if((await findYearFiles(dataDir, MAIN_RE)).some(x=>x.fy===fy)){ alert('「'+name+'」はもうあります。'); await openFromDir(); return; }
    if(!confirm('今見ている「'+viewOnly.name+'」の内容を、「'+name+'」という名前で、データのフォルダに保存します。\n次からは、このファイルが自動で開きます(元のファイルはそのまま残ります)。\n\nよろしいですか？')) return;
    const h = await dataDir.getFileHandle(name, { create:true });
    await writeText(h, toDataJs(state, dataKeyOf(name)));
    await openMain(h, fy);
    alert('「'+name+'」として保存しました。');
  }catch(e){ alert('保存できませんでした。\n'+e.message); }
}
// 新しい年度のファイルを作る。学校・学級数・時限・変動枠・教科・先生・基本時間割を引き継ぎ、
// 行事予定・週ごとの変更・変動枠の案・編集の記録は引き継がない(年度ごとに変わるもののため。HANDOFF にも書いた)
async function createNextYear(){
  const fy = currentFiscalYear(), name = mainFileName(fy);
  if(!mainHandle || mainFy >= fy) return;
  if(!confirm(fy+'年度のファイル「'+name+'」を作ります。\n\n引き継ぐもの: 学校名・学級数・時限・変動枠・教科・先生・基本時間割\n引き継がないもの: 行事予定・週ごとの変更・変動枠の案・編集の記録\n\n'+mainFy+'年度のファイルはそのまま残ります。よろしいですか？')) return;
  if(editing){ await stopEditing(); if(editing) return; }
  try{
    if((await findYearFiles(dataDir, MAIN_RE)).some(x=>x.fy===fy)){ alert('「'+name+'」はもうあります。'); await openFromDir(); return; }
    await takeBackup(mainHandle, mainFy, false);
    const prev = (await readHandle(mainHandle)).obj;
    const s = emptyState(fy);
    ['schoolName','grades','days','flexSlots'].forEach(k=>{ s.meta[k] = clone(prev.meta[k]); });
    s.subjects = clone(prev.subjects); s.teachers = clone(prev.teachers); s.base = clone(prev.base);
    s.meta.savedAt = new Date().toISOString(); s.meta.savedBy = editorName();
    const h = await dataDir.getFileHandle(name, { create:true });
    await writeText(h, toDataJs(s, dataKeyOf(name)));
    await openMain(h, fy);
    alert(fy+'年度のファイルを作りました。先生や学級数が変わったときは、「編集する」を押して「設定」と「基本時間割」で直してください。\n行事予定は「週時間割」の「行事予定を読み込む」で読み込んでください。');
  }catch(e){ alert('作れませんでした。\n'+e.message); }
}

//////////////////////// 上の帯の下に出す案内 ////////////////////////
function renderFolderNotice(){
  const el = $('folderNotice');
  let html = '';
  if(state && viewOnly){
    html = '<b>見るだけで開いています(「'+esc(viewOnly.name)+'」)。</b>このファイルは直せません。';
    if(viewOnly.migrate){
      html += '<br>データのフォルダに「'+esc(mainFileName(state.meta.fiscalYear))+'」がありません。今見ているのは、フォルダの中で一番新しいファイルです。この名前で保存し直すと、次からは自動で開き、編集できます。'
        + ' <button class="primary" data-act="saveAsMainName">「'+esc(mainFileName(state.meta.fiscalYear))+'」として保存する</button>';
    } else {
      html += ' <button data-act="restoreViewed">この内容に戻す</button> <button class="primary" data-act="backToMain">いつものファイルに戻る</button>';
    }
  } else if(state && !isSample && mainHandle && mainFy < currentFiscalYear()){
    html = '今は '+currentFiscalYear()+'年度ですが、開いているのは '+mainFy+'年度のファイルです。 <button class="primary" data-act="createNextYear">'+currentFiscalYear()+'年度のファイルを作る</button>';
  }
  el.innerHTML = html; el.hidden = !html;
}
ACTIONS.saveAsMainName = ()=>saveAsMainName();
ACTIONS.restoreViewed = ()=>restoreToMain(state, viewOnly ? viewOnly.name : '');
// いつものファイルに戻る: フォルダを使える(許可がある)ならフォルダから、なければ <script src> で読み直す
ACTIONS.backToMain = async ()=>{
  if(dataDir && await dirPermission(dataDir, false)){ await openFromDir(); return; }
  if(!(await openByScript())){ state = null; viewOnly = null; renderAll(); }
};
ACTIONS.createNextYear = ()=>createNextYear();
ACTIONS.chooseDataDir = ()=>chooseDataDir();
