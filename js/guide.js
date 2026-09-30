'use strict';
// 画面ガイド(はじめての人向けの使い方の案内)。画面の部品を1つずつ枠で囲んで説明する。
// 画面のボタンの名前や位置を変えたら、ここの説明も同時に直すこと(共通ルール)。

const GUIDE_STEPS = [
  { sel:'header.top', title:'上の帯',
    text:'今開いているデータの年度と学校名が出ます。見本を開いているときは「見本・保存されません」と出ます。右側に「編集する」「保存」「開く」「新規作成」のボタンがあります。' },
  { sel:'nav.tabs', title:'画面の切り替え',
    text:'「基本時間割」「週時間割」「時数」「設定」の4つの画面があります。ここを押して切り替えます。' },
  { tab:'base', mode:'teacher', sel:'#baseSeg', title:'「教員」と「生徒」の切り替え',
    text:'基本時間割の画面では、ここで「教員」(先生ごとの時間割。ここに入力します)と「生徒」(学級ごとの時間割。自動でできます)を切り替えます。'},
  { tab:'base', mode:'teacher', sel:'#tGrid', title:'基本時間割の「教員」(ここに入力します)',
    text:'縦が先生、横が曜日と時限です。マスには、その時間に授業をする学級を「1-2」(1年2組)のように入れます。担任の先生の行に「道徳」「学活」「総合」と書くと、その先生の学級の授業になります。' },
  { sel:'#btnEdit', title:'直すときは「編集する」',
    text:'はじめは見るだけの状態です。直すときはここを押して、名前を入れてから始めます。終わったら同じボタン(「編集を終える」になります)を押すと保存されます。見本でも入力を試せます(見本は保存されません)。' },
  { tab:'base', mode:'teacher', sel:'#tIssues', title:'確認が必要なところ',
    text:'同じ学級の同じ時間に違う教科が重なっていたり、授業の入っていないコマがあったりすると、ここに出ます。表の中の、関係するマスにも色が付きます。' },
  { tab:'base', mode:'teacher', sel:'[data-act="importXlsx"]', title:'Excel から読み込む',
    text:'今お使いの時間割の Excel(A列に「担当」の見出しがある形)から、先生と時間割をまとめて取り込めます。試すときは、となりの「Excel に書き出す」で見本の Excel を作り、それを読み込んでみてください。' },
  { tab:'base', mode:'class', sel:'#cGrid', title:'基本時間割の「生徒」(自動でできます)',
    text:'「教員」の表から、学級ごとの時間割が自動でできます。マスにマウスを乗せると、授業をする先生の名前が出ます。直すときは「基本時間割」の「教員」で直します。' },
  { tab:'base', mode:'class', sel:'#cCounts', title:'1週間のコマ数',
    text:'学級ごとに、教科ごとの1週間のコマ数を数えています。合計が1週間の時限の数より少ないときは、授業の入っていないコマがあります。' },
  { tab:'week', sel:'[data-act="importEvents"]', title:'週時間割: 行事予定を読み込む',
    text:'行事予定アプリのデータファイルを読み込むと、その①〜⑥に合わせて週ごとの時間割ができます(行事予定のファイルは書き換えません)。見本では、見本の行事予定を読み込んだ状態になっています。'},
  { tab:'week', sel:'#wNav', title:'週を選ぶ',
    text:'「前の週」「次の週」や日付で、見る週を選びます。上の「教員」「生徒」で表を切り替えられます。'},
  { tab:'week', sel:'#wGrid', title:'週時間割',
    text:'青いマスは、行事のために時間を入れ替えた授業です(マウスを乗せると、基本の何時間目の授業かが出ます)。緑は行事、灰色は休みです。同じ先生が同じ時間に2か所の授業に入ってしまうときは、オレンジ色になり、上に出ます。'},
  { tab:'week', sel:'#wHowto', title:'この週だけ時間割を変える',
    text:'出張などで授業を入れ替えるときは、「編集する」を押してから、「生徒」の表のマスに教科(「数」「英」など)を入れます。先生は基本の時間割から自動で決まります。変えたマスは太い枠になり、表の下に一覧が出ます。Delete で元に戻ります。'},
  { tab:'week', sel:'[data-act="proposeFlex"]', title:'変動枠の案を作る',
    text:'「設定」で変動枠(学年一斉で週ごとに教科を入れ替えるコマ)を決めておくと、ここで、この週から年度末までの中身を、時数の足りない教科から自動で決められます(先生が重ならないように組みます)。見本では1年の火曜6時間目が変動枠です。案はマスに教科を入れて直せます。'},
  { tab:'hours', sel:'#hTable', title:'時数(実績と予測)',
    text:'週時間割から、学級ごと・教科ごとの時数を数えます。基準日より前が「実績」、あとが「予定」で、上の段の必要時数と比べて、足りない教科は赤、足りている教科は緑になります。数字の下は必要時数との差です。基準日や表示(実績だけ・これからの予定だけ)は上で切り替えます。'},
  { tab:'settings', sel:'#tab-settings', title:'設定',
    text:'学級数、曜日ごとの時限の数、教科、編集のパスワードを決めます。「データを書き出す(バックアップ)」で、今の状態をファイルに控えておけます。' },
  { sel:'#btnHelp', title:'案内はいつでも見られます',
    text:'この案内は、ここを押すといつでも見られます。自分の学校のデータを作るときは、「新規作成」から始めてください。' },
];
let guideIdx = -1;
function startGuide(){
  if(!state){ loadSample(); }
  view.weekMode = 'class';   // 週時間割の案内は、「生徒」の表で説明するため
  guideIdx = 0; showGuideStep();
}
function endGuide(){ guideIdx = -1; $('guide').hidden = true; }
function showGuideStep(){
  const st = GUIDE_STEPS[guideIdx];
  if(!st){ endGuide(); return; }
  if(st.tab && (view.tab!==st.tab || (st.mode && view.baseMode!==st.mode))){ view.tab = st.tab; if(st.mode) view.baseMode = st.mode; savePref(); renderAll(); }
  const el = document.querySelector(st.sel);
  $('guide').hidden = false;
  $('gTitle').textContent = (guideIdx+1)+' / '+GUIDE_STEPS.length+'　'+st.title;
  $('gText').textContent = st.text;
  $('gPrev').disabled = guideIdx===0;
  $('gNext').textContent = guideIdx===GUIDE_STEPS.length-1 ? '終わる' : '次へ';
  const box = $('gBox'), bub = $('gBubble'), dim = $('gDim');
  if(!el){ box.hidden = true; dim.style.clipPath = ''; bub.style.left = '50%'; bub.style.top = '120px'; bub.style.transform = 'translateX(-50%)'; return; }
  // 表などの大きな部品は、上の端が見えるように置く(真ん中に合わせると、見出しが画面の外に出てしまうため)
  el.scrollIntoView({ block: el.offsetHeight > window.innerHeight*0.5 ? 'start' : 'center', inline:'nearest' });
  requestAnimationFrame(()=>{
    const r = el.getBoundingClientRect();
    // 大きすぎる部品(表など)は、見えている範囲だけを囲む
    const top = Math.max(r.top, 4), bottom = Math.min(r.bottom, window.innerHeight-4);
    const left = Math.max(r.left, 4), right = Math.min(r.right, window.innerWidth-4);
    const x1 = left-6, y1 = top-6, x2 = right+6, y2 = bottom+6;
    box.hidden = false;
    Object.assign(box.style, { left:x1+'px', top:y1+'px', width:(x2-x1)+'px', height:(y2-y1)+'px' });
    // 囲んだところだけ暗くしない(暗い幕に穴をあける)
    dim.style.clipPath = 'polygon(evenodd, 0 0, 100% 0, 100% 100%, 0 100%, 0 0, '+x1+'px '+y1+'px, '+x2+'px '+y1+'px, '+x2+'px '+y2+'px, '+x1+'px '+y2+'px, '+x1+'px '+y1+'px)';
    bub.style.transform = '';
    const bw = Math.min(460, window.innerWidth-20);
    bub.style.width = bw+'px';
    const bh = bub.offsetHeight || 170;
    if(y2 + 10 + bh < window.innerHeight){ bub.style.top = (y2+10)+'px'; bub.style.left = Math.max(10, Math.min(left, window.innerWidth-bw-10))+'px'; }
    else if(y1 - 10 - bh > 0){ bub.style.top = (y1-10-bh)+'px'; bub.style.left = Math.max(10, Math.min(left, window.innerWidth-bw-10))+'px'; }
    else { bub.style.top = (window.innerHeight-bh-16)+'px'; bub.style.left = (window.innerWidth-bw-24)+'px'; } // 上にも下にも入らないときは、右下の角に
  });
}
$('gNext').addEventListener('click', ()=>{ guideIdx++; showGuideStep(); });
$('gPrev').addEventListener('click', ()=>{ if(guideIdx>0){ guideIdx--; showGuideStep(); } });
$('gClose').addEventListener('click', endGuide);
window.addEventListener('resize', ()=>{ if(guideIdx>=0) showGuideStep(); });
