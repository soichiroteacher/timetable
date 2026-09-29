'use strict';
// タブの切り替え・見本・起動(ほかの js をすべて読み込んだあとに動かす)

document.querySelectorAll('nav.tabs button[data-tab]').forEach(b=> b.addEventListener('click', ()=>{
  if(!state) return;
  view.tab = b.dataset.tab; savePref(); renderAll();
}));
document.addEventListener('keydown', e=>{
  if(e.key==='Escape'){ document.querySelectorAll('.overlay.show').forEach(o=>o.classList.remove('show')); if(guideIdx>=0) endGuide(); }
  if((e.ctrlKey||e.metaKey) && e.key==='s'){ e.preventDefault(); doSave(); }
});
function loadSample(){
  state = makeSample(); fileHandle = null; isSample = true; editing = false; dirty = false;
  resetUndo();
  if(!TABS[view.tab] || !document.querySelector('nav.tabs [data-tab="'+view.tab+'"]')) view.tab = 'base';
  renderAll();
  setStatus('見本を表示しています(「編集する」で入力も試せます。保存はされません)', 'saved');
}
$('bnSample').addEventListener('click', loadSample);
$('bnGuide').addEventListener('click', startGuide);
$('btnHelp').addEventListener('click', startGuide);

async function boot(){
  if(!TABS[view.tab] || !document.querySelector('nav.tabs [data-tab="'+view.tab+'"]')) view.tab = 'base';
  renderAll();
  if(!supportsFSA){
    $('bnLast').hidden = false;
    $('bnLast').innerHTML = '<b style="color:var(--warn)">このブラウザでは、データファイルへの保存ができません。Chrome か Edge で開いてください。</b>';
    return;
  }
  // 前回のファイルがあれば、すぐ開けるようにする(ブラウザの決まりで、起動のたびに1回だけ許可のボタンが要る)
  let h; try{ h = await idbGet('lastFile'); }catch(e){}
  if(!h) return;
  try{
    if(await h.queryPermission({mode:'readwrite'}) === 'granted'){ await openHandle(h); return; }
  }catch(e){}
  $('bnLast').hidden = false;
  $('bnLast').innerHTML = '前回のファイル「'+esc(h.name)+'」を開くには、ここを押してください → <button class="primary" id="bnLastBtn">前回のファイルを開く</button>';
  $('bnLastBtn').addEventListener('click', async ()=>{
    try{
      if(await h.requestPermission({mode:'readwrite'}) !== 'granted') return;
      await openHandle(h);
    }catch(e){ alert('開けませんでした。ファイルが移動・削除されていないか確かめてください。\n'+e.message); }
  });
}
boot();
