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
  // 覚えているデータのフォルダから、一番新しい年度のファイルを開く(js/folder.js)。
  // ブラウザの決まりで、許可が切れているときは、ボタンを押してもらってから開く
  let d; try{ d = await idbGet('dataDir'); }catch(e){}
  if(!d){
    // 以前の版(ファイルを直接開いていた版)を使っていた人への案内
    let old; try{ old = await idbGet('lastFile'); }catch(e){}
    if(old) showBanner('使い方が変わりました。これからは、データファイルが入っている<b>フォルダ</b>を選んで使います。前回のファイル「'+esc(old.name)+'」が入っているフォルダを、「データのフォルダを選ぶ」で選んでください。');
    return;
  }
  dataDir = d;
  if(await dirPermission(d, false)){ await openFromDir(); return; }
  showBanner('データのフォルダ「'+esc(d.name)+'」を開くには、ここを押してください → <button class="primary" id="bnDirBtn">データのフォルダを開く</button>');
  $('bnDirBtn').addEventListener('click', async ()=>{
    if(!(await dirPermission(d, true))){ alert('フォルダを開く許可がありませんでした。もう一度押すか、「データのフォルダを選ぶ」で選び直してください。'); return; }
    await openFromDir();
  });
}
boot();
