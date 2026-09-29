'use strict';
// 「基本時間割」タブ: 「教員」(入力する表。TABS.teacher)と「生徒」(自動でできる学級ごとの表。TABS.classes)

//////////////////////// 確認が必要なところ(両方のタブで使う) ////////////////////////
function issuesHtml(tt){
  if(!state.teachers.length) return '';
  if(!tt.issues.length) return '<div class="ok-box">✓ 重なりや空きコマは見つかりませんでした。</div>';
  const errs = tt.issues.filter(x=>x.level==='err').length;
  return '<div class="warn-box"><b>確認が必要なところ('+tt.issues.length+'件'+(errs?'、うち重なり '+errs+'件':'')+')</b>'
    + '<ul>'+tt.issues.map(x=>'<li class="'+x.level+'">'+esc(x.text)+'</li>').join('')+'</ul></div>';
}
function slotCols(){
  return slotList().map(s=>({ label:String(s.p), group:CONFIG.weekdays[s.wd], first:s.dayFirst, width:'2.9em', slot:s.key }));
}

//////////////////////// 教員の時間割(入力) ////////////////////////
let teacherGrid = null;
let teacherSel = { r:0, c:3 };   // 描き直したあとも同じマスを選んだままにするため
const T_FIXED = 3;               // 左の「担当・教科・教員」の列の数

TABS.teacher = {
  render(){
    const el = $('tab-teacher');
    el.innerHTML =
      '<div class="toolbar">'
      + '<span class="hint">縦が先生、横が曜日と時限です。マスには、授業をする学級(例: 1-2)を入れます。</span>'
      + '</div>'
      + '<div class="toolbar">'
      + '<button class="edit-act" data-act="importXlsx">📥 Excel から読み込む</button>'
      + '<button data-act="exportXlsx">📤 Excel に書き出す</button>'
      + '<span class="sep-v"></span>'
      + '<button class="edit-act" data-act="addTeacher">＋ 先生を追加</button>'
      + '<button class="edit-act" data-act="moveTeacher" data-dir="-1">↑ 上へ</button>'
      + '<button class="edit-act" data-act="moveTeacher" data-dir="1">↓ 下へ</button>'
      + '<button class="edit-act danger" data-act="deleteTeacher">選んだ先生の行を削除</button>'
      + '<span class="sep-v"></span>'
      + '<button class="edit-act" data-act="undo" title="Ctrl+Z">↶ 元に戻す</button>'
      + '<button class="edit-act" data-act="redo" title="Ctrl+Y">↷ やり直す</button>'
      + '</div>'
      + '<div id="tIssues"></div>'
      + '<details class="howto"><summary>入力のしかた</summary><ul>'
      + '<li>マスをクリックして文字を打ち、Enter で決まります。Excel のように、範囲を選んでコピー・貼り付け(Ctrl+C / Ctrl+V)、Delete で消去ができます。</li>'
      + '<li><b>学級の授業</b>: 「1-2」(1年2組)。2つの学級の合同は「3-12」(3年1組と2組)。</li>'
      + '<li><b>道徳・学活・総合</b>: 担任の先生の行に「道徳」「学活」「総合」(または「総/学」)と書くと、その先生の学級の授業になります。担任の学級は「担当」の欄に「1-2担」のように書きます。</li>'
      + '<li><b>会議や空き時間の印</b>: 「企画」「×」などの学級名でない文字は、「生徒」の表には出ません(先生の予定として残ります)。</li>'
      + '<li>いちばん下の空いている行に書くと、先生が1人増えます。今お使いの時間割の Excel から、先生と時間割をまとめて貼り付けることもできます(左上の「担当」から右下まで)。</li>'
      + '</ul></details>'
      + '<div id="tGrid"></div>';
    buildTeacherGrid();
  }
};
function buildTeacherGrid(){
  const slots = slotList();
  const cols = [
    { label:'担当', width:'6.5em', sticky:true },
    { label:'教科', width:'4.5em', sticky:true },
    { label:'教員', width:'5.5em', sticky:true },
    ...slotCols(),
    { label:'授業', group:'計', first:true, width:'3em' },
  ];
  let tt = buildTimetable();
  $('tIssues').innerHTML = issuesHtml(tt);
  const N = state.teachers.length;
  teacherGrid = createGrid({
    wrap: $('tGrid'), cols, rows: N + 1, growRows: true,
    cell(r, c){
      const t = state.teachers[r];
      if(!t) return { text:'', cls:'g-new', title:'ここに書くと、先生が1人増えます' };
      if(c===0) return { text:t.role, title:homeroomOf(t) ? '担任: '+homeroomOf(t).replace('-','年')+'組' : '' };
      if(c===1) return { text:subjectShort(t.subject), title:t.subject };
      if(c===2) return { text:t.name };
      if(c===cols.length-1) return { text:String(teacherLoad(t)), cls:'g-ro', title:'1週間の授業のコマ数' };
      const key = cols[c].slot, v = (state.base[t.id]||{})[key] || '';
      let kind = parseCell(v).kind;
      if(kind==='homeroom' && !homeroomOf(t)) kind = 'duty';   // 担任でない先生の「総/学」などは、先生の予定として表示
      const fl = (tt.cellFlags[t.id]||{})[key];
      return { text:v, cls:(kind==='homeroom'?'k-hr':kind==='duty'?'k-duty':'') + (fl?' g-'+fl:'') };
    },
    commit(list){
      pushUndo();
      const before = state.teachers.length;
      list.forEach(({ r, c, val })=>{
        if(c===cols.length-1) return;               // 「授業」の数は自動
        const v = String(val==null?'':val).trim();
        let t = state.teachers[r];
        if(!t){
          if(!v) return;
          while(state.teachers.length <= r){ const nt = { id:newId('t'), role:'', subject:'', name:'' }; state.teachers.push(nt); state.base[nt.id] = {}; }
          t = state.teachers[r];
        }
        if(c===0) t.role = normCellKeepText(v);
        else if(c===1) t.subject = subjectFromInput(v);
        else if(c===2) t.name = v;
        else {
          const key = cols[c].slot, row = state.base[t.id] || (state.base[t.id] = {});
          const nv = normCell(v);
          if(nv) row[key] = nv; else delete row[key];
        }
      });
      markDirty();
      if(state.teachers.length !== before){ const s = teacherGrid.sel; teacherSel = { r:s.fr, c:s.fc }; renderAll(); teacherGrid.select(teacherSel.r, teacherSel.c); return; }
      tt = buildTimetable();
      $('tIssues').innerHTML = issuesHtml(tt);
      teacherGrid.refresh();
    },
    editable: ()=>editing,
    listFor: c => c===1 ? 'subjectList' : (c>=T_FIXED && c<cols.length-1) ? 'cellList' : '',
    onSelect(r, c){ teacherSel = { r, c }; },
  });
  // 入力の候補(学級・道徳など・会議の印)
  $('cellList').innerHTML = [...classList().map(c=>c.id), ...Object.keys(CONFIG.homeroomSubjects).filter(k=>k.length>1), ...CONFIG.dutyMarks]
    .map(v=>'<option value="'+esc(v)+'">').join('');
  $('subjectList').innerHTML = state.subjects.map(s=>'<option value="'+esc(s.name)+'">').join('');
  if(teacherSel.r < N+1 && teacherSel.c < cols.length) teacherGrid.select(teacherSel.r, teacherSel.c);
}
// 担当の欄は「1-1担」の数字の書き方だけそろえる(ほかの文字はそのまま)
function normCellKeepText(v){ return String(v).normalize('NFKC').replace(/[ー－―‐−](?=\d)/g,'-').trim(); }

function selectedTeacherIndex(){
  if(!teacherGrid) return -1;
  const r = teacherGrid.sel.fr;
  return r < state.teachers.length ? r : -1;
}
ACTIONS.addTeacher = ()=>{
  pushUndo();
  const t = { id:newId('t'), role:'', subject:'', name:'' };
  state.teachers.push(t); state.base[t.id] = {};
  teacherSel = { r:state.teachers.length-1, c:0 };
  markDirty(); renderAll();
};
ACTIONS.moveTeacher = el=>{
  const i = selectedTeacherIndex(), d = Number(el.dataset.dir);
  if(i<0){ alert('動かす先生の行のマスを、先にクリックして選んでください。'); return; }
  const j = i + d;
  if(j<0 || j>=state.teachers.length) return;
  pushUndo();
  [state.teachers[i], state.teachers[j]] = [state.teachers[j], state.teachers[i]];
  teacherSel = { r:j, c:teacherGrid.sel.fc };
  markDirty(); renderAll();
};
ACTIONS.deleteTeacher = ()=>{
  const i = selectedTeacherIndex();
  if(i<0){ alert('削除する先生の行のマスを、先にクリックして選んでください。'); return; }
  const t = state.teachers[i];
  if(!confirm('「'+teacherLabel(t)+'」の行を削除します。この先生の時間割も消えます。\nよろしいですか？(すぐなら「元に戻す」で戻せます)')) return;
  pushUndo();
  state.teachers.splice(i, 1);
  delete state.base[t.id];
  markDirty(); renderAll();
};
ACTIONS.undo = ()=>doUndo();
ACTIONS.redo = ()=>doRedo();

//////////////////////// 学級の時間割(自動) ////////////////////////
TABS.classes = {
  render(){
    const tt = buildTimetable();
    const grades = state.meta.grades.map(g=>g.grade);
    if(view.classGrade && !grades.includes(view.classGrade)) view.classGrade = 0;
    const el = $('tab-classes');
    el.innerHTML =
      '<div class="toolbar"><span class="hint">「基本時間割」の「教員」から自動でできます。ここでは直せません(直すときは「基本時間割」の「教員」で)。</span></div>'
      + '<div class="toolbar"><span class="seg" id="cGradeSeg">'
      + '<button data-g="0"'+(view.classGrade===0?' class="active"':'')+'>全学年</button>'
      + grades.map(g=>'<button data-g="'+g+'"'+(view.classGrade===g?' class="active"':'')+'>'+g+'年</button>').join('')
      + '</span><span class="legend"><span class="lg g-err">重なり</span><span class="lg c-empty">授業なし</span><span class="lg c-merged">2人以上の先生</span></span></div>'
      + issuesHtml(tt)
      + '<div id="cGrid"></div>'
      + '<h3>1週間のコマ数(教科ごと)</h3><div class="scroll-x" id="cCounts"></div>'
      + '<h3>先生ごとの1週間の授業数</h3><div id="cLoads"></div>';
    el.querySelectorAll('#cGradeSeg button').forEach(b=>b.addEventListener('click', ()=>{ view.classGrade = Number(b.dataset.g); savePref(); renderAll(); }));
    const classes = tt.classes.filter(c=>!view.classGrade || c.grade===view.classGrade);
    const cols = [ { label:'学級', width:'5em', sticky:true }, ...slotCols() ];
    const tname = id=>{ const t = state.teachers.find(x=>x.id===id); return t ? teacherLabel(t) : ''; };
    createGrid({
      wrap: $('cGrid'), cols, rows: classes.length,
      cell(r, c){
        const cl = classes[r];
        if(c===0) return { text:cl.label, cls:'g-rowhead' };
        const cell = tt.byClass[cl.id][cols[c].slot];
        const teachers = [...new Set(cell.entries.map(e=>tname(e.teacherId)))];
        return { text:cell.text, title:teachers.join('・'),
          cls: cell.conflict ? 'g-err' : cell.empty ? 'c-empty' : teachers.length>1 ? 'c-merged' : '' };
      },
      commit(){}, editable: ()=>false,
    });
    // 教科ごとのコマ数
    const counts = weeklyCounts(tt);
    const used = new Set(); classes.forEach(c=>Object.keys(counts[c.id]).forEach(s=>used.add(s)));
    const subjOrder = state.subjects.map(s=>s.name).filter(n=>used.has(n)).concat([...used].filter(n=>!state.subjects.some(s=>s.name===n)));
    const fmt = n => n ? (Number.isInteger(n) ? String(n) : n.toFixed(1)) : '';
    $('cCounts').innerHTML = !classes.length ? '' : '<table class="grid counts"><thead><tr><th>学級</th>'+subjOrder.map(s=>'<th>'+esc(subjectShort(s))+'</th>').join('')+'<th>合計</th><th>コマ数</th></tr></thead><tbody>'
      + classes.map(c=>{
        const cnt = counts[c.id], tot = Object.values(cnt).reduce((a,b)=>a+b,0);
        return '<tr><th class="l">'+esc(c.label)+'</th>'+subjOrder.map(s=>'<td class="c">'+fmt(cnt[s])+'</td>').join('')
          + '<td class="c"><b>'+fmt(tot)+'</b></td><td class="c hint">'+tt.slots.length+'</td></tr>';
      }).join('') + '</tbody></table><p class="hint">「コマ数」は1週間の時限の数です。合計が少ないときは、授業の入っていないコマがあります。技術と家庭が同じコマのときは、それぞれ 0.5 と数えています。</p>';
    // 先生ごとの授業数
    $('cLoads').innerHTML = !state.teachers.length ? '<p class="hint">先生がまだいません。</p>' : '<div class="load-list">'
      + state.teachers.map(t=>'<span class="chip">'+esc(teacherLabel(t))+'<span class="hint">'+esc(subjectShort(t.subject))+'</span><b>'+teacherLoad(t)+'</b></span>').join('') + '</div>';
  }
};

//////////////////////// 「基本時間割」タブ(「教員」「生徒」の切り替え) ////////////////////////
// 上のタブは1つにして、中のボタンで「教員」(入力する表)と「生徒」(学級ごとの自動の表)を切り替える(週時間割と同じ形)。
TABS.base = {
  render(){
    const mode = view.baseMode==='class' ? 'class' : 'teacher';
    document.querySelectorAll('#baseSeg button').forEach(b=>b.classList.toggle('active', b.dataset.m===mode));
    $('tab-teacher').hidden = mode!=='teacher';
    $('tab-classes').hidden = mode!=='class';
    (mode==='class' ? TABS.classes : TABS.teacher).render();
  }
};
document.querySelectorAll('#baseSeg button').forEach(b=>b.addEventListener('click', ()=>{ view.baseMode = b.dataset.m; savePref(); renderAll(); }));
