'use strict';
// 「時数」タブ: 学級ごと・教科ごとの授業時数の実績と予測を数え、年間の必要時数と比べる。
//
// - 数え方: 年度の週を1つずつ「週時間割」(buildWeek)で組み立て、学級の時間割のマスを数える。
//   週ごとの変更(state.changes)も入る。行事予定の①〜⑥が空欄の日は授業なし(週の時間割と同じ)。
// - 実績 = 基準日より前の日の分、予定 = 基準日から年度末までの分、予測 = 実績 + 予定。
// - 技術と家庭は、必要時数では「技術家庭」にまとめて比べる(CONFIG.requiredSubjectOf)。1コマに2教科(技家)のときは半分ずつ数える。
// - 必要時数は、行事予定のファイルにあればその値、無ければ標準時数(CONFIG.defaultRequiredHours)。
// - 「●」(教科が決まっていない授業)と「行」(行事)は、教科とは別に数える。

// 教科名を必要時数の教科名に読み替え、重み付きで返す [[教科, 重み]]
function requiredParts(sub){
  if(sub==='総/学') return [['総合', 0.5], ['特別活動', 0.5]];
  return [[CONFIG.requiredSubjectOf[sub] || sub, 1]];
}
function requiredHoursOf(grade){
  const ev = state.events && state.events.requiredHours && state.events.requiredHours[grade];
  const def = CONFIG.defaultRequiredHours[grade] || {};
  const out = {};
  CONFIG.requiredSubjects.forEach(s=>{ out[s] = ev && typeof ev[s]==='number' ? ev[s] : (def[s] || 0); });
  return out;
}

// 年度全体を数える。until より前の日を実績、それ以降を予定とする。
// 戻り値 { byClass: { [classId]: { actual:{教科:時数}, plan:{…}, detail:{actual:{教科:時数}, plan:{…}} } }, warnDays, blankDays }
//   actual / plan のキーは必要時数の12教科と、'その他'・'未定'(●)・'行事'(行)。detail は技術・家庭を分けたまま数えたもの(表のマスの説明に使う)
function tallyHours(until){
  const fy = state.events.fiscalYear, start = fiscalStart(fy), end = fiscalEnd(fy);
  const byClass = {};
  buildTimetable().classes.forEach(c=>{ byClass[c.id] = { actual:{}, plan:{}, detail:{ actual:{}, plan:{} } }; });
  const add = (o, k, n)=>{ o[k] = (o[k]||0) + n; };
  const warnDays = new Set(), blankDays = new Set();
  for(let mon = mondayOf(start); mon <= end; mon = addDays(mon, 7)){
    const w = buildWeek(mon);
    w.dates.forEach(d=>{
      if(d.key < start || d.key > end) return;
      w.classes.forEach(c=>{
        const bc = byClass[c.id]; if(!bc) return;
        const which = d.key < until ? 'actual' : 'plan';
        const codes = d.ev && d.ev.school && d.ev.school[c.grade] && d.ev.periods && d.ev.periods[c.grade];
        if(codes && codes.every(x=>!x) && !(state.changes[d.key] && state.changes[d.key][c.id])) blankDays.add(d.key);
        w.byClass[c.id][d.key].forEach(cell=>{
          if(/g-warn/.test(cell.cls)) warnDays.add(d.key);
          if(cell.kind==='tbd'){ add(bc[which], '未定', 1); return; }
          if(cell.kind==='event'){ add(bc[which], '行事', 1); return; }
          if(cell.kind!=='lesson' || !cell.subs.length) return;
          const share = 1 / cell.subs.length;
          cell.subs.forEach(sub=>{
            add(bc.detail[which], sub, share);
            requiredParts(sub).forEach(([rs, wgt])=> add(bc[which], CONFIG.requiredSubjects.includes(rs) ? rs : 'その他', share*wgt));
          });
        });
      });
    });
  }
  return { byClass, warnDays:[...warnDays].sort(), blankDays:[...blankDays].sort() };
}

// 基準日の初期値(今日。年度の外なら年度のはじめ/終わり)
function defaultHoursDate(){
  const fy = state.events.fiscalYear, t = todayYmd();
  if(t < fiscalStart(fy)) return fiscalStart(fy);
  if(t > fiscalEnd(fy)) return addDays(fiscalEnd(fy), 1);
  return t;
}

//////////////////////// 画面 ////////////////////////
TABS.hours = {
  render(){
    const el = $('tab-hours');
    const head = '<div class="toolbar"><h2>時数(実績と予測)</h2><span class="hint">週時間割から、学級ごと・教科ごとの授業時数を数えて、年間の必要時数と比べます。</span></div>';
    if(!state.events){
      el.innerHTML = head + '<div class="banner"><p><b>行事予定がまだ読み込まれていません。</b></p><p class="hint">時数は、行事予定の①〜⑥と時間割から数えます。「週時間割」の画面で、「📥 行事予定を読み込む」を押してください。</p></div>';
      return;
    }
    const fy = state.events.fiscalYear;
    if(!view.hoursDate || view.hoursDate < fiscalStart(fy) || view.hoursDate > addDays(fiscalEnd(fy),1)) view.hoursDate = defaultHoursDate();
    const mode = ['forecast','actual','plan'].includes(view.hoursMode) ? view.hoursMode : 'forecast';
    const grades = state.meta.grades.map(g=>g.grade);
    if(view.classGrade && !grades.includes(view.classGrade)) view.classGrade = 0;
    const t = tallyHours(view.hoursDate);
    const untilLabel = mdLabel(addDays(view.hoursDate, -1));
    el.innerHTML = head
      + '<div class="toolbar">'
      + '<label>基準日 <input type="date" id="hDate" min="'+fiscalStart(fy)+'" max="'+addDays(fiscalEnd(fy),1)+'" value="'+view.hoursDate+'"></label>'
      + '<button data-act="hoursToday">今日</button>'
      + '<span class="hint">'+(view.hoursDate > fiscalStart(fy) ? untilLabel+'までを「実績」、それより後を「予定」として数えます。' : 'まだ実績はありません(すべて「予定」)。')+'</span>'
      + '</div>'
      + '<div class="toolbar"><span class="seg" id="hModeSeg">'
      + [['forecast','予測(実績＋予定)と必要時数'],['actual','実績'],['plan','これからの予定']].map(([k,l])=>'<button data-m="'+k+'"'+(mode===k?' class="active"':'')+'>'+l+'</button>').join('')
      + '</span><span class="seg" id="hGradeSeg"><button data-g="0"'+(view.classGrade===0?' class="active"':'')+'>全学年</button>'
      + grades.map(g=>'<button data-g="'+g+'"'+(view.classGrade===g?' class="active"':'')+'>'+g+'年</button>').join('')+'</span>'
      + (mode==='forecast' ? '<span class="legend"><span class="lg h-short">足りない</span><span class="lg h-ok">足りている</span></span>' : '')
      + '</div>'
      + hoursNotesHtml(t)
      + '<div class="scroll-x" id="hTable">'+hoursTableHtml(t, mode)+'</div>'
      + '<p class="hint">必要時数は'+(state.events.requiredHours ? '、行事予定アプリの設定の値です(直すときは行事予定アプリで直し、読み込み直してください)。' : '、学習指導要領の標準時数です(行事予定のファイルに必要時数がなかったため)。')
      + '技術と家庭は「技家」にまとめて比べます(マスにマウスを乗せると、別々の時数が出ます)。1コマに技術と家庭が入っているときは、それぞれ 0.5 と数えます。'
      + '「未定」は行事予定の①〜⑥の「●」(教科が決まっていない授業)、「行事」は「行」のコマの数です。</p>';
    el.querySelectorAll('#hModeSeg button').forEach(b=>b.addEventListener('click', ()=>{ view.hoursMode = b.dataset.m; savePref(); renderAll(); }));
    el.querySelectorAll('#hGradeSeg button').forEach(b=>b.addEventListener('click', ()=>{ view.classGrade = Number(b.dataset.g); savePref(); renderAll(); }));
    $('hDate').addEventListener('change', e=>{ if(e.target.value){ view.hoursDate = e.target.value; savePref(); renderAll(); } });
  }
};
ACTIONS.hoursToday = ()=>{ view.hoursDate = defaultHoursDate(); savePref(); renderAll(); };

function fmtHours(n){ if(!n) return '0'; return Number.isInteger(n) ? String(n) : n.toFixed(1); }
function hoursNotesHtml(t){
  const items = [];
  if(t.blankDays.length) items.push('行事予定の①〜⑥が入っていない登校日が '+t.blankDays.length+'日あります(授業なしとして数えています): '+t.blankDays.slice(0,10).map(mdLabel).join('、')+(t.blankDays.length>10?' …ほか':''));
  if(t.warnDays.length) items.push('行事予定の①〜⑥に、基本の時間割にない時間の番号(土曜授業など)が入っている日が '+t.warnDays.length+'日あります(その時間は数えていません): '+t.warnDays.slice(0,10).map(mdLabel).join('、')+(t.warnDays.length>10?' …ほか':''));
  return items.length ? '<div class="info-box"><ul>'+items.map(x=>'<li>'+esc(x)+'</li>').join('')+'</ul></div>' : '';
}
function hoursTableHtml(t, mode){
  const subs = CONFIG.requiredSubjects;
  const extra = ['その他', '未定', '行事'].filter(k=>Object.values(t.byClass).some(b=>b.actual[k] || b.plan[k]));
  const classes = buildTimetable().classes.filter(c=>!view.classGrade || c.grade===view.classGrade);
  let html = '<table class="grid counts hours"><thead><tr><th>学級</th>'
    + subs.map(s=>'<th title="'+esc(s)+'">'+esc(CONFIG.requiredShort[s]||s)+'</th>').join('')
    + '<th>合計</th>' + extra.map(k=>'<th class="h-extra">'+esc(k)+'</th>').join('') + '</tr></thead><tbody>';
  let lastGrade = null;
  classes.forEach(c=>{
    const req = requiredHoursOf(c.grade);
    if(c.grade!==lastGrade && mode==='forecast'){
      lastGrade = c.grade;
      html += '<tr class="h-req"><th class="l">'+c.grade+'年 必要時数</th>'+subs.map(s=>'<td class="c">'+fmtHours(req[s])+'</td>').join('')
        + '<td class="c">'+fmtHours(subs.reduce((a,s)=>a+req[s],0))+'</td>'+extra.map(()=>'<td></td>').join('')+'</tr>';
    }
    const b = t.byClass[c.id];
    const val = k => mode==='actual' ? (b.actual[k]||0) : mode==='plan' ? (b.plan[k]||0) : (b.actual[k]||0) + (b.plan[k]||0);
    const detailTip = s => {
      const parts = Object.keys(b.detail.actual).concat(Object.keys(b.detail.plan)).filter((x,i,a)=>a.indexOf(x)===i)
        .filter(x=>requiredParts(x).some(([rs])=>rs===s));
      const tip = parts.length > 1 || (parts[0] && parts[0]!==s)
        ? parts.map(x=>x+' '+fmtHours(mode==='actual' ? (b.detail.actual[x]||0) : mode==='plan' ? (b.detail.plan[x]||0) : (b.detail.actual[x]||0)+(b.detail.plan[x]||0))).join(' / ')+'\n' : '';
      return tip + '実績 '+fmtHours(b.actual[s]||0)+'・予定 '+fmtHours(b.plan[s]||0)+(mode==='forecast' ? '・必要 '+fmtHours(req[s]) : '');
    };
    html += '<tr><th class="l">'+esc(c.label)+'</th>' + subs.map(s=>{
      const v = val(s);
      if(mode!=='forecast') return '<td class="c" title="'+esc(detailTip(s))+'">'+fmtHours(v)+'</td>';
      const diff = v - req[s];
      return '<td class="c '+(diff<0 ? 'h-short' : 'h-ok')+'" title="'+esc(detailTip(s))+'">'+fmtHours(v)
        + '<span class="h-diff">'+(diff<0 ? '−'+fmtHours(-diff) : diff>0 ? '+'+fmtHours(diff) : '±0')+'</span></td>';
    }).join('')
      + '<td class="c"><b>'+fmtHours(subs.reduce((a,s)=>a+val(s),0))+'</b></td>'
      + extra.map(k=>'<td class="c h-extra">'+fmtHours(val(k))+'</td>').join('') + '</tr>';
  });
  return html + '</tbody></table>';
}
