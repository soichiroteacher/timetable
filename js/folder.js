'use strict';
// データのフォルダ・年度ごとのファイル・自動バックアップ
// (共通ルール ../CLAUDE.md「データファイルの置き方と自動バックアップ」。2026-11-21 にユーザーと決めた)
//
// - 最初に一度だけ「データのフォルダを選ぶ」でフォルダを選んでもらい、IndexedDB に覚える。
// - 起動したら、そのフォルダの「時間割_YYYY年度.json」(本体)のうち、名前の年度が一番新しいものを開く。
//   今の年度の本体がまだなければ、前の年度のものを開き、「○年度のファイルを作る」の案内を出す(ボタンのときだけ作る)。
// - 編集を始めるとき、その本体のその日のバックアップがまだなければ、「バックアップ」フォルダに1つ取る。
//   復元する前・新しい年度のファイルを作る前にも取る。アプリではバックアップを消さない。
// - 手で開いたファイル(バックアップ・古い年度・ほかの名前)は見るだけ。「この内容に戻す」で本体へ書き込む。

let dataDir = null;      // データのフォルダ
let mainHandle = null;   // 本体(いつものファイル)
let mainFy = 0;          // 本体の年度
let viewOnly = null;     // 手で開いたファイルを見ているとき { name, migrate:bool }。いつものファイルのときは null
let backupCount = null;  // 「バックアップ」フォルダの中の、このアプリのバックアップの数(設定の画面に出す)

const BACKUP_DIR = 'バックアップ';
function mainFileName(fy){ return CONFIG.appName+'_'+fy+'年度.json'; }
const MAIN_RE = new RegExp('^'+CONFIG.appName+'_(\\d{4})年度\\.json$');
function nowStamp(){ const d = new Date(); return todayYmd()+'_'+pad2(d.getHours())+pad2(d.getMinutes()); }
function backupFileName(fy){ return CONFIG.appName+'_'+fy+'年度_バックアップ_'+nowStamp()+'.json'; }

async function dirEntries(dir){ const out = []; for await (const [name, h] of dir.entries()) out.push({ name, h }); return out; }
// フォルダを読み書きする許可があるか。ask のときは、なければ聞く(ボタンを押したときだけ聞ける)
async function dirPermission(dir, ask, mode){
  const opts = { mode: mode || 'readwrite' };
  try{
    if(await dir.queryPermission(opts) === 'granted') return true;
    return ask ? (await dir.requestPermission(opts)) === 'granted' : false;
  }catch(e){ return false; }
}
// 名前が「アプリ名_YYYY年度.json」のファイルを、年度の新しい順に [{ fy, h }]
async function findYearFiles(dir, re){
  return (await dirEntries(dir)).filter(e=>e.h.kind==='file' && re.test(e.name))
    .map(e=>({ fy:Number(e.name.match(re)[1]), h:e.h, name:e.name })).sort((a,b)=>b.fy-a.fy);
}

//////////////////////// データのフォルダを選ぶ・開く ////////////////////////
async function chooseDataDir(){
  if(!supportsFSA){ alert('このブラウザでは、データのフォルダを使えません。Chrome か Edge で開いてください。'); return; }
  if(!(await confirmDiscard())) return;
  if(editing) await stopEditing();
  let d;
  try{ d = await window.showDirectoryPicker({ id:'timetable-data', mode:'readwrite', ...(dataDir?{startIn:dataDir}:{}) }); }
  catch(e){ if(e.name!=='AbortError') alert('フォルダを選べませんでした。\n'+e.message); return; }
  dataDir = d;
  try{ await idbSet('dataDir', d); }catch(e){}
  await openFromDir();
}
// 覚えているフォルダを開く(起動したとき・「いつものファイルに戻る」)
async function openFromDir(){
  try{
    const mains = await findYearFiles(dataDir, MAIN_RE);
    if(mains.length){ await openMain(mains[0].h, mains[0].fy); return; }
    // 決まった名前の本体がないとき(今までのファイル名で使っていた場合): フォルダの中の一番新しい時間割の .json を見るだけで開き、名前を付けて保存し直す案内を出す
    const files = [];
    for(const e of await dirEntries(dataDir)){
      if(e.h.kind!=='file' || !/\.json$/i.test(e.name) || /_バックアップ_/.test(e.name)) continue;
      files.push({ e, t:(await e.h.getFile()).lastModified });
    }
    files.sort((a,b)=>b.t-a.t);
    for(const f of files){
      let obj; try{ obj = (await readHandle(f.e.h)).obj; }catch(err){ continue; } // 時間割のファイルでないものは飛ばす
      mainHandle = null; mainFy = 0;
      openViewOnly(obj, f.e.name, true);
      return;
    }
    state = null; fileHandle = null; mainHandle = null; viewOnly = null; editing = false;
    renderAll();
    showBanner('フォルダ「'+esc(dataDir.name)+'」には、時間割のデータファイルがまだありません。はじめて使うときは「新規作成」を押してください。');
  }catch(e){
    state = null; renderAll();
    showBanner('データのフォルダ「'+esc(dataDir.name)+'」を開けませんでした(移動・削除されたか、共有サーバーにつながっていない可能性があります)。「データのフォルダを選ぶ」で選び直してください。<br><small>'+esc(e.message)+'</small>');
  }
}
async function openMain(h, fy){
  const { obj, modified } = await readHandle(h);
  state = obj; fileHandle = h; mainHandle = h; mainFy = fy; viewOnly = null;
  isSample = false; editing = false; dirty = false;
  lastKnownModified = modified;
  resetUndo();
  setStatus('');
  renderAll();
  refreshBackupCount();
}
function openViewOnly(obj, name, migrate){
  state = obj; fileHandle = null; viewOnly = { name, migrate:!!migrate };
  isSample = false; editing = false; dirty = false;
  resetUndo();
  setStatus('');
  renderAll();
}
function showBanner(html){ $('bnLast').hidden = false; $('bnLast').innerHTML = html; }

// 「ファイルを開く(見るだけ)」: バックアップ・古い年度などを見る。いつものファイルを選んだときは、いつもどおり開く
async function openFileViewOnly(){
  if(!supportsFSA){ alert('このブラウザでは、データファイルを開けません。Chrome か Edge で開いてください。'); return; }
  if(!(await confirmDiscard())) return;
  if(editing) await stopEditing();
  let h;
  try{ [h] = await window.showOpenFilePicker({ types:FILE_TYPES, ...(dataDir?{startIn:dataDir}:{}) }); }
  catch(e){ if(e.name!=='AbortError') alert('開けませんでした。\n'+e.message); return; }
  try{
    if(mainHandle && await h.isSameEntry(mainHandle)){ await openMain(mainHandle, mainFy); return; }
    const { obj } = await readHandle(h);
    openViewOnly(obj, h.name, false);
  }catch(e){ alert('開けませんでした。\n'+e.message+'\n\n時間割のデータファイル(.json)を選んでいるか確かめてください。'); }
}

//////////////////////// 自動バックアップ ////////////////////////
// 本体の今の中身(ファイルの文字そのまま)を「バックアップ」フォルダに控える。daily のときは、その日の分がもうあれば取らない
async function takeBackup(h, fy, daily){
  const dir = await dataDir.getDirectoryHandle(BACKUP_DIR, { create:true });
  const names = (await dirEntries(dir)).map(e=>e.name);
  if(daily){
    const head = CONFIG.appName+'_'+fy+'年度_バックアップ_'+todayYmd();
    if(names.some(n=>n.startsWith(head))) return false;
  }
  // 同じ分に2つ取るとき(復元してすぐ新年度を作るなど)に上書きしないよう、名前の後ろに番号を付ける
  let name = backupFileName(fy);
  for(let i=2; names.includes(name); i++) name = backupFileName(fy).replace(/\.json$/, '_'+i+'.json');
  const text = await (await h.getFile()).text();
  const w = await (await dir.getFileHandle(name, { create:true })).createWritable();
  await w.write(text); await w.close();
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
  if(!mainHandle){ alert('戻す先の「'+mainFileName(obj.meta.fiscalYear)+'」が、データのフォルダにありません。\n先に、上の案内のボタンで、この名前のファイルとして保存してください。'); return; }
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
// 今までのファイル名で使っていたファイルを、決まった名前の本体として保存し直す
async function saveAsMainName(){
  const fy = state.meta.fiscalYear, name = mainFileName(fy);
  try{
    if((await findYearFiles(dataDir, MAIN_RE)).some(x=>x.fy===fy)){ alert('「'+name+'」はもうあります。'); await openFromDir(); return; }
    if(!confirm('今見ている「'+viewOnly.name+'」の内容を、「'+name+'」という名前で、データのフォルダに保存します。\n次からは、このファイルが自動で開きます(元のファイルはそのまま残ります)。\n\nよろしいですか？')) return;
    const h = await dataDir.getFileHandle(name, { create:true });
    const w = await h.createWritable(); await w.write(stateToText(state)); await w.close();
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
    const w = await h.createWritable(); await w.write(stateToText(s)); await w.close();
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
      html += ' <button data-act="restoreViewed">この内容に戻す</button>' + (dataDir ? ' <button class="primary" data-act="backToMain">いつものファイルに戻る</button>' : '');
    }
  } else if(state && !isSample && mainHandle && mainFy < currentFiscalYear()){
    html = '今は '+currentFiscalYear()+'年度ですが、開いているのは '+mainFy+'年度のファイルです。 <button class="primary" data-act="createNextYear">'+currentFiscalYear()+'年度のファイルを作る</button>';
  }
  el.innerHTML = html; el.hidden = !html;
}
ACTIONS.saveAsMainName = ()=>saveAsMainName();
ACTIONS.restoreViewed = ()=>restoreToMain(state, viewOnly ? viewOnly.name : '');
ACTIONS.backToMain = ()=>openFromDir();
ACTIONS.createNextYear = ()=>createNextYear();
ACTIONS.chooseDataDir = ()=>chooseDataDir();
