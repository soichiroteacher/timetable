'use strict';
// 時間割の読み取りと組み立て:
//   教員の時間割(state.base:先生ごと・コマごとの文字)から、学級ごとの時間割を作り、確認が必要なところを見つける。
// マスの文字の読み方は、同じフォルダの timetable_converter.html(変換ツール)の transformTimetable と同じ決まりにしてある。

//////////////////////// 曜日・時限・学級の一覧 ////////////////////////
function dayList(){ return state.meta.days.filter(d=>d.periods>0).slice().sort((a,b)=>a.wd-b.wd); }
// すべてのコマ [{ wd, p, key:'1-3', dayFirst:その曜日の1時間目か }]
function slotList(){
  const out = [];
  dayList().forEach(d=>{ for(let p=1; p<=d.periods; p++) out.push({ wd:d.wd, p, key:d.wd+'-'+p, dayFirst:p===1 }); });
  return out;
}
function slotLabel(key){ const [wd,p] = key.split('-').map(Number); return CONFIG.weekdays[wd]+'曜'+p+'時間目'; }
// 学級 [{ id:'1-2', grade:1, num:2, label:'1年2組' }]
function classList(){
  const out = [];
  state.meta.grades.forEach(g=>{ for(let n=1; n<=g.classes; n++) out.push({ id:g.grade+'-'+n, grade:g.grade, num:n, label:g.grade+'年'+n+'組' }); });
  return out;
}
function classExists(id){ return classList().some(c=>c.id===id); }
// 変動枠(学年一斉で、週ごとに教科を入れ替えるコマ)か。設定の「変動枠」で決める
function isFlexSlot(grade, key){ return (state.meta.flexSlots||[]).some(x=>x.grade===grade && x.key===key); }
function subjectShort(name){ const s = state.subjects.find(x=>x.name===name); return s ? s.short : name; }
function teacherLabel(t){ return t.name || t.role || '(名前なし)'; }

//////////////////////// マスの文字を読む ////////////////////////
// 全角・半角のゆれや、「１－２」「1ー2」のような書き方を「1-2」にそろえる
function normCell(v){
  if(v==null) return '';
  return String(v).normalize('NFKC').replace(/[\s　]/g,'').replace(/[ー－―‐−]/g,'-');
}
// マスの文字の意味を調べる。
//   { kind:'empty' } 空欄
//   { kind:'class', classes:['1-2'] } 学級の授業(「3-12」は3年1組と3年2組の合同)
//   { kind:'homeroom', subject:'道徳' } 担任の学級の道徳・学活・総合
//   { kind:'duty', text } 会議や空き時間の印など、学級の授業ではないもの
function parseCell(v){
  const s = normCell(v);
  if(!s) return { kind:'empty' };
  if(CONFIG.homeroomSubjects[s]) return { kind:'homeroom', subject:CONFIG.homeroomSubjects[s] };
  const m = s.match(/^(\d{1,2})-(\d{1,3})$/);
  if(!m) return { kind:'duty', text:s };
  const g = Number(m[1]);
  // 「3-12」は、ふつうは3年1組と2組の合同(変換ツールと同じ読み方)。ただし、その学年が10学級以上あるときは3年12組と読む
  if(m[2].length>=2){
    const gr = state && state.meta.grades.find(x=>x.grade===g);
    const many = gr && gr.classes>=10 && Number(m[2])<=gr.classes;
    if(!many) return { kind:'class', classes:[...m[2]].map(n=>g+'-'+n) };
  }
  return { kind:'class', classes:[g+'-'+Number(m[2])] };
}
// 先生の担任の学級(担当の欄の「1-2担」から読み取る)。担任でなければ ''
function homeroomOf(t){
  const m = normCell(t.role).match(/(\d{1,2})-(\d{1,2})担/);
  return m ? Number(m[1])+'-'+Number(m[2]) : '';
}

//////////////////////// 学級の時間割を組み立てる ////////////////////////
// 戻り値:
//   byClass[classId][slotKey] = { entries:[{ teacherId, subject }], text:表示する教科, conflict:bool }
//   issues = [{ level:'err'|'warn', text, teacherId?, slotKey?, classId? }]  確認が必要なところ
//   cellFlags[teacherId][slotKey] = 'err'|'warn'  教員の時間割で色を付けるマス
function buildTimetable(){
  const classes = classList(), slots = slotList();
  const slotKeys = new Set(slots.map(s=>s.key));
  const byClass = {};
  classes.forEach(c=>{ byClass[c.id] = {}; slots.forEach(s=> byClass[c.id][s.key] = { entries:[], text:'', conflict:false }); });
  const issues = [], cellFlags = {};
  const flag = (tid, key, level)=>{ (cellFlags[tid] = cellFlags[tid] || {}); if(cellFlags[tid][key]!=='err') cellFlags[tid][key] = level; };

  state.teachers.forEach(t=>{
    const row = state.base[t.id] || {};
    const hr = homeroomOf(t);
    Object.keys(row).forEach(key=>{
      const cell = parseCell(row[key]);
      if(cell.kind==='empty' || cell.kind==='duty') return;
      if(!slotKeys.has(key)){ return; } // 設定で時限を減らしたときに残っている入力(表には出ない)
      let targets, subject;
      if(cell.kind==='homeroom'){
        // 担任でない先生(副担任など)の「道徳」「総/学」は、その時間に学年の活動に入るという先生の予定。
        // 学級の授業としては数えない(変換ツールと同じ決まり)
        if(!hr) return;
        targets = [hr]; subject = cell.subject;
      } else {
        targets = cell.classes; subject = t.subject || '(教科なし)';
      }
      targets.forEach(cid=>{
        if(!byClass[cid]){
          issues.push({ level:'warn', text:teacherLabel(t)+'の'+slotLabel(key)+'「'+row[key]+'」: '+cid.replace('-','年')+'組は、設定の学級数にありません。', teacherId:t.id, slotKey:key });
          flag(t.id, key, 'warn'); return;
        }
        // 変動枠のコマは週ごとに中身を決めるので、基本時間割の入力は学級の時間割に入れない
        if(isFlexSlot(Number(cid.split('-')[0]), key)){
          issues.push({ level:'warn', text:teacherLabel(t)+'の'+slotLabel(key)+'「'+row[key]+'」: '+cid.replace('-','年')+'組のこの時間は変動枠なので、学級の時間割には入れていません。', teacherId:t.id, slotKey:key });
          flag(t.id, key, 'warn'); return;
        }
        byClass[cid][key].entries.push({ teacherId:t.id, subject });
      });
    });
  });

  // 1つのコマに違う教科が入っていないか(技術と家庭など、決まった組み合わせはよい)
  classes.forEach(c=>{
    slots.forEach(s=>{
      const cell = byClass[c.id][s.key];
      if(isFlexSlot(c.grade, s.key)){ cell.flex = true; cell.text = '変動'; return; }
      const subs =[...new Set(cell.entries.map(e=>e.subject))];
      if(subs.length<=1){ cell.text = subs.length ? subjectShort(subs[0]) : ''; return; }
      const merged = subs.length===2 && (CONFIG.mergeSubjects[subs[0]+'|'+subs[1]] || CONFIG.mergeSubjects[subs[1]+'|'+subs[0]]);
      if(merged){ cell.text = merged; return; }
      cell.text = subs.map(subjectShort).join('/');
      cell.conflict = true;
      const who = cell.entries.map(e=>{ const t = state.teachers.find(x=>x.id===e.teacherId); return teacherLabel(t)+'('+e.subject+')'; }).join('・');
      issues.push({ level:'err', text:c.label+'の'+slotLabel(s.key)+'に、ちがう教科が重なっています: '+who, classId:c.id, slotKey:s.key });
      cell.entries.forEach(e=>flag(e.teacherId, s.key, 'err'));
    });
  });

  // 空いているコマ(ほかの学級には授業があるのに、この学級だけ何も入っていない)
  const empties = [];
  slots.forEach(s=>{
    const any = classes.some(c=>byClass[c.id][s.key].entries.length);
    if(!any) return;
    classes.forEach(c=>{ if(byClass[c.id][s.key].flex) return; if(!byClass[c.id][s.key].entries.length){ byClass[c.id][s.key].empty = true; empties.push(c.label+' '+slotLabel(s.key)); } });
  });
  if(empties.length) issues.push({ level:'warn', text:'授業の入っていないコマが '+empties.length+' か所あります(ほかの学級には授業がある時間): '+empties.slice(0,12).join('、')+(empties.length>12?' …ほか':'') });

  return { classes, slots, byClass, issues, cellFlags };
}

// 学級ごと・教科ごとの1週間のコマ数 { [classId]: { [教科]: 数 } }。技術と家庭が同じコマのときは、それぞれ 0.5 と数える。
function weeklyCounts(tt){
  const out = {};
  tt.classes.forEach(c=>{
    const cnt = {};
    tt.slots.forEach(s=>{
      const subs = [...new Set(tt.byClass[c.id][s.key].entries.map(e=>e.subject))];
      subs.forEach(sub=>{ cnt[sub] = (cnt[sub]||0) + 1/subs.length; });
    });
    out[c.id] = cnt;
  });
  return out;
}
// 先生ごとの1週間の授業のコマ数(学級の授業と、担任の道徳・学活・総合)
function teacherLoad(t){
  const row = state.base[t.id] || {};
  const keys = new Set(slotList().map(s=>s.key));
  return Object.keys(row).filter(k=>keys.has(k)).filter(k=>{ const c = parseCell(row[k]); return c.kind==='class' || (c.kind==='homeroom' && homeroomOf(t)); }).length;
}

// 教科の欄に入力された文字を、設定の教科名にそろえる(「英」「英語」→外国語、「保体」→保健体育 など)。
// 設定の教科の名前・短い名前と、よくある書き方を見る。どれにも当たらなければ入力のまま。
const SUBJECT_ALIASES = {
  '英語':'外国語', '外':'外国語', '保':'保健体育', '体育':'保健体育', '保健':'保健体育',
  '技術・家庭':'技術', '技家':'技術', '特活':'特別活動', '学級活動':'特別活動', '学活':'特別活動',
  '総合的な学習の時間':'総合', '特別の教科道徳':'道徳',
};
function subjectFromInput(v){
  const s = String(v==null?'':v).normalize('NFKC').trim();
  if(!s) return '';
  const hit = state.subjects.find(x=>x.name===s) || state.subjects.find(x=>x.short===s);
  if(hit) return hit.name;
  const a = SUBJECT_ALIASES[s];
  if(a && state.subjects.some(x=>x.name===a)) return a;
  return s;
}
