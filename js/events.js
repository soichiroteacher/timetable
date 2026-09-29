'use strict';
// 行事予定アプリ(../school-events)のデータファイルを読み込み、日ごとの「登校日か」「①〜⑥」「行事」を控えておく。
//
// - 行事予定のファイルは読むだけで、書き換えない。
// - 読み込んだ内容は、このアプリのデータファイルの state.events に写しておく(ほかの先生は行事予定のファイルを開かなくても週の時間割を見られる)。
//   行事予定を直したときは、もう一度「行事予定を読み込む」を押して写し直す。
// - 祝日と登校日の判定は、行事予定アプリの computeNationalHolidays・getDayStatus・isSchoolDay と同じ結果になるように移したもの。
//   行事予定アプリの判定を変えたときは、ここも合わせて直すこと。

//////////////////////// 日付の道具 ////////////////////////
function dkey(y,m,d){ return y+'-'+pad2(m)+'-'+pad2(d); }
function daysInMonth(y,m){ return new Date(y, m, 0).getDate(); }
function dateToKey(d){ return dkey(d.getFullYear(), d.getMonth()+1, d.getDate()); }
function keyToDate(k){ const [y,m,d] = k.split('-').map(Number); return new Date(y, m-1, d); }
function addDays(k, n){ const d = keyToDate(k); d.setDate(d.getDate()+n); return dateToKey(d); }
// その日を含む週の月曜日
function mondayOf(k){ const d = keyToDate(k); const w = d.getDay(); return addDays(k, w===0 ? -6 : 1-w); }
function fiscalStart(fy){ return dkey(fy,4,1); }
function fiscalEnd(fy){ return dkey(fy+1,3,31); }
function mdLabel(k){ const d = keyToDate(k); return (d.getMonth()+1)+'/'+d.getDate()+'('+CONFIG.weekdays[d.getDay()]+')'; }

//////////////////////// 祝日(行事予定アプリと同じ計算) ////////////////////////
function nthWeekdayDate(year, month, weekday, n){
  const firstDow = new Date(year, month-1, 1).getDay();
  return 1 + (weekday - firstDow + 7) % 7 + (n-1)*7;
}
function vernalEquinoxDay(y){ return Math.floor(20.8431 + 0.242194*(y-1980) - Math.floor((y-1980)/4)); }
function autumnalEquinoxDay(y){ return Math.floor(23.2488 + 0.242194*(y-1980) - Math.floor((y-1980)/4)); }
// overrides: 行事予定アプリの holidayOverrides({ 'YYYY-MM-DD': { type:'add'|'remove', label } })
function computeNationalHolidays(year, overrides){
  const h = new Map();
  const add = (m,d,label)=>h.set(dkey(year,m,d), label);
  add(1,1,'元日'); add(1, nthWeekdayDate(year,1,1,2), '成人の日');
  add(2,11,'建国記念の日'); add(2,23,'天皇誕生日');
  add(3, vernalEquinoxDay(year), '春分の日');
  add(4,29,'昭和の日'); add(5,3,'憲法記念日'); add(5,4,'みどりの日'); add(5,5,'こどもの日');
  add(7, nthWeekdayDate(year,7,1,3), '海の日'); add(8,11,'山の日');
  add(9, nthWeekdayDate(year,9,1,3), '敬老の日'); add(9, autumnalEquinoxDay(year), '秋分の日');
  add(10, nthWeekdayDate(year,10,1,2), 'スポーツの日');
  add(11,3,'文化の日'); add(11,23,'勤労感謝の日');
  Object.keys(overrides||{}).forEach(key=>{
    if(!key.startsWith(year+'-')) return;
    const ov = overrides[key]; if(!ov) return;
    if(ov.type==='remove') h.delete(key);
    else if(ov.type==='add') h.set(key, ov.label || '祝日(手動追加)');
  });
  // 振替休日(日曜の祝日の次の、祝日でない日)
  Array.from(h.keys()).sort().forEach(k=>{
    const d = keyToDate(k);
    if(d.getDay()!==0) return;
    const next = new Date(d);
    do{ next.setDate(next.getDate()+1); }while(h.has(dateToKey(next)));
    h.set(dateToKey(next), '振替休日');
  });
  // 国民の休日(祝日にはさまれた平日)
  for(let m=1; m<=12; m++) for(let d=1; d<=daysInMonth(year,m); d++){
    const k = dkey(year,m,d);
    if(h.has(k)) continue;
    const dow = new Date(year,m-1,d).getDay();
    if(dow===0 || dow===6) continue;
    if(h.has(dateToKey(new Date(year,m-1,d-1))) && h.has(dateToKey(new Date(year,m-1,d+1)))) h.set(k, '国民の休日');
  }
  return h;
}

//////////////////////// 行事予定のファイルを写す ////////////////////////
// 戻り値は state.events に入れる形:
// { fileName, importedAt, fiscalYear, schoolName, classCounts:{1:3,...}, requiredHours:{1:{国語:140,...}}(ファイルにあれば),
//   days: { 'YYYY-MM-DD': { hol:'祝日名'(祝日のときだけ), school:{1:true,2:true,3:false}, periods:{1:['1','2',…6つ],…}, text:'行事' } } }
// 年度の中で「どれかの学年が登校日」か「行事の文字がある」日だけを入れる(入っていない日は休み)。
function convertEventsFile(o, fileName, grades){
  if(!o || typeof o!=='object' || !o.days || typeof o.days!=='object' || !o.meta)
    throw new Error('行事予定アプリのデータファイルではないようです。');
  const fy = Number(o.meta.fiscalYear);
  if(!(fy>=2000 && fy<=2100)) throw new Error('行事予定のファイルに年度が入っていません。');
  const overrides = o.holidayOverrides || {};
  const hol = { [fy]: computeNationalHolidays(fy, overrides), [fy+1]: computeNationalHolidays(fy+1, overrides) };
  // 古い形の行事予定ファイル(manualDayFlags: その日を登校日・休業日にする指定)は、行事予定アプリと同じく全学年の登校日の指定として読む
  const manual = o.manualDayFlags || {};
  const out = { fileName, importedAt:new Date().toISOString(), fiscalYear:fy, schoolName:String(o.meta.schoolName||''), classCounts:{}, days:{} };
  if(o.classCounts) Object.keys(o.classCounts).forEach(k=>{ const g = Number(k.replace('g','')); if(g) out.classCounts[g] = Number(o.classCounts[k])||0; });
  // 必要時数(行事予定アプリの設定タブの値)。無ければ、時数のタブで標準時数(CONFIG.defaultRequiredHours)を使う
  if(o.requiredHours && typeof o.requiredHours==='object'){
    out.requiredHours = {};
    Object.keys(o.requiredHours).forEach(k=>{
      const g = Number(k.replace('g','')), src = o.requiredHours[k];
      if(!g || !src) return;
      out.requiredHours[g] = {};
      CONFIG.requiredSubjects.forEach(sub=>{ if(typeof src[sub]==='number') out.requiredHours[g][sub] = src[sub]; });
    });
  }
  for(let k = fiscalStart(fy); k <= fiscalEnd(fy); k = addDays(k, 1)){
    const d = keyToDate(k), dow = d.getDay();
    const holName = hol[d.getFullYear()].get(k) || '';
    const rec = o.days[k] || {};
    const school = {}, periods = {};
    grades.forEach(g=>{
      let ex = rec.schoolDay ? rec.schoolDay['g'+g] : null;
      if(typeof ex!=='boolean' && manual[k]) ex = manual[k].mode==='schoolday';
      school[g] = typeof ex==='boolean' ? ex : (!holName && dow!==0 && dow!==6);
      const p = (rec.periods && Array.isArray(rec.periods['g'+g])) ? rec.periods['g'+g] : [];
      periods[g] = Array.from({length:6}, (_, i)=>String(p[i]==null ? '' : p[i]).normalize('NFKC').trim());
    });
    const text = [rec.eventsAnnual, rec.eventsMonthly, rec.eventsTeacherOnlyAnnual, rec.eventsTeacherOnly, manual[k] && manual[k].label]
      .filter(Boolean).map(String).join('　');
    const anySchool = grades.some(g=>school[g]);
    if(!anySchool && !text && !holName) continue;
    const day = { school, periods };
    if(holName) day.hol = holName;
    if(text) day.text = text;
    if(!anySchool){ delete day.periods; }
    out.days[k] = day;
  }
  return out;
}

// 「行事予定を読み込む」ボタン
ACTIONS.importEvents = ()=>{
  pickFileText((text, name)=>{
    let conv;
    try{ conv = convertEventsFile(JSON.parse(text), name, state.meta.grades.map(g=>g.grade)); }
    catch(e){ alert('読み込めませんでした。\n'+e.message+'\n\n行事予定アプリのデータファイル(.json)を選んでください。'); return; }
    const msgs = [];
    if(conv.fiscalYear !== state.meta.fiscalYear) msgs.push('・行事予定は '+conv.fiscalYear+'年度、この時間割は '+state.meta.fiscalYear+'年度です。');
    const diff = state.meta.grades.filter(g=>conv.classCounts[g.grade]!=null && conv.classCounts[g.grade]!==g.classes);
    if(diff.length) msgs.push('・学級の数が違います(行事予定の実績タブの設定: '+diff.map(g=>g.grade+'年 '+conv.classCounts[g.grade]+'学級').join('、')+')。週の時間割はこちらの設定の学級で作ります。');
    if(msgs.length && !confirm('次の点を確かめてください。\n\n'+msgs.join('\n')+'\n\nこのまま読み込みますか？')) return;
    if(state.events && !confirm('前に読み込んだ行事予定(「'+state.events.fileName+'」)を、「'+name+'」の内容に置き換えます。よろしいですか？\n(行事予定のファイルは書き換えません)')) return;
    state.events = conv;
    // 週の時間割の表示を、読み込んだ年度の中に入れる
    if(!view.week || view.week < mondayOf(fiscalStart(conv.fiscalYear)) || view.week > fiscalEnd(conv.fiscalYear)){ view.week = defaultWeek(); savePref(); }
    markDirty(); renderAll();
    setStatus('行事予定を読み込みました(「'+name+'」)', 'saved');
  });
};
