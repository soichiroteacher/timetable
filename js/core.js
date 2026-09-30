'use strict';
// 土台: 小さな道具・データの形・画面の描き直し・入力欄との結びつけ・ファイルの読み書き・編集する/編集を終える
// (保存と編集の仕組みは ../exam-manager(定期テスト)の core.js をもとにしている。直すときは両方を見比べるとよい)

//////////////////////// 状態 ////////////////////////
let state = null;          // 今開いているデータ(データファイルの中身そのもの)
let fileHandle = null;     // データファイル(保存先)
let editing = false;       // 編集中か
let dirty = false;         // 保存していない変更があるか
let isSample = false;      // 見本を表示中か(見本は保存しない)
let lastKnownModified = 0; // 最後に読み書きしたときのファイルの更新時刻(ほかの人の保存に気づくため)
let lastLockStamp = 0;     // 最後に「編集中」の印を保存した時刻
const supportsFSA = 'showOpenFilePicker' in window;

// 画面の見方の好み(人ごと。ブラウザに覚えておくだけで、データファイルには入れない)
const PREF_KEY = 'tt.view';
const view = loadPref(PREF_KEY, { tab:'base', baseMode:'teacher', classGrade:0 });
// 以前の画面の名前(教員の時間割・学級の時間割のタブ)を覚えていたときは、今の「基本時間割」タブに読み替える
if(view.tab==='teacher' || view.tab==='classes'){ view.baseMode = view.tab==='classes' ? 'class' : 'teacher'; view.tab = 'base'; }
function loadPref(key, def){
  try{ const v = JSON.parse(localStorage.getItem(key)); return (v && typeof v==='object') ? Object.assign({}, def, v) : def; }catch(e){ return def; }
}
function savePref(){ try{ localStorage.setItem(PREF_KEY, JSON.stringify(view)); }catch(e){} }

//////////////////////// 小さな道具 ////////////////////////
const $ = id => document.getElementById(id);
function esc(s){ return String(s==null?'':s).replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function pad2(n){ return String(n).padStart(2,'0'); }
function newId(prefix){ return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2,6); }
function clone(o){ return JSON.parse(JSON.stringify(o)); }
function todayYmd(){ const d = new Date(); return d.getFullYear()+'-'+pad2(d.getMonth()+1)+'-'+pad2(d.getDate()); }
function currentFiscalYear(){ const d = new Date(); return d.getMonth()>=3 ? d.getFullYear() : d.getFullYear()-1; }
// 名前に「先生」を付けて表示する(入力した名前にすでに付いているときはそのまま)
function sensei(name){ if(!name) return 'ほかの先生'; return /(先生|さん)$/.test(name) ? name : name+'先生'; }
const dis = () => editing ? '' : ' disabled';
const CIRCLED = '①②③④⑤⑥⑦⑧⑨⑩';

//////////////////////// データの形 ////////////////////////
// 形の説明は HANDOFF.md の「データの形」にもある。新しい項目を足したら normalizeState にも足すこと(古いファイルを読めるように)。
function emptyState(fy){
  return {
    formatVersion: FORMAT_VERSION,
    app: 'timetable',
    meta: {
      schoolName: '', fiscalYear: fy,
      grades: clone(CONFIG.defaultGrades),   // [{ grade:1, classes:3 }]
      days: clone(CONFIG.defaultDays),       // [{ wd:1(月), periods:6 }] 基本時間割の曜日と、その日の時限数
      // 変動枠: 学年一斉で、週ごとに教科を入れ替えるコマ [{ grade:1, key:'2-6' }](キーは「曜日-時限」)。中身は state.flex(自動の案)か state.changes(手で直したもの)
      flexSlots: [],
      editPasswordHash: '',
      savedAt: null, savedBy: '',
    },
    subjects: CONFIG.defaultSubjects.map(([name, short])=>({ name, short })),
    // 先生(教員の時間割の1行)。role は「1-1担」「教務主任」など(担任の学級は role の「1-1担」から読み取る)
    teachers: [],   // [{ id, role, subject, name }]
    // 基本時間割(教員ごと)。キーは「曜日-時限」(例 '1-3' = 月曜3時間目)、値はそのコマに書く文字
    // (学級 '1-2'、2学級合同 '3-12'、担任の行の '道徳' '総/学'、会議などの印 '企画' '×' など)
    base: {},       // { [teacherId]: { '1-3':'1-2', ... } }
    // 行事予定アプリから読み込んだ、日ごとの登校日・①〜⑥・行事(js/events.js の convertEventsFile)。読み込む前は null
    events: null,
    // 週ごとの変更(出張などの入れ替え)。{ 'YYYY-MM-DD': { '1-2': { 2:'数' } } } 日付・学級・時限(0〜5=①〜⑥)ごとに、マスに入力した文字(js/week.js)
    changes: {},
    // 変動枠の中身(自動で作った案)。{ 'YYYY-MM-DD': { '1-2': { 5:'英' } } } 形は changes と同じ。changes に同じマスがあれば、そちらが優先
    flex: {},
    editLock: { active:false, since:null, by:'' },
  };
}
function normalizeState(o){
  if(!o || typeof o!=='object' || o.app!=='timetable') throw new Error('時間割アプリのデータファイルではありません。');
  const s = emptyState(o.meta && o.meta.fiscalYear || currentFiscalYear());
  Object.assign(s.meta, o.meta || {});
  if(!Array.isArray(s.meta.grades) || !s.meta.grades.length) s.meta.grades = clone(CONFIG.defaultGrades);
  s.meta.grades = s.meta.grades.map(g=>({ grade:Number(g.grade)||1, classes:Math.max(0, Math.min(12, Number(g.classes)||0)) }));
  if(!Array.isArray(s.meta.days) || !s.meta.days.length) s.meta.days = clone(CONFIG.defaultDays);
  s.meta.days = s.meta.days.map(d=>({ wd:Number(d.wd), periods:Math.max(1, Math.min(10, Number(d.periods)||6)) })).filter(d=>d.wd>=0 && d.wd<=6);
  if(Array.isArray(o.subjects)) s.subjects = o.subjects.filter(x=>x && x.name).map(x=>({ name:String(x.name), short:String(x.short||x.name) }));
  if(Array.isArray(o.teachers)) s.teachers = o.teachers.filter(Boolean).map(t=>({ id:t.id||newId('t'), role:String(t.role||''), subject:String(t.subject||''), name:String(t.name||'') }));
  if(o.base && typeof o.base==='object') s.base = o.base;
  s.teachers.forEach(t=>{ if(!s.base[t.id] || typeof s.base[t.id]!=='object') s.base[t.id] = {}; });
  if(o.events && typeof o.events==='object' && o.events.days && typeof o.events.days==='object'){
    s.events = o.events;
    s.events.fiscalYear = Number(s.events.fiscalYear) || s.meta.fiscalYear;
    if(!s.events.classCounts) s.events.classCounts = {};
  }
  if(o.changes && typeof o.changes==='object') s.changes = o.changes;
  if(o.flex && typeof o.flex==='object') s.flex = o.flex;
  s.meta.flexSlots = (Array.isArray(s.meta.flexSlots) ? s.meta.flexSlots : []).filter(x=>x && x.grade && /^\d-\d+$/.test(x.key)).map(x=>({ grade:Number(x.grade), key:String(x.key) }));
  if(o.editLock) s.editLock = o.editLock;
  s.formatVersion = FORMAT_VERSION;
  return s;
}

//////////////////////// 入力欄とデータを結びつける ////////////////////////
// 入力欄に data-path="meta.schoolName" のように書いておくと、変えたときにデータへ書き込む。
// data-type="num" で数に、チェックボックスは true/false に。
function setPath(path, value){
  const parts = path.split('.');
  let o = state;
  for(let i=0;i<parts.length-1;i++){
    if(o[parts[i]]==null || typeof o[parts[i]]!=='object') o[parts[i]] = {};
    o = o[parts[i]];
  }
  o[parts[parts.length-1]] = value;
}
document.addEventListener('change', e=>{
  const el = e.target.closest('[data-path]');
  if(!el || !state) return;
  if(!editing){ renderAll(); return; }
  let v = el.type==='checkbox' ? el.checked : el.value;
  if(el.dataset.type==='num') v = el.value==='' ? 0 : Number(el.value);
  setPath(el.dataset.path, v);
  markDirty();
  setTimeout(renderAll, 0);
});

//////////////////////// 画面全体 ////////////////////////
const TABS = {};   // 各タブの描き方。TABS.teacher = { render(){…} } のように各ファイルで登録する
function renderAll(){
  // 描き直しの前に、いま入力中の欄を覚えておき、描き直したあとに戻す
  const f = document.activeElement;
  const focusKey = f && f !== document.body ? (f.dataset && (f.dataset.path || f.dataset.focus)) || (f.id ? '#'+f.id : '') : '';
  const has = !!state;
  $('startBanner').hidden = has;
  document.querySelectorAll('main > section').forEach(s=> s.hidden = !has || s.id !== 'tab-'+view.tab);
  document.querySelectorAll('nav.tabs button[data-tab]').forEach(b=> b.classList.toggle('active', b.dataset.tab===view.tab));
  renderTop();
  if(has && TABS[view.tab]) TABS[view.tab].render();
  if(focusKey){
    const el = focusKey[0]==='#' ? $(focusKey.slice(1)) : document.querySelector('[data-path="'+CSS.escape(focusKey)+'"],[data-focus="'+CSS.escape(focusKey)+'"]');
    if(el && el !== f && !el.disabled){ try{ el.focus({ preventScroll:true }); }catch(e){} }
  }
}
function renderTop(){
  const has = !!state;
  $('schoolTitle').textContent = has ? state.meta.fiscalYear + '年度' + (state.meta.schoolName ? '　' + state.meta.schoolName : '') + (isSample ? '　【見本・保存されません】' : '') : '';
  $('editBadge').textContent = editing ? '✏ 編集中' : '閲覧のみ';
  $('editBadge').classList.toggle('on', editing);
  $('btnEdit').textContent = editing ? '編集を終える' : '✏ 編集する';
  $('btnEdit').disabled = !has;
  $('btnReload').hidden = !fileHandle || editing;
  $('btnSave').disabled = !editing || isSample;
  $('fileName').textContent = fileHandle ? 'ファイル：' + fileHandle.name : '';
  document.querySelectorAll('.edit-only').forEach(el=> el.hidden = !editing);
  const w = $('lockWarning');
  if(has && !editing && isLockFresh(state.editLock)){
    const since = new Date(state.editLock.since);
    w.textContent = '⚠ ' + sensei(state.editLock.by) + 'が編集中(' + since.getHours() + ':' + pad2(since.getMinutes()) + '〜)';
    w.hidden = false;
  } else w.hidden = true;
}
function setStatus(text, cls){ const el = $('status'); el.textContent = text; el.className = cls||''; }
function closeOverlay(id){ $(id).classList.remove('show'); }
function openOverlay(id){ $(id).classList.add('show'); }

// ボタンに data-act="名前" と書いておくと、押したときに ACTIONS.名前(ボタン) を呼ぶ。
// edit-act は編集中のときだけ動く(閲覧中に押しても何もしない)。
const ACTIONS = {};
document.addEventListener('click', e=>{
  const el = e.target.closest('[data-act]');
  if(!el || el.disabled || !state) return;
  const fn = ACTIONS[el.dataset.act];
  if(!fn) return;
  if(el.classList.contains('edit-act') && !editing){ alert('直すときは、上の「✏ 編集する」を押してください。'); return; }
  fn(el, e);
});
// Excel から貼り付けた文字を、行と列に分ける(タブ区切り)
function parsePasted(text){
  return String(text||'').replace(/\r/g,'').split('\n').filter(l=>l.trim()).map(l=>l.split('\t').map(c=>c.trim().replace(/^"|"$/g,'')));
}

//////////////////////// 編集パスワード ////////////////////////
async function sha256Hex(text){
  if(!(window.crypto && crypto.subtle)) throw new Error('このブラウザではパスワードを使えません。Chrome か Edge で開いてください。');
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map(b=>b.toString(16).padStart(2,'0')).join('');
}

//////////////////////// バックアップと復元 ////////////////////////
function stateToText(o){ return JSON.stringify(o, null, 2); }
function downloadBlob(blob, name){
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(()=>URL.revokeObjectURL(url), 1000);
}
function downloadText(text, name){ downloadBlob(new Blob([text], {type:'application/json'}), name); }
function exportBackup(){
  if(!state || isSample) return;
  downloadText(stateToText(state), '時間割_バックアップ_'+todayYmd()+'.json');
}
function importBackup(){
  if(!editing || isSample) return;
  pickFileText(async (text, name)=>{
    let o;
    try{ o = normalizeState(JSON.parse(text)); }catch(e){ alert('読み込めませんでした。\n'+e.message+'\n\n「データを書き出す(バックアップ)」で作ったファイルを選んでください。'); return; }
    if(!confirm('「'+name+'」の内容で、今のデータを置き換えます。今のデータは消えます。よろしいですか？\n(不安なときは、先に「データを書き出す(バックアップ)」で今の状態を控えてください)')) return;
    o.editLock = state.editLock; // 編集中の印は今のものを引き継ぐ
    state = o;
    markDirty(); renderAll();
    alert('復元しました。');
  });
}
// Chrome/Edge 以外でも読み込みだけはできるように、input type=file で読む
function pickFileText(cb, accept){
  const inp = document.createElement('input');
  inp.type = 'file'; inp.accept = accept || '.json,application/json';
  inp.onchange = async ()=>{ const f = inp.files[0]; if(f) cb(await f.text(), f.name, f); };
  inp.click();
}
function pickFile(cb, accept){
  const inp = document.createElement('input');
  inp.type = 'file'; inp.accept = accept;
  inp.onchange = ()=>{ const f = inp.files[0]; if(f) cb(f); };
  inp.click();
}

//////////////////////// ファイルの読み書き ////////////////////////
// 前回開いたファイルを覚えておき、次に起動したときすぐ開けるようにする(IndexedDB にファイルの場所だけを保存する)。
function idb(){ return new Promise((res,rej)=>{ const r = indexedDB.open('timetable', 1); r.onupgradeneeded = ()=>r.result.createObjectStore('kv'); r.onsuccess = ()=>res(r.result); r.onerror = ()=>rej(r.error); }); }
async function idbSet(k,v){ const db = await idb(); return new Promise((res,rej)=>{ const tx = db.transaction('kv','readwrite'); tx.objectStore('kv').put(v,k); tx.oncomplete = res; tx.onerror = ()=>rej(tx.error); }); }
async function idbGet(k){ const db = await idb(); return new Promise((res,rej)=>{ const r = db.transaction('kv').objectStore('kv').get(k); r.onsuccess = ()=>res(r.result); r.onerror = ()=>rej(r.error); }); }

const lockStaleMs = () => CONFIG.lockStaleMinutes*60*1000;
function isLockFresh(lock){
  if(!lock || !lock.active || !lock.since) return false;
  const t = new Date(lock.since).getTime();
  return Number.isFinite(t) && Date.now()-t < lockStaleMs();
}
async function readHandle(handle){
  const f = await handle.getFile();
  return { obj: normalizeState(JSON.parse(await f.text())), modified: f.lastModified };
}
async function openHandle(handle){
  const { obj, modified } = await readHandle(handle);
  state = obj; fileHandle = handle; isSample = false; editing = false; dirty = false;
  lastKnownModified = modified;
  resetUndo();
  try{ await idbSet('lastFile', handle); }catch(e){}
  setStatus('');
  renderAll();
}
const FILE_TYPES = [{ description:'時間割のデータ', accept:{'application/json':['.json']} }];
async function doOpen(){
  if(!(await confirmDiscard())) return;
  if(editing) await stopEditing();
  if(!supportsFSA){ alert('このブラウザでは、データファイルを開いて保存することができません。Chrome か Edge で開いてください。'); return; }
  try{
    const startIn = await idbGet('lastFile').catch(()=>undefined);
    const [h] = await window.showOpenFilePicker({ types:FILE_TYPES, ...(startIn?{startIn}:{}) });
    await openHandle(h);
  }catch(e){ if(e.name!=='AbortError') alert('開けませんでした。\n'+e.message+'\n\n時間割のデータファイル(.json)を選んでいるか確かめてください。'); }
}
// ほかの人が保存したかもしれない内容を、書き込む前に確かめる
async function writeFile(opts){
  if(!fileHandle || isSample) return;
  const f = await fileHandle.getFile();
  if(lastKnownModified && f.lastModified !== lastKnownModified && !(opts && opts.force)){
    let other = null;
    try{ other = JSON.parse(await f.text()); }catch(e){}
    const by = other && other.meta && other.meta.savedBy;
    if(!confirm('このファイルは、あなたが開いたあとに'+(by ? sensei(by)+'が' : 'ほかの場所で')+'保存しています。\nこのまま保存すると、そちらの変更は消えてしまいます。\n\n保存しますか？(「キャンセル」を押すと保存しません。その場合は、入力した内容を紙などに控えてから、ページを開き直して入力し直してください)')){
      clearTimeout(autosaveTimer);
      setStatus('保存を中止しました(ほかの人の変更があるため)', 'dirty');
      return false;
    }
  }
  state.meta.savedAt = new Date().toISOString();
  state.meta.savedBy = editorName();
  const w = await fileHandle.createWritable();
  await w.write(stateToText(state));
  await w.close();
  lastKnownModified = (await fileHandle.getFile()).lastModified;
  dirty = false;
  const t = new Date();
  setStatus('保存しました('+t.getHours()+':'+pad2(t.getMinutes())+')', 'saved');
  return true;
}
function suggestedFileName(){ return '時間割_'+state.meta.fiscalYear+'年度.json'; }
async function doSaveAs(){
  if(!supportsFSA){ downloadText(stateToText(state), suggestedFileName()); dirty = false; return true; }
  try{
    const startIn = await idbGet('lastFile').catch(()=>undefined);
    const h = await window.showSaveFilePicker({ suggestedName: suggestedFileName(), types:FILE_TYPES, ...(startIn?{startIn}:{}) });
    fileHandle = h; lastKnownModified = 0;
    try{ await idbSet('lastFile', h); }catch(e){}
    await writeFile({force:true});
    renderTop();
    return true;
  }catch(e){ if(e.name!=='AbortError') alert('保存できませんでした。\n'+e.message); return false; }
}
async function doSave(){
  if(!editing || isSample) return;
  clearTimeout(autosaveTimer);
  try{ if(fileHandle) await writeFile(); else await doSaveAs(); }
  catch(e){ setStatus('保存できませんでした', 'dirty'); alert('保存できませんでした。\n'+e.message+'\n\n共有サーバーにつながっているか確かめてから、もう一度「保存」を押してください。'); }
}
let autosaveTimer = null;
function markDirty(){
  if(!editing) return;
  dirty = true;
  if(isSample){ setStatus('見本のため保存されません', 'dirty'); return; }
  setStatus(fileHandle ? '保存待ち…' : '未保存(「保存」を押して保存先を決めてください)', 'dirty');
  // 先生の名前が入るので、ブラウザ(localStorage)には控えを残さない(共有のパソコンで他人に見られないように)
  if(!fileHandle) return;
  clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(async ()=>{
    try{ await writeFile(); lastLockStamp = Date.now(); }
    catch(e){ setStatus('自動保存できませんでした。共有サーバーにつながっているか確かめて「保存」を押してください', 'dirty'); }
  }, CONFIG.autosaveDelayMs);
}
async function confirmDiscard(){
  if(!dirty || !editing) return true;
  if(isSample) return confirm('見本で入力した内容は消えます。よろしいですか？');
  return confirm('まだ保存していない変更があります。保存せずに進むと、変更は消えます。よろしいですか？');
}
function editorName(){ try{ return localStorage.getItem('tt.editorName') || ''; }catch(e){ return ''; } }

//////////////////////// 元に戻す(Ctrl+Z) ////////////////////////
// 時間割の表の入力(教員の時間割・週ごとの変更)だけを戻せるようにする(設定の変更は対象外)。ページを開いている間だけ有効。
let undoStack = [], redoStack = [];
function snapshot(){ return JSON.stringify({ teachers:state.teachers, base:state.base, changes:state.changes, flex:state.flex }); }
function pushUndo(){ undoStack.push(snapshot()); if(undoStack.length>50) undoStack.shift(); redoStack = []; }
function restoreSnap(s){ const o = JSON.parse(s); state.teachers = o.teachers; state.base = o.base; state.changes = o.changes || {}; state.flex = o.flex || {}; }
function doUndo(){ if(!editing || !undoStack.length) return; redoStack.push(snapshot()); restoreSnap(undoStack.pop()); markDirty(); renderAll(); }
function doRedo(){ if(!editing || !redoStack.length) return; undoStack.push(snapshot()); restoreSnap(redoStack.pop()); markDirty(); renderAll(); }
function resetUndo(){ undoStack = []; redoStack = []; }

//////////////////////// 編集する / 編集を終える ////////////////////////
function openEditDialog(){
  $('eName').value = editorName();
  $('ePw').value = '';
  $('ePwRow').hidden = !state.meta.editPasswordHash;
  $('eErr').textContent = '';
  openOverlay('editOverlay');
  setTimeout(()=> ($('eName').value ? (state.meta.editPasswordHash ? $('ePw') : $('eOk')) : $('eName')).focus(), 30);
}
async function startEditing(){
  const name = $('eName').value.trim();
  if(!name){ $('eErr').textContent = 'お名前を入れてください。'; return; }
  try{ localStorage.setItem('tt.editorName', name); }catch(e){}
  // ほかの先生が保存した最新の内容から編集を始める(古い画面のまま編集して、相手の変更を消してしまわないように)
  if(fileHandle && !isSample){
    try{
      const { obj, modified } = await readHandle(fileHandle);
      state = obj; lastKnownModified = modified;
    }catch(e){ $('eErr').textContent = 'データファイルを読み直せませんでした。共有サーバーにつながっているか確かめてください。('+e.message+')'; return; }
  }
  if(state.meta.editPasswordHash){
    let h; try{ h = await sha256Hex($('ePw').value); }catch(e){ $('eErr').textContent = e.message; return; }
    if(h !== state.meta.editPasswordHash){ $('eErr').textContent = 'パスワードが違います。'; renderAll(); return; }
  }
  if(isLockFresh(state.editLock) && state.editLock.by !== name){
    if(!confirm('⚠ いま '+sensei(state.editLock.by)+'が編集中です。\n\n同時に編集すると、どちらかの入力が消えてしまいます。\nふつうは、相手が「編集を終える」まで待ってください。\n\nそれでも編集を始めますか？(相手がブラウザを閉じ忘れている場合など)')){ closeOverlay('editOverlay'); renderAll(); return; }
  }
  editing = true;
  resetUndo();
  state.editLock = { active:true, since:new Date().toISOString(), by:name };
  closeOverlay('editOverlay');
  renderAll();
  if(fileHandle && !isSample){
    try{ await writeFile({force:true}); lastLockStamp = Date.now(); }
    catch(e){ setStatus('保存できませんでした', 'dirty'); alert('データファイルに書き込めませんでした。\n'+e.message+'\n\n共有サーバーのフォルダに書き込む権限があるか確かめてください。'); }
  } else if(!isSample){
    setStatus('まだ保存していません。「保存」を押して保存先を決めてください', 'dirty');
  }
}
async function stopEditing(){
  clearTimeout(autosaveTimer);
  state.editLock = { active:false, since:null, by:'' };
  if(fileHandle && !isSample){
    try{ const ok = await writeFile(); if(ok===false) return; }
    catch(e){ alert('保存できませんでした。\n'+e.message+'\n\n共有サーバーにつながっているか確かめてから、もう一度「編集を終える」を押してください。'); state.editLock = { active:true, since:new Date().toISOString(), by:editorName() }; return; }
  } else if(!isSample && dirty){
    if(!confirm('まだ保存していません。保存せずに編集を終えると、入力した内容は消えます。\n(「キャンセル」を押してから「保存」を押してください)\n\n保存せずに終えますか？')) { state.editLock.active = true; return; }
  }
  editing = false; dirty = false;
  renderAll();
}
$('btnEdit').addEventListener('click', ()=>{ if(!state) return; editing ? stopEditing() : openEditDialog(); });
$('eOk').addEventListener('click', startEditing);
$('eCancel').addEventListener('click', ()=>closeOverlay('editOverlay'));
['eName','ePw'].forEach(id=> $(id).addEventListener('keydown', e=>{ if(e.key==='Enter') startEditing(); }));
$('btnSave').addEventListener('click', doSave);
$('btnOpen').addEventListener('click', doOpen);
$('bnOpen').addEventListener('click', doOpen);
$('btnReload').addEventListener('click', async ()=>{
  if(!fileHandle || editing) return;
  try{ await openHandle(fileHandle); setStatus('最新の内容を読み込みました', 'saved'); }
  catch(e){ alert('読み直せませんでした。\n'+e.message); }
});
// 編集中は、入力がなくても定期的に「編集中」の印を保存し直す(ほかの先生に編集中だと伝わり続けるように)
setInterval(async ()=>{
  if(!editing || !fileHandle || isSample) return;
  if(Date.now() - lastLockStamp < CONFIG.heartbeatMinutes*60*1000) return;
  state.editLock.since = new Date().toISOString();
  try{ if(await writeFile() !== false) lastLockStamp = Date.now(); }catch(e){ setStatus('共有サーバーに書き込めません', 'dirty'); }
}, 60*1000);
// 閲覧中は、ほかの先生の「編集中」の表示が古くなったら消えるように、ときどき上の帯を描き直す
setInterval(()=>{ if(state && !editing) renderTop(); }, 60*1000);
window.addEventListener('beforeunload', e=>{
  if(editing && (dirty || !isSample)){ e.preventDefault(); e.returnValue = ''; }
});

//////////////////////// 新規作成 ////////////////////////
function openNewDialog(){
  $('nYear').value = currentFiscalYear(); $('nSchool').value = ''; $('nErr').textContent = '';
  openOverlay('newOverlay');
  setTimeout(()=>$('nSchool').focus(), 30);
}
$('btnNew').addEventListener('click', async ()=>{ if(!(await confirmDiscard())) return; openNewDialog(); });
$('bnNew').addEventListener('click', openNewDialog);
$('nCancel').addEventListener('click', ()=>closeOverlay('newOverlay'));
$('nOk').addEventListener('click', async ()=>{
  const y = Number($('nYear').value);
  if(!(y>=2000 && y<=2100)){ $('nErr').textContent = '年度は西暦の数字(例：2026)で入れてください。'; return; }
  if(editing && fileHandle && !isSample) await stopEditing();
  const prev = { state, fileHandle, isSample, editing, dirty };
  state = emptyState(y);
  state.meta.schoolName = $('nSchool').value.trim();
  fileHandle = null; isSample = false; editing = true; dirty = false;
  resetUndo();
  state.editLock = { active:true, since:new Date().toISOString(), by:editorName() };
  closeOverlay('newOverlay');
  const ok = await doSaveAs();
  if(!ok){ ({ state, fileHandle, isSample, editing, dirty } = prev); renderAll(); return; } // 保存先を選ばなかったときは元に戻す
  lastLockStamp = Date.now();
  view.tab = 'settings'; savePref();
  renderAll();
  alert('作りました。はじめに「設定」で学級数・時限数と先生を入れてください。\n今お使いの時間割の Excel があれば、「基本時間割」の「教員」タブの「Excel から読み込む」で先生と時間割をまとめて取り込めます。');
});
