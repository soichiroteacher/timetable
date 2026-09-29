'use strict';
// Excel のように使える表(セル選択・範囲選択・コピー/貼り付け・キーボード操作・日本語入力)。
// ../school-events(行事予定)の実績タブの createActGrid をもとに、列の数や見出しを自由に決められるようにしたもの。
//
// createGrid({
//   wrap: 表を入れる要素,
//   cols: [{ label, group, sticky, width, first }]  列。group が変わるところで上の見出しを分ける。sticky は左に固定する列
//   rows: 行の数,
//   cell(r,c) -> { text, cls, title }  そのマスに表示する内容
//   commit([{ r, c, val }])  入力・貼り付け・削除されたときに呼ばれる(呼んだあと表を描き直す)
//   editable() -> 入力してよいか
//   listId: 入力の候補(datalist)の id
//   onSelect(r,c): 選んでいるマスが変わったとき
// })
function createGrid(o){
  const R = o.rows, C = o.cols.length;
  const st = { ar:0, ac:0, fr:0, fc:0, editing:false, mode:null, touched:false, dragging:false };
  // 左に固定する列の位置(左端からの距離)を計算しておく
  let left = 0; const lefts = o.cols.map(col=>{ const l = left; if(col.sticky) left += parseFloat(col.width)||4; return l; });
  const colStyle = (col, i)=> 'style="width:'+col.width+';min-width:'+col.width+';max-width:'+col.width+(col.sticky?';left:'+lefts[i]+'em':'')+'"';
  const colCls = (col, i)=> (col.sticky?' g-sticky':'') + (col.first?' g-first':'') + (col.sticky && !(o.cols[i+1]||{}).sticky ? ' g-sticky-last':'');

  let html = '<div class="g-scroll"><table class="g-table"><thead><tr>';
  // 上の見出し(曜日など)。同じ group が続く列はまとめる
  for(let i=0; i<C; ){
    const col = o.cols[i];
    let j = i; while(!col.sticky && j+1<C && !o.cols[j+1].sticky && o.cols[j+1].group===col.group && !o.cols[j+1].first) j++;
    if(col.sticky) html += '<th rowspan="2" class="g-head'+colCls(col,i)+'" '+colStyle(col,i)+'>'+esc(col.label)+'</th>';
    else html += '<th colspan="'+(j-i+1)+'" class="g-group'+(col.first?' g-first':'')+'">'+esc(col.group||'')+'</th>';
    i = j+1;
  }
  html += '</tr><tr class="g-head2">';
  o.cols.forEach((col,i)=>{ if(!col.sticky) html += '<th class="'+colCls(col,i)+'" '+colStyle(col,i)+'>'+esc(col.label)+'</th>'; });
  html += '</tr></thead><tbody>';
  for(let r=0; r<R; r++){
    html += '<tr>';
    for(let c=0; c<C; c++) html += '<td class="g-cell'+colCls(o.cols[c],c)+'" '+colStyle(o.cols[c],c)+' data-r="'+r+'" data-c="'+c+'"></td>';
    html += '</tr>';
  }
  html += '</tbody></table><input type="text" class="g-editor"'+(o.listId?' list="'+o.listId+'"':'')+' autocomplete="off" spellcheck="false"></div>';
  o.wrap.innerHTML = html;
  const scroll = o.wrap.querySelector('.g-scroll');
  const editor = o.wrap.querySelector('.g-editor');
  const cells = Array.from({length:R}, ()=>[]);
  o.wrap.querySelectorAll('td.g-cell').forEach(td=>{ cells[+td.dataset.r][+td.dataset.c] = td; });
  const baseCls = o.cols.map((col,i)=>'g-cell'+colCls(col,i));

  function refresh(){
    for(let r=0; r<R; r++) for(let c=0; c<C; c++){
      const info = o.cell(r,c), td = cells[r][c];
      td.className = baseCls[c] + (info.cls?' '+info.cls:'');
      td.textContent = info.text || '';
      td.title = info.title || '';
    }
    paint();
  }
  let painted = [];
  function bounds(){ return { r0:Math.min(st.ar,st.fr), r1:Math.max(st.ar,st.fr), c0:Math.min(st.ac,st.fc), c1:Math.max(st.ac,st.fc) }; }
  function paint(){
    if(!R) return;
    painted.forEach(td=>td.classList.remove('g-sel','g-active'));
    painted = [];
    const b = bounds();
    for(let r=b.r0; r<=b.r1; r++) for(let c=b.c0; c<=b.c1; c++){ cells[r][c].classList.add('g-sel'); painted.push(cells[r][c]); }
    cells[st.fr][st.fc].classList.add('g-active');
    placeEditor();
  }
  function placeEditor(){
    if(!R) return;
    const td = cells[st.fr][st.fc];
    const sr = scroll.getBoundingClientRect(), tr = td.getBoundingClientRect();
    editor.style.left = (tr.left - sr.left + scroll.scrollLeft - scroll.clientLeft) + 'px';
    editor.style.top = (tr.top - sr.top + scroll.scrollTop - scroll.clientTop) + 'px';
    editor.style.width = Math.max(tr.width, 64) + 'px';
    editor.style.height = tr.height + 'px';
  }
  function setSel(r, c, extend){
    r = Math.max(0, Math.min(R-1, r)); c = Math.max(0, Math.min(C-1, c));
    st.fr = r; st.fc = c;
    if(!extend){ st.ar = r; st.ac = c; }
    paint();
    // 左に固定した列の下に隠れないよう、固定していない列は固定列の幅だけ余裕をとって見える位置へ動かす
    const td = cells[r][c];
    if(!o.cols[c].sticky){
      const stickyW = [...scroll.querySelectorAll('thead th.g-sticky')].reduce((a,th)=>a+th.offsetWidth, 0);
      if(td.offsetLeft - scroll.scrollLeft < stickyW) scroll.scrollLeft = td.offsetLeft - stickyW;
      else if(td.offsetLeft + td.offsetWidth > scroll.scrollLeft + scroll.clientWidth) scroll.scrollLeft = td.offsetLeft + td.offsetWidth - scroll.clientWidth;
    }
    td.scrollIntoView({ block:'nearest', inline:'nearest' });
    placeEditor();
    if(o.listFor) editor.setAttribute('list', o.listFor(c) || '');
    if(o.onSelect) o.onSelect(r, c);
  }
  function commitValues(list){
    if(!o.editable() || list.length===0) return;
    o.commit(list);
  }
  function startEdit(mode, initial){
    if(!o.editable()) return;
    st.editing = true; st.mode = mode; st.touched = mode!=='pick';
    editor.value = initial;
    editor.classList.add('editing');
    placeEditor();
    const len = editor.value.length; editor.setSelectionRange(len, len);
  }
  function endEdit(commit){
    if(!st.editing) return;
    const v = editor.value, touched = st.touched;
    st.editing = false; st.mode = null;
    editor.classList.remove('editing'); editor.value = '';
    if(commit && touched) commitValues([{ r:st.fr, c:st.fc, val:v }]);
  }
  function selectionTSV(){
    const b = bounds(), lines = [];
    for(let r=b.r0; r<=b.r1; r++){
      const row = [];
      for(let c=b.c0; c<=b.c1; c++) row.push(o.cell(r,c).text || '');
      lines.push(row.join('\t'));
    }
    return lines.join('\n');
  }
  function clearRange(){
    const b = bounds(), list = [];
    for(let r=b.r0; r<=b.r1; r++) for(let c=b.c0; c<=b.c1; c++) list.push({ r, c, val:'' });
    commitValues(list);
  }
  function pasteText(text){
    const lines = String(text).replace(/\r/g,'').split('\n');
    if(lines.length>1 && lines[lines.length-1]==='') lines.pop();
    const block = lines.map(l=>l.split('\t'));
    const b = bounds(), list = [];
    if(block.length===1 && block[0].length===1){
      // 1つの値は、選択範囲すべてに入れる(Excelで1セルをコピーして範囲に貼り付けるのと同じ)
      for(let r=b.r0; r<=b.r1; r++) for(let c=b.c0; c<=b.c1; c++) list.push({ r, c, val:block[0][0] });
    } else {
      const w = Math.max(...block.map(x=>x.length));
      block.forEach((row,i)=>row.forEach((v,j)=>{ const r=b.r0+i, c=b.c0+j; if((r<R || o.growRows) && c<C) list.push({ r, c, val:v }); }));
      st.ar = b.r0; st.ac = b.c0; st.fr = Math.min(R-1, b.r0+block.length-1); st.fc = Math.min(C-1, b.c0+w-1);
    }
    commitValues(list);
  }

  editor.addEventListener('focus', ()=>{ o.wrap.classList.add('g-focused'); placeEditor(); });
  editor.addEventListener('blur', ()=>{ endEdit(true); o.wrap.classList.remove('g-focused'); });
  editor.addEventListener('input', ()=>{
    if(st.editing){ st.touched = true; return; }
    if(!o.editable()){ editor.value = ''; return; }
    // 選択中のマスで文字を打ち始めたら、その内容で上書き入力を始める
    st.editing = true; st.mode = 'enter'; st.touched = true;
    editor.classList.add('editing');
    placeEditor();
  });
  editor.addEventListener('compositionstart', ()=>{
    if(st.editing || !o.editable()) return;
    st.editing = true; st.mode = 'enter'; st.touched = true;
    editor.value = '';
    editor.classList.add('editing');
    placeEditor();
  });
  editor.addEventListener('keydown', e=>{
    if(e.isComposing || e.keyCode===229) return;
    const ctrl = e.ctrlKey || e.metaKey;
    if(ctrl){
      const k = e.key.toLowerCase();
      if(k==='z' && !st.editing){ e.preventDefault(); if(e.shiftKey) doRedo(); else doUndo(); }
      else if(k==='y' && !st.editing){ e.preventDefault(); doRedo(); }
      else if(k==='a' && !st.editing){ e.preventDefault(); st.ar=0; st.ac=0; st.fr=R-1; st.fc=C-1; paint(); }
      return; // コピー・切り取り・貼り付けは下の clipboard のイベントで扱う
    }
    const arrows = { ArrowUp:[-1,0], ArrowDown:[1,0], ArrowLeft:[0,-1], ArrowRight:[0,1] };
    if(st.editing){
      if(e.key==='Enter'){ e.preventDefault(); endEdit(true); setSel(st.fr+(e.shiftKey?-1:1), st.fc, false); }
      else if(e.key==='Tab'){ e.preventDefault(); endEdit(true); setSel(st.fr, st.fc+(e.shiftKey?-1:1), false); }
      else if(e.key==='Escape'){ e.preventDefault(); endEdit(false); }
      else if(arrows[e.key] && st.mode==='enter'){ e.preventDefault(); endEdit(true); setSel(st.fr+arrows[e.key][0], st.fc+arrows[e.key][1], false); }
      return;
    }
    if(arrows[e.key]){ e.preventDefault(); setSel(st.fr+arrows[e.key][0], st.fc+arrows[e.key][1], e.shiftKey); }
    else if(e.key==='Enter'){ e.preventDefault(); setSel(st.fr+(e.shiftKey?-1:1), st.fc, false); }
    else if(e.key==='Tab'){ e.preventDefault(); setSel(st.fr, st.fc+(e.shiftKey?-1:1), false); }
    else if(e.key==='Home'){ e.preventDefault(); setSel(st.fr, 0, e.shiftKey); }
    else if(e.key==='End'){ e.preventDefault(); setSel(st.fr, C-1, e.shiftKey); }
    else if(e.key==='F2'){ e.preventDefault(); startEdit('edit', o.cell(st.fr, st.fc).text || ''); }
    else if(e.key==='Delete' || e.key==='Backspace'){ e.preventDefault(); clearRange(); }
  });
  editor.addEventListener('copy', e=>{ if(st.editing) return; e.preventDefault(); e.clipboardData.setData('text/plain', selectionTSV()); });
  editor.addEventListener('cut', e=>{ if(st.editing) return; e.preventDefault(); e.clipboardData.setData('text/plain', selectionTSV()); clearRange(); });
  editor.addEventListener('paste', e=>{
    if(st.editing) return;
    e.preventDefault();
    if(!o.editable()){ alert('直すときは、上の「✏ 編集する」を押してください。'); return; }
    pasteText(e.clipboardData.getData('text'));
  });
  scroll.addEventListener('mousedown', e=>{
    if(e.target===editor) return;
    const td = e.target.closest('td.g-cell');
    if(!td) return;
    e.preventDefault();
    if(st.editing) endEdit(true);
    setSel(+td.dataset.r, +td.dataset.c, e.shiftKey);
    st.dragging = true;
    editor.focus({ preventScroll:true });
  });
  scroll.addEventListener('mouseover', e=>{
    if(!st.dragging) return;
    if(e.buttons!==1){ st.dragging = false; return; }
    const td = e.target.closest('td.g-cell');
    if(!td) return;
    st.fr = +td.dataset.r; st.fc = +td.dataset.c;
    paint();
  });
  scroll.addEventListener('dblclick', e=>{
    if(!e.target.closest('td.g-cell')) return;
    // ダブルクリックでは今の文字のまま入力を始め、候補の一覧も選べるようにする
    startEdit('edit', o.cell(st.fr, st.fc).text || '');
    editor.focus({ preventScroll:true });
  });
  document.addEventListener('mouseup', ()=>{ st.dragging = false; });
  refresh();
  return {
    refresh, pasteText,
    get sel(){ return { ...st, ...bounds() }; },
    select(r, c){ setSel(r, c, false); editor.focus({ preventScroll:true }); },
    focus(){ editor.focus({ preventScroll:true }); },
    scrollEl: scroll,
  };
}
