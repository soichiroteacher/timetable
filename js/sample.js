'use strict';
// 見本(架空の学校・先生)。動作確認と、はじめての人のお試し用。保存はされない。
// 時間割は、決まった手順(乱数の種を固定)で自動で組むので、毎回同じ見本になる。
// 実在の学校名・人名は使わない(先生は「名字＋先生」だけの架空の名前)。

// 1週間の教科ごとのコマ数(見本用。学年ごと)
const SAMPLE_HOURS = {
  1: { 国語:4, 社会:3, 数学:4, 理科:3, 音楽:1, 美術:1, 保健体育:3, 技術:1, 家庭:1, 外国語:3 },   // 1年は変動枠が1コマあるので、外国語を1つ減らしてある(変動枠で補う)
  2: { 国語:4, 社会:3, 数学:3, 理科:4, 音楽:1, 美術:1, 保健体育:3, 技術:1, 家庭:1, 外国語:4 },
  3: { 国語:3, 社会:4, 数学:4, 理科:4, 音楽:1, 美術:1, 保健体育:3, 技家:1, 外国語:4 },
};
// 先生: [担当, 教科, 名前, 受け持つ学級]
const SAMPLE_TEACHERS = [
  ['1-1担',          '国語',     '青木', ['1-1','1-2','1-3','3-3']],
  ['2-1担',          '国語',     '石川', ['2-1','2-2','2-3','3-1','3-2']],
  ['教務主任',        '社会',     '上野', ['1-1','1-2','1-3','3-3']],
  ['3-1担',          '社会',     '江口', ['2-1','2-2','2-3','3-1','3-2']],
  ['1-2担',          '数学',     '大川', ['1-1','1-2','1-3','3-1']],
  ['2-2担',          '数学',     '香山', ['2-1','2-2','2-3','3-2','3-3']],
  ['3-2担',          '理科',     '北野', ['3-1','3-2','3-3','1-3']],
  ['1-3担',          '理科',     '久保', ['1-1','1-2','2-1','2-2','2-3']],
  ['2-3担',          '外国語',   '小島', ['1-1','1-2','1-3','2-3']],
  ['3-3担',          '外国語',   '坂口', ['2-1','2-2','3-1','3-2','3-3']],
  ['生徒指導主事',     '保健体育', '柴田', ['1-1','1-2','1-3','3-1']],
  ['1副',            '保健体育', '須田', ['2-1','2-2','2-3','3-2','3-3']],
  ['2副',            '音楽',     '瀬戸', ['1-1','1-2','1-3','2-1','2-2','2-3','3-1','3-2','3-3']],
  ['3副',            '美術',     '武田', ['1-1','1-2','1-3','2-1','2-2','2-3','3-1','3-2','3-3']],
  ['1副',            '技術',     '千葉', ['1-1','1-2','1-3','2-1','2-2','2-3','3-1','3-2','3-3']],
  ['講師',           '家庭',     '辻',   ['1-1','1-2','1-3','2-1','2-2','2-3','3-1','3-2','3-3']],
];
// 決まった時間に全学級で行うもの(担任の行に書く)
const SAMPLE_FIXED = [ ['1-1','道徳'], ['5-5','学活'], ['4-5','総合'], ['4-6','総合'] ];
// 変動枠(学年, コマ)。見本では1年の火曜6時間目を変動枠にする(中身は週時間割の「変動枠の案を作る」で決まる)
const SAMPLE_FLEX = [ [1, '2-6'] ];

function makeSample(){
  const s = emptyState(currentFiscalYear());
  s.meta.schoolName = '見本中学校';
  s.meta.grades = [ { grade:1, classes:3 }, { grade:2, classes:3 }, { grade:3, classes:3 } ];
  s.meta.days = [ { wd:1, periods:6 }, { wd:2, periods:6 }, { wd:3, periods:6 }, { wd:4, periods:6 }, { wd:5, periods:5 } ];
  s.meta.flexSlots = SAMPLE_FLEX.map(([grade, key])=>({ grade, key }));
  const keys = []; s.meta.days.forEach(d=>{ for(let p=1; p<=d.periods; p++) keys.push(d.wd+'-'+p); });
  s.teachers = SAMPLE_TEACHERS.map(([role, subject, name], i)=>({ id:'t'+(i+1), role, subject, name:name+'先生' }));
  const classes = []; s.meta.grades.forEach(g=>{ for(let n=1; n<=g.classes; n++) classes.push(g.grade+'-'+n); });

  // 授業の一覧: { cls, subject, teachers:[先生の番号] }
  const lessons = [];
  classes.forEach(cls=>{
    const g = Number(cls[0]);
    Object.entries(SAMPLE_HOURS[g]).forEach(([subject, n])=>{
      let ts;
      if(subject==='技家') ts = SAMPLE_TEACHERS.map((t,i)=>i).filter(i=>['技術','家庭'].includes(SAMPLE_TEACHERS[i][1]) && SAMPLE_TEACHERS[i][3].includes(cls));
      else ts = [SAMPLE_TEACHERS.findIndex(t=>t[1]===subject && t[3].includes(cls))];
      for(let k=0; k<n; k++) lessons.push({ cls, subject, teachers:ts });
    });
  });
  // 乱数(種を決めて、毎回同じ結果にする)
  const rand = seed=>()=>{ seed = (seed*1103515245 + 12345) & 0x7fffffff; return seed/0x7fffffff; };
  for(let seed=1; seed<500; seed++){
    const rnd = rand(seed);
    const busyT = SAMPLE_TEACHERS.map(()=>new Set()), busyC = {}; classes.forEach(c=>busyC[c] = new Set());
    const subjDay = {};  // 同じ学級・同じ教科を1日に2回入れないため 'cls|subject|wd'
    const base = {}; s.teachers.forEach(t=>base[t.id] = {});
    SAMPLE_FLEX.forEach(([g, key])=>classes.filter(c=>c[0]===String(g)).forEach(c=>busyC[c].add(key)));   // 変動枠には授業を置かない
    SAMPLE_FIXED.forEach(([key, text])=>{
      SAMPLE_TEACHERS.forEach((t,i)=>{ const m = t[0].match(/(\d-\d)担/); if(m){ base[s.teachers[i].id][key] = text; busyT[i].add(key); busyC[m[1]].add(key); } });
    });
    // 毎回、置ける時間がいちばん少ない授業から置く(置きにくいものを後回しにすると、最後に置けなくなるため)
    const rest = lessons.slice();
    const candOf = l => keys.filter(k=>!busyC[l.cls].has(k) && l.teachers.every(i=>!busyT[i].has(k)));
    let ok = true;
    while(rest.length){
      let bi = -1, bc = null;
      rest.forEach((l, i)=>{ const c = candOf(l); if(bi<0 || c.length < bc.length || (c.length===bc.length && rnd()<0.3)){ bi = i; bc = c; } });
      const l = rest.splice(bi, 1)[0], cand = bc;
      const good = cand.filter(k=>!subjDay[l.cls+'|'+l.subject+'|'+k.split('-')[0]]);
      const pool = good.length ? good : cand;
      if(!pool.length){ ok = false; break; }
      const k = pool[Math.floor(rnd()*pool.length)];
      busyC[l.cls].add(k); subjDay[l.cls+'|'+l.subject+'|'+k.split('-')[0]] = true;
      l.teachers.forEach(i=>{ busyT[i].add(k); base[s.teachers[i].id][k] = l.cls; });
    }
    if(!ok) continue;
    // 会議の印も少し入れておく(学級の時間割には出ない)
    ['1-6','3-6'].forEach(k=>[2,4,10].forEach(i=>{ if(!busyT[i].has(k)) base[s.teachers[i].id][k] = '企画'; }));
    s.base = base;
    s.events = convertEventsFile(makeSampleEventsFile(s.meta.fiscalYear, s), '見本の行事予定.json', s.meta.grades.map(g=>g.grade));
    // 週ごとの変更の見本: 6月2週目の火曜、1年1組の2つの時間を入れ替える(出張で先生がいない時間との入れ替え、のつもり)。
    // 入れ替えても先生が重ならない組み合わせを探す
    let tue = dkey(s.meta.fiscalYear,6,8); while(keyToDate(tue).getDay()!==2) tue = addDays(tue,1);
    const who = key=>s.teachers.find(t=>s.base[t.id][key]==='1-1');
    const busy = (t, key)=>!!s.base[t.id][key];
    swap: for(let i=1; i<=6; i++) for(let j=i+1; j<=6; j++){
      const ti = who('2-'+i), tj = who('2-'+j);
      if(!ti || !tj || ti===tj || busy(ti,'2-'+j) || busy(tj,'2-'+i)) continue;
      const sh = t=>s.subjects.find(x=>x.name===t.subject).short;
      s.changes = { [tue]: { '1-1': { [i-1]:sh(tj), [j-1]:sh(ti) } } };
      break swap;
    }
    return s;
  }
  throw new Error('見本の時間割を作れませんでした。');
}

//////////////////////// 見本の行事予定 ////////////////////////
// 行事予定アプリのデータファイルと同じ形の、架空の1年分を作る(「週時間割」を試すため)。
// 見本を開いたときはこれを読み込んだ状態にする。「見本の行事予定を書き出す」で、ファイルとしても取り出せる。
function makeSampleEventsFile(fy, s){
  const days = {};
  const periodsOf = wd => { const d = s.meta.days.find(x=>x.wd===wd); return d ? d.periods : 0; };
  const full = wd => Array.from({length:6}, (_, i)=> i < periodsOf(wd) ? String(i+1) : '');
  const all = arr => ({ g1:arr.slice(), g2:arr.slice(), g3:arr.slice() });
  const set = (k, rec)=>{ days[k] = Object.assign(days[k] || {}, rec); };
  const off = (from, to, label)=>{ for(let k=from; k<=to; k=addDays(k,1)) set(k, { schoolDay:{ g1:false, g2:false, g3:false } }); if(label) set(from, { eventsAnnual:label }); };
  const hol = { [fy]:computeNationalHolidays(fy), [fy+1]:computeNationalHolidays(fy+1) };
  const isWeekday = k => { const d = keyToDate(k), w = d.getDay(); return w>=1 && w<=5 && !hol[d.getFullYear()].get(k); };
  // n 番目の平日(from 以降)
  const nthWeekday = (from, n)=>{ let k = from, c = 0; for(;;){ if(isWeekday(k) && ++c===n) return k; k = addDays(k,1); } };
  // ふだんの日は、基本時間割どおり(①〜⑥に 1〜6)
  for(let k=fiscalStart(fy); k<=fiscalEnd(fy); k=addDays(k,1)){
    if(isWeekday(k)) set(k, { periods:all(full(keyToDate(k).getDay())) });
  }
  // 長い休み
  off(dkey(fy,4,1), addDays(nthWeekday(dkey(fy,4,6),1), -1), '春休み');
  off(dkey(fy,7,21), dkey(fy,8,31), '夏休み');
  off(dkey(fy,12,26), dkey(fy+1,1,7), '冬休み');
  off(dkey(fy+1,3,25), dkey(fy+1,3,31), '春休み');
  const start1 = nthWeekday(dkey(fy,4,6), 1);
  set(start1, { eventsAnnual:'始業式・着任式', periods:all(['学','学','1','2','','']) });
  const nyu = nthWeekday(start1, 2);
  set(nyu, { eventsAnnual:'入学式', periods:{ g1:['行','行','','','',''], g2:['●','●','行','','',''], g3:['●','●','行','','',''] } });
  set(nthWeekday(start1, 4), { eventsMonthly:'身体測定', periods:all(['1','2','3','4','行','行']) });
  set(nthWeekday(start1, 8), { eventsMonthly:'授業参観・学級懇談会', periods:all(['1','2','3','4','5','学']) });
  // 体育祭(土曜に登校し、次の月曜を振替休業にする)
  let sat = dkey(fy,5,16); while(keyToDate(sat).getDay()!==6) sat = addDays(sat,1);
  set(addDays(sat,-1), { eventsMonthly:'体育祭予行', periods:all(['1','2','3','4','行','行']) });
  set(sat, { eventsAnnual:'体育祭', schoolDay:{ g1:true, g2:true, g3:true }, periods:all(['行','行','行','行','行','行']) });
  set(addDays(sat,2), { eventsAnnual:'振替休業日', schoolDay:{ g1:false, g2:false, g3:false } });
  // 3年だけ時間をずらす日(5時間目に6時間目の授業。ほかの学年と先生が重ならないかの確認の見本)
  const shin = nthWeekday(dkey(fy,6,1), 3), shinFull = full(keyToDate(shin).getDay());
  set(shin, { eventsMonthly:'進路説明会(3年)', periods:{ g1:shinFull, g2:shinFull, g3:shinFull[5] ? ['1','2','3','4','6','行'] : ['1','2','3','5','行','行'] } });
  const exam = nthWeekday(dkey(fy,6,24), 1);
  set(exam, { eventsAnnual:'期末テスト(1日目)', periods:all(['行','行','行','','','']) });
  set(nthWeekday(exam,2), { eventsAnnual:'期末テスト(2日目)', periods:all(['行','行','行','','','']) });
  set(addDays(dkey(fy,7,21),-1), { eventsAnnual:'1学期終業式', periods:all(['学','学','行','','','']) });
  set(nthWeekday(dkey(fy,9,1),1), { eventsAnnual:'2学期始業式', periods:all(['学','学','1','2','','']) });
  // 修学旅行(3年・3日間)
  const trip = nthWeekday(dkey(fy,10,14), 1);
  for(let i=0, k=trip; i<3; k=addDays(k,1)){ if(!isWeekday(k)) continue; set(k, { eventsAnnual: i===0 ? '修学旅行(3年)' : '', periods:{ g1:full(keyToDate(k).getDay()), g2:full(keyToDate(k).getDay()), g3:['行','行','行','行','行','行'] } }); i++; }
  set(nthWeekday(dkey(fy,11,4),1), { eventsAnnual:'合唱コンクール', periods:all(['音','音','行','行','','']) });
  const hinan = nthWeekday(dkey(fy,11,10),1);
  set(hinan, { eventsMonthly:'避難訓練', periods:all(full(keyToDate(hinan).getDay()).map((v,i)=>i===4 ? '学' : v)) });
  set(addDays(dkey(fy,12,26),-1), { eventsAnnual:'2学期終業式', periods:all(['学','学','行','','','']) });
  set(nthWeekday(dkey(fy+1,1,8),1), { eventsAnnual:'3学期始業式', periods:all(['学','学','1','2','','']) });
  set(nthWeekday(dkey(fy+1,2,1),5), { eventsMonthly:'道徳の授業公開', periods:all(['1','2','3','4','道','']) });
  return {
    formatVersion:7,
    meta:{ schoolName:'見本中学校', fiscalYear:fy },
    holidayOverrides:{},
    classCounts:{ g1:3, g2:3, g3:3 },
    days,
  };
}
ACTIONS.exportSampleEvents = ()=>{
  downloadText(JSON.stringify(makeSampleEventsFile(state.meta.fiscalYear, state), null, 2), '見本の行事予定_'+state.meta.fiscalYear+'年度.json');
};
