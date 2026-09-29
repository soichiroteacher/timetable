'use strict';
// 「週の時間割」タブ: 行事予定(state.events)の①〜⑥と、基本時間割(教員の時間割)から、選んだ週の時間割を作る。
//
// 行事予定の①〜⑥の読み方(行事予定アプリの実績タブと同じ):
//   「1」〜「6」 … 基本時間割の、同じ曜日の何時間目の授業をするか(例: 月曜の③に「2」→ 月曜2時間目の授業)
//   「道」「総」「学」 … その学級の道徳・総合・学活(担任の先生が受け持つ)
//   「音」 … 音楽(学年での合唱練習など。受け持つ先生は決めない)
//   「●」 … 授業はあるが、どの教科かは決まっていない
//   「行」 … 行事 / 「欠」「弁」・空欄 … 授業なし
// 登校日なのに①〜⑥がすべて空欄の日も、授業なしとして扱う(2026-09-30 ユーザーの判断。行事予定アプリの実績タブと同じ)。お知らせだけ出す。
// 基本時間割にない時間の番号(土曜の「1」、5時限の金曜の「6」など)は、マスを空けて警告を出す(2026-09-30 ユーザーの判断)。

const WEEK_PERIODS = 6;   // 行事予定アプリの①〜⑥に合わせる
const EVENT_CODE_SUBJECT = { '道':'道徳', '総':'総合', '学':'特別活動', '音':'音楽' };

// その週の日(月〜金は必ず出す。土・日は、どれかの学年が登校日のときだけ出す)
function weekDates(monday){
  const out = [];
  for(let i=0; i<7; i++){
    const k = addDays(monday, i), wd = keyToDate(k).getDay();
    const ev = state.events && state.events.days[k];
    const school = !!(ev && ev.school && Object.values(ev.school).some(Boolean));
    if(wd>=1 && wd<=5 || school) out.push({ key:k, wd, ev, school });
  }
  return out;
}

// 週の時間割を組み立てる。
// 戻り値:
//   dates: weekDates の結果
//   byClass[classId][dateKey][p] = { text, title, cls, subject, teacherIds, origin }  (p は 0〜5)
//   byTeacher[teacherId][dateKey][p] = { text, title, cls }
//   issues = [{ level, text }]
function buildWeek(monday){
  subjectTeacherCache = null;   // 基本時間割が変わっているかもしれないので、毎回作り直す
  const tt = buildTimetable();
  const dates = weekDates(monday);
  const slotKeys = new Set(tt.slots.map(s=>s.key));
  const hrTeacher = {};   // 学級 → 担任の先生
  state.teachers.forEach(t=>{ const h = homeroomOf(t); if(h && !hrTeacher[h]) hrTeacher[h] = t.id; });
  const tname = id=>{ const t = state.teachers.find(x=>x.id===id); return t ? teacherLabel(t) : ''; };
  const issues = [], guessed = [], changed = [], badSlots = {};
  const byClass = {}, tAt = {};   // tAt[teacherId][dateKey][p] = [{ cid, origin, subject }]
  const put = (tid, k, p, x)=>{ ((tAt[tid] = tAt[tid] || {})[k] = tAt[tid][k] || [])[p] = (tAt[tid][k][p] || []).concat([x]); };

  tt.classes.forEach(c=>{
    byClass[c.id] = {};
    dates.forEach(d=>{
      const row = byClass[c.id][d.key] = [];
      const ev = d.ev;
      if(!ev || !ev.school || !ev.school[c.grade]){
        for(let p=0; p<WEEK_PERIODS; p++) row.push({ text:'', cls:'w-off', title:(ev && (ev.hol || ev.text)) || '休み' });
        return;
      }
      const codes = (ev.periods && ev.periods[c.grade]) || [];
      const blank = codes.every(x=>!x);
      if(blank && !guessed.includes(d.key)) guessed.push(d.key);
      for(let p=0; p<WEEK_PERIODS; p++){
        const puts = [];   // この授業を受け持つ先生(変更があれば変更のほうを使う)
        let code = codes[p] || '';
        const cell = { text:'', title:'', cls:'', teacherIds:[], subs:[], kind:'none' };   // subs: 時数に数える教科、kind: lesson|tbd(教科未定)|event(行事)|none
        if(/^[1-9]$/.test(code)){
          const sk = d.wd+'-'+code;
          if(!slotKeys.has(sk)){
            cell.cls += ' g-warn';   // 基本時間割にない時間(土曜授業など)は空けておき、警告を出す
            cell.title = '行事予定の「'+code+'」: '+CONFIG.weekdays[d.wd]+'曜'+code+'時間目は、基本時間割にありません。';
            // 同じ日の分はまとめて1つの警告にする(土曜授業などでは全学級に出るため)
            const b = badSlots[d.key] = badSlots[d.key] || { wd:d.wd, codes:new Set(), classes:[] };
            b.codes.add(code); if(!b.classes.includes(c.label)) b.classes.push(c.label);
          } else {
            const b = tt.byClass[c.id][sk];
            cell.text = b.text; cell.origin = sk;
            cell.subs = [...new Set(b.entries.map(e=>e.subject))]; if(cell.subs.length) cell.kind = 'lesson';
            cell.teacherIds = [...new Set(b.entries.map(e=>e.teacherId))];
            cell.title = (code!==String(p+1) ? '基本の'+CONFIG.weekdays[d.wd]+'曜'+code+'時間目の授業\n' : '') + cell.teacherIds.map(tname).join('・');
            if(b.conflict) cell.cls += ' g-err';
            if(code!==String(p+1)) cell.cls += ' w-moved';
            b.entries.forEach(e=>puts.push([e.teacherId, { cid:c.id, origin:sk, subject:e.subject }]));
          }
        } else if(EVENT_CODE_SUBJECT[code]){
          const sub = EVENT_CODE_SUBJECT[code];
          cell.text = subjectShort(sub); cell.cls += ' k-hr w-moved';
          cell.subs = [sub]; cell.kind = 'lesson';
          if(code!=='音' && hrTeacher[c.id]){
            cell.teacherIds = [hrTeacher[c.id]];
            puts.push([hrTeacher[c.id], { cid:c.id, origin:'hr:'+c.id, subject:sub }]);
          }
          cell.title = sub + (cell.teacherIds.length ? '\n'+tname(cell.teacherIds[0]) : '');
        } else if(code==='●'){
          cell.text = '●'; cell.title = '授業(教科はまだ決まっていません)'; cell.kind = 'tbd'; cell.cls += ' w-moved';
        } else if(code==='行'){
          cell.text = '行'; cell.title = '行事'; cell.kind = 'event'; cell.cls += ' w-event';
        } else if(code){
          cell.text = code; cell.title = '授業なし('+code+')'; cell.cls += ' w-none';
        } else {
          cell.cls += ' w-none'; cell.title = '授業なし';
        }
        // 週ごとの変更(出張などの入れ替え)。state.changes に書いてあれば、そちらを使う
        const input = changeInput(d.key, c.id, p);
        if(input!=null){
          const ch = resolveChange(input, c, hrTeacher);
          ch.cell.cls += ' w-changed';
          ch.cell.title = '変更あり(元は「'+(cell.text || '授業なし')+'」)\n' + ch.cell.title;
          ch.cell.title += ch.cell.teacherIds.length ? '\n'+ch.cell.teacherIds.map(tname).join('・') : '';
          ch.cell.orig = cell.text;
          if(ch.warn) issues.push({ level:'warn', text:mdLabel(d.key)+' '+c.label+'の'+CIRCLED[p]+'「'+input+'」: '+ch.warn });
          changed.push({ date:d.key, cls:c, p, from:cell.text, to:ch.cell.text });
          row.push(ch.cell);
          ch.puts.forEach(([tid, x])=>put(tid, d.key, p, x));
          continue;
        }
        puts.forEach(([tid, x])=>put(tid, d.key, p, x));
        row.push(cell);
      }
    });
  });

  // 先生ごとの表。同じ時間に2か所(違う授業)に入っていたら重なり
  const byTeacher = {};
  state.teachers.forEach(t=>{
    byTeacher[t.id] = {};
    const baseRow = state.base[t.id] || {};
    dates.forEach(d=>{
      const row = byTeacher[t.id][d.key] = [];
      const anySchool = d.school;
      for(let p=0; p<WEEK_PERIODS; p++){
        const list = ((tAt[t.id]||{})[d.key]||[])[p] || [];
        if(!anySchool){ row.push({ text:'', cls:'w-off', title:(d.ev && (d.ev.hol || d.ev.text)) || '休み' }); continue; }
        if(!list.length){
          // 授業がないときは、基本時間割のその時間の先生の予定(会議の印など)を薄く出す
          const v = baseRow[d.wd+'-'+(p+1)] || '';
          const k = parseCell(v).kind;
          const isDuty = k==='duty' || (k==='homeroom' && !homeroomOf(t));
          row.push({ text: isDuty ? v : '', cls:'k-duty', title: isDuty ? '基本時間割の予定' : '' });
          continue;
        }
        const origins = [...new Set(list.map(x=>x.origin))];
        let text;
        if(origins.length===1 && !origins[0].startsWith('hr:')) text = baseRow[origins[0]] || list.map(x=>x.cid).join(',');
        else if(origins.length===1) text = subjectShort(list[0].subject);
        else text = list.map(x=>x.origin.startsWith('hr:') ? subjectShort(x.subject) : x.cid).join('/');
        const moved = origins.some(o=>o!==d.wd+'-'+(p+1));
        const cell = { text, cls: (origins.length===1 && origins[0].startsWith('hr:') ? 'k-hr' : '') + (moved ? ' w-moved' : ''),
          title: list.map(x=>x.cid.replace('-','年')+'組 '+x.subject).join('\n') };
        if(origins.length>1){
          cell.cls += ' g-err';
          list.forEach(x=>{ const cc = byClass[x.cid] && byClass[x.cid][d.key][p]; if(cc && !/g-err/.test(cc.cls)) cc.cls += ' g-err'; });
          issues.push({ level:'err', text:mdLabel(d.key)+' '+CIRCLED[p]+': '+teacherLabel(t)+'が同じ時間に2か所の授業に入っています('+list.map(x=>x.cid.replace('-','年')+'組').join('・')+')。' });
        }
        row.push(cell);
      }
    });
  });
  Object.keys(badSlots).sort().forEach(k=>{
    const b = badSlots[k], codes = [...b.codes].sort();
    issues.push({ level:'warn', text:mdLabel(k)+': 行事予定の①〜⑥の「'+codes.join('」「')+'」は、'+CONFIG.weekdays[b.wd]+'曜の基本時間割にない時間なので、空けています('+b.classes.slice(0,3).join('・')+(b.classes.length>3 ? ' ほか'+(b.classes.length-3)+'学級' : '')+')。' });
  });
  if(guessed.length) issues.push({ level:'info', text:'行事予定の①〜⑥が入っていない登校日('+guessed.map(mdLabel).join('、')+')は、授業なしとして表示しています。授業がある日なら、行事予定アプリで①〜⑥を入れてから読み込み直してください。' });
  return { dates, classes:tt.classes, byClass, byTeacher, issues, changed };
}

// はじめに表示する週(今日が年度の中なら今週、そうでなければ年度のはじめの週)
function defaultWeek(){
  const fy = (state.events && state.events.fiscalYear) || state.meta.fiscalYear;
  const t = todayYmd();
  if(t >= fiscalStart(fy) && t <= fiscalEnd(fy)) return mondayOf(t);
  return mondayOf(fiscalStart(fy));
}

//////////////////////// 画面 ////////////////////////
TABS.week = {
  render(){
    const el = $('tab-week');
    const ev = state.events;
    if(!view.week || !/^\d{4}-\d{2}-\d{2}$/.test(view.week)) view.week = defaultWeek();
    view.week = mondayOf(view.week);
    const head =
      '<div class="toolbar"><h2>週の時間割</h2><span class="hint">行事予定の①〜⑥と、基本の時間割(「教員の時間割」)から、週ごとの時間割を作ります。</span></div>'
      + '<div class="toolbar">'
      + '<button class="edit-act" data-act="importEvents">📥 行事予定を読み込む</button>'
      + (isSample ? '<button data-act="exportSampleEvents" title="行事予定アプリのデータファイルと同じ形の、見本のファイルを作ります">📤 見本の行事予定を書き出す</button>' : '')
      + '<span class="hint" id="wSource">'+(ev ? '読み込んだ行事予定: 「'+esc(ev.fileName)+'」('+ev.fiscalYear+'年度'+(ev.schoolName?'・'+esc(ev.schoolName):'')+'、'+fmtDateTime(ev.importedAt)+'に読み込み)' : '')+'</span>'
      + '</div>';
    if(!ev){
      el.innerHTML = head + '<div class="banner"><p><b>行事予定がまだ読み込まれていません。</b></p>'
        + '<p class="hint">「✏ 編集する」を押してから「📥 行事予定を読み込む」を押し、行事予定アプリのデータファイル(.json)を選んでください。行事予定のファイルは書き換えません。<br>'
        + '読み込んだ内容はこの時間割のデータファイルに控えておくので、ほかの先生は読み込み直さなくても見られます。行事予定を直したときは、もう一度読み込んでください。</p></div>';
      return;
    }
    const w = buildWeek(view.week);
    const mode = view.weekMode==='teacher' ? 'teacher' : 'class';
    const grades = state.meta.grades.map(g=>g.grade);
    if(view.classGrade && !grades.includes(view.classGrade)) view.classGrade = 0;
    const last = addDays(view.week, 6);
    el.innerHTML = head
      + '<div class="toolbar" id="wNav">'
      + '<button data-act="weekMove" data-d="-7">◀ 前の週</button>'
      + '<input type="date" id="wDate" value="'+view.week+'" title="日付を選ぶと、その日の週を表示します">'
      + '<button data-act="weekMove" data-d="7">次の週 ▶</button>'
      + '<button data-act="weekToday">今週</button>'
      + '<b>'+mdLabel(view.week)+' 〜 '+mdLabel(last)+'</b>'
      + '</div>'
      + '<div class="toolbar"><span class="seg" id="wModeSeg">'
      + '<button data-m="class"'+(mode==='class'?' class="active"':'')+'>学級の時間割</button>'
      + '<button data-m="teacher"'+(mode==='teacher'?' class="active"':'')+'>教員の時間割</button>'
      + '</span>'
      + (mode==='class' ? '<span class="seg" id="wGradeSeg"><button data-g="0"'+(view.classGrade===0?' class="active"':'')+'>全学年</button>'
          + grades.map(g=>'<button data-g="'+g+'"'+(view.classGrade===g?' class="active"':'')+'>'+g+'年</button>').join('')+'</span>' : '')
      + '<span class="legend"><span class="lg w-moved">入れ替えた時間</span><span class="lg w-event">行事</span><span class="lg w-off">休み</span><span class="lg w-changed">週ごとの変更</span><span class="lg g-err">重なり</span></span>'
      + (mode==='class' ? '<span class="sep-v"></span><button class="edit-act" data-act="undo" title="Ctrl+Z">↶ 元に戻す</button><button class="edit-act" data-act="redo" title="Ctrl+Y">↷ やり直す</button>' : '')
      + '</div>'
      + weekEventsHtml(w)
      + weekIssuesHtml(w)
      + (mode==='class' ? '<details class="howto" id="wHowto"><summary>この週だけ時間割を変えるには(出張などの入れ替え)</summary><ul>'
        + '<li>「✏ 編集する」を押してから、学級の時間割のマスをクリックして、教科を入れます(「数」「数学」「英」など。Excel のようにコピー・貼り付けもできます)。受け持つ先生は、基本の時間割から自動で決まります。</li>'
        + '<li>「学活」「道徳」「総合」は担任の先生の授業になります。授業をなくすときは「なし」、行事は「行」と入れます。</li>'
        + '<li>変えたマスは太い枠で表示され、表の下の「この週の変更」に一覧が出ます。Delete で消すと、元(行事予定と基本の時間割どおり)に戻ります。</li>'
        + '<li>入れ替えで同じ先生が同じ時間に2か所の授業に入ってしまうと、オレンジ色になり、上に出ます。「教員の時間割」に切り替えると、先生ごとに確かめられます。</li>'
        + '</ul></details>' : '')
      + '<div id="wGrid"></div>'
      + weekChangesHtml(w)
      + '<p class="hint">マスにマウスを乗せると、授業をする先生や、基本の何時間目の授業かが出ます。行事による時間のずれは、行事予定アプリの①〜⑥を直してから、もう一度読み込んでください。</p>';
    el.querySelectorAll('#wModeSeg button').forEach(b=>b.addEventListener('click', ()=>{ view.weekMode = b.dataset.m; savePref(); renderAll(); }));
    el.querySelectorAll('#wGradeSeg button').forEach(b=>b.addEventListener('click', ()=>{ view.classGrade = Number(b.dataset.g); savePref(); renderAll(); }));
    $('wDate').addEventListener('change', e=>{ if(e.target.value){ view.week = mondayOf(e.target.value); savePref(); renderAll(); } });

    // 列: 日ごとに①〜⑥。全学年が休みの日は1列にまとめる
    const cols = [{ label: mode==='class' ? '学級' : '教員', width: mode==='class' ? '5em' : '6.5em', sticky:true }];
    w.dates.forEach(d=>{
      const g = mdLabel(d.key) + (d.ev && d.ev.hol ? ' '+d.ev.hol : '');
      if(!d.school) cols.push({ label:'休', group:g, first:true, width:'4.5em', date:d.key, p:0 });
      else for(let p=0; p<WEEK_PERIODS; p++) cols.push({ label:CIRCLED[p], group:g, first:p===0, width:'2.9em', date:d.key, p });
    });
    const rows = mode==='class' ? w.classes.filter(c=>!view.classGrade || c.grade===view.classGrade) : state.teachers;
    weekGrid = createGrid({
      wrap: $('wGrid'), cols, rows: rows.length,
      cell(r, c){
        const x = rows[r];
        if(c===0) return mode==='class' ? { text:x.label, cls:'g-rowhead' } : { text:teacherLabel(x), cls:'g-rowhead', title:x.role+' '+x.subject };
        const col = cols[c];
        const cell = (mode==='class' ? w.byClass[x.id] : w.byTeacher[x.id])[col.date][col.p];
        return { text:cell.text, cls:cell.cls, title:cell.title };
      },
      commit(list){
        if(mode!=='class') return;
        let n = 0;
        list.forEach(({ r, c, val })=>{
          const x = rows[r], col = cols[c];
          if(c===0 || !x || !col.date) return;
          const d = w.dates.find(y=>y.key===col.date);
          if(!d || !d.ev || !d.ev.school || !d.ev.school[x.grade]) return;   // その学年が休みの日は変えられない
          const v = String(val==null?'':val).normalize('NFKC').trim();
          const cur = w.byClass[x.id][col.date][col.p];
          if(!n++) pushUndo();
          // 元と同じ文字を入れたときは、変更を消す(元に戻す)
          const orig = cur.orig!==undefined ? cur.orig : cur.text;
          setChange(col.date, x.id, col.p, v && v!==orig ? v : '');
        });
        if(!n) return;
        const s = weekGrid.sel; weekSel = { r:s.fr, c:s.fc };
        markDirty(); renderAll();
      },
      editable: ()=>editing && mode==='class',
      listFor: c => c>0 ? 'changeList' : '',
      onSelect(r, c){ weekSel = { r, c }; },
    });
    $('changeList').innerHTML = [...state.subjects.map(s=>s.short), ...Object.values(CONFIG.mergeSubjects), '学活', '道徳', '総合', 'なし', '行']
      .map(v=>'<option value="'+esc(v)+'">').join('');
    if(weekSel.r < rows.length && weekSel.c < cols.length) weekGrid.select(weekSel.r, weekSel.c);
  }
};
let weekGrid = null, weekSel = { r:0, c:1 };
function weekChangesHtml(w){
  if(!w.changed.length) return '';
  return '<h3>この週の変更('+w.changed.length+'か所)</h3><table class="grid counts"><thead><tr><th>日</th><th>学級</th><th>時間</th><th>元</th><th>変更後</th></tr></thead><tbody>'
    + w.changed.map(x=>'<tr><td>'+mdLabel(x.date)+'</td><td>'+esc(x.cls.label)+'</td><td class="c">'+CIRCLED[x.p]+'</td><td class="c">'+esc(x.from||'(なし)')+'</td><td class="c"><b>'+esc(x.to||'(なし)')+'</b></td></tr>').join('')
    + '</tbody></table>';
}
function weekEventsHtml(w){
  const items = w.dates.filter(d=>d.ev && (d.ev.text || d.ev.hol)).map(d=>'<li><b>'+mdLabel(d.key)+'</b> '+esc([d.ev.hol, d.ev.text].filter(Boolean).join('　'))+'</li>');
  return items.length ? '<ul class="week-events">'+items.join('')+'</ul>' : '';
}
function weekIssuesHtml(w){
  if(!w.issues.length) return '';
  const errs = w.issues.filter(x=>x.level==='err');
  const others = w.issues.filter(x=>x.level!=='err');
  return (errs.length ? '<div class="warn-box"><b>確認が必要なところ('+errs.length+'件)</b><ul>'+errs.map(x=>'<li class="err">'+esc(x.text)+'</li>').join('')+'</ul></div>' : '')
    + (others.length ? '<div class="info-box"><ul>'+others.map(x=>'<li>'+esc(x.text)+'</li>').join('')+'</ul></div>' : '');
}
function fmtDateTime(iso){
  const d = new Date(iso); if(isNaN(d)) return '';
  return (d.getMonth()+1)+'/'+d.getDate()+' '+d.getHours()+':'+pad2(d.getMinutes());
}
ACTIONS.weekMove = el=>{ view.week = addDays(view.week, Number(el.dataset.d)); savePref(); renderAll(); };
ACTIONS.weekToday = ()=>{ view.week = mondayOf(todayYmd()); savePref(); renderAll(); };

//////////////////////// 週ごとの変更(出張などの入れ替え) ////////////////////////
// state.changes[日付][学級][p(0〜5)] = マスに入力した文字。行事予定と基本時間割から自動でできる授業の代わりに、これを使う。
// 入力した文字のまま覚えておき、表示するたびに読み直す(あとで基本時間割を直しても、担当の先生が正しく付くように)。
//   教科(「数」「数学」「英」など)… その学級でその教科を受け持っている先生(基本時間割から探す)の授業
//   「道徳」「学活」「総合」(「道」「学」「総」) … 担任の先生の授業
//   「技家」 … 技術と家庭
//   「なし」「×」 … 授業なし / 「行」 … 行事 / そのほかの文字 … 授業ではない予定として、そのまま表示する
const CHANGE_NONE = ['なし', '×', '-'];
function changeInput(dateKey, cid, p){
  const d = state.changes && state.changes[dateKey], c = d && d[cid];
  return c && c[p]!=null && c[p]!=='' ? c[p] : null;
}
function setChange(dateKey, cid, p, v){
  if(v==null || v===''){
    const d = state.changes[dateKey]; if(!d || !d[cid]) return;
    delete d[cid][p];
    if(!Object.keys(d[cid]).length) delete d[cid];
    if(!Object.keys(d).length) delete state.changes[dateKey];
    return;
  }
  ((state.changes[dateKey] = state.changes[dateKey] || {})[cid] = state.changes[dateKey][cid] || {})[p] = v;
}
// その学級で、その教科を受け持っている先生(基本時間割から探す)
let subjectTeacherCache = null;
function subjectTeachers(cid, subject){
  if(!subjectTeacherCache){
    subjectTeacherCache = {};
    const tt = buildTimetable();
    tt.classes.forEach(c=>tt.slots.forEach(s=>tt.byClass[c.id][s.key].entries.forEach(e=>{
      const k = c.id+'|'+e.subject, list = subjectTeacherCache[k] = subjectTeacherCache[k] || [];
      if(!list.includes(e.teacherId)) list.push(e.teacherId);
    })));
  }
  return subjectTeacherCache[cid+'|'+subject] || [];
}
// 入力した文字を、表示するマスと受け持つ先生に読み替える
function resolveChange(input, c, hrTeacher){
  const s = String(input).normalize('NFKC').trim();
  const cell = { text:s, title:'', cls:'', teacherIds:[], subs:[], kind:'none' }, puts = [];
  let warn = '';
  if(CHANGE_NONE.includes(s)){ cell.text = ''; cell.cls = 'w-none'; cell.title = '授業なし'; return { cell, puts }; }
  if(s==='行'){ cell.kind = 'event'; cell.cls = 'w-event'; cell.title = '行事'; return { cell, puts }; }
  if(CONFIG.homeroomSubjects[s]){
    const sub = CONFIG.homeroomSubjects[s];
    cell.text = subjectShort(sub); cell.cls = 'k-hr'; cell.title = sub; cell.subs = [sub]; cell.kind = 'lesson';
    if(hrTeacher[c.id]){ cell.teacherIds = [hrTeacher[c.id]]; puts.push([hrTeacher[c.id], { cid:c.id, origin:'hr:'+c.id, subject:sub }]); }
    else warn = c.label+'の担任の先生が「教員の時間割」の担当の欄にありません。';
    return { cell, puts, warn };
  }
  // 技術と家庭のように、2つの教科を1コマで受けるもの
  const mergedKey = Object.keys(CONFIG.mergeSubjects).find(k=>CONFIG.mergeSubjects[k]===s);
  const subs = mergedKey ? mergedKey.split('|') : [subjectFromInput(s)];
  if(!subs.every(x=>state.subjects.some(y=>y.name===x))){ cell.cls = 'w-none'; cell.title = '授業ではない予定('+s+')'; return { cell, puts }; }
  cell.text = mergedKey ? s : subjectShort(subs[0]);
  cell.title = subs.join('・');
  cell.subs = subs; cell.kind = 'lesson';
  subs.forEach(sub=>{
    const ts = subjectTeachers(c.id, sub);
    if(!ts.length) warn = c.label+'で'+sub+'を受け持つ先生が、基本の時間割に見つかりません(先生なしで表示しています)。';
    ts.forEach(tid=>{ if(!cell.teacherIds.includes(tid)) cell.teacherIds.push(tid); puts.push([tid, { cid:c.id, origin:'chg:'+sub, subject:sub }]); });
  });
  return { cell, puts, warn };
}
