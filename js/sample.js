'use strict';
// 見本(架空の学校・先生)。動作確認と、はじめての人のお試し用。保存はされない。
// 時間割は、決まった手順(乱数の種を固定)で自動で組むので、毎回同じ見本になる。
// 実在の学校名・人名は使わない(先生は「名字＋先生」だけの架空の名前)。

// 1週間の教科ごとのコマ数(見本用。学年ごと)
const SAMPLE_HOURS = {
  1: { 国語:4, 社会:3, 数学:4, 理科:3, 音楽:1, 美術:1, 保健体育:3, 技術:1, 家庭:1, 外国語:4 },
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

function makeSample(){
  const s = emptyState(currentFiscalYear());
  s.meta.schoolName = '見本中学校';
  s.meta.grades = [ { grade:1, classes:3 }, { grade:2, classes:3 }, { grade:3, classes:3 } ];
  s.meta.days = [ { wd:1, periods:6 }, { wd:2, periods:6 }, { wd:3, periods:6 }, { wd:4, periods:6 }, { wd:5, periods:5 } ];
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
    return s;
  }
  throw new Error('見本の時間割を作れませんでした。');
}
