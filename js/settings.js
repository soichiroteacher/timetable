'use strict';
// 「設定」タブ: 学校名・年度・学級数・曜日ごとの時限数・教科・編集パスワード・バックアップ

TABS.settings = {
  render(){
    const m = state.meta, d = dis();
    const dayRow = wd => {
      const day = m.days.find(x=>x.wd===wd);
      const n = day ? day.periods : 0;
      return '<label class="day-in">'+CONFIG.weekdays[wd]+' <select data-act-change="setPeriods" data-wd="'+wd+'"'+d+'>'
        + [0,1,2,3,4,5,6,7,8].map(k=>'<option value="'+k+'"'+(k===n?' selected':'')+'>'+(k?k+'時限':'なし')+'</option>').join('')
        + '</select></label>';
    };
    $('tab-settings').innerHTML = '<div class="settings">'
      + '<section><h2>学校</h2>'
      + '<div class="row"><span class="k">学校名</span><input type="text" data-path="meta.schoolName" value="'+esc(m.schoolName)+'" style="width:280px"'+d+'></div>'
      + '<div class="row"><span class="k">年度</span><input type="number" data-path="meta.fiscalYear" data-type="num" value="'+m.fiscalYear+'" style="width:100px"'+d+'> 年度</div>'
      + '</section>'
      + '<section><h2>学級数</h2><div class="row">'
      + m.grades.map((g,i)=>'<label>'+g.grade+'年 <input type="number" min="0" max="12" data-path="meta.grades.'+i+'.classes" data-type="num" value="'+g.classes+'" style="width:64px"'+d+'> 学級</label>').join('　')
      + '</div><p class="hint">特別支援学級は、今は数えていません(必要になったら相談してください)。</p></section>'
      + '<section><h2>1週間の時限(基本時間割)</h2><div class="row">'+[1,2,3,4,5,6].map(dayRow).join('')+'</div>'
      + '<p class="hint">時限を減らしても、入力した時間割は消えません(表に出なくなるだけです。元に戻すとまた出ます)。行事などで時間がずれる日は、「週の時間割」で行事予定の①〜⑥に合わせて表示します。</p></section>'
      + '<section><h2>教科</h2><p class="hint">「短い名前」は、学級の時間割の表に出る名前です。教員の時間割の「教科」の欄には、名前か短い名前のどちらを入れてもかまいません。</p>'
      + '<table class="grid"><thead><tr><th>名前</th><th>短い名前</th><th></th></tr></thead><tbody>'
      + state.subjects.map((s,i)=>'<tr><td><input type="text" data-path="subjects.'+i+'.name" value="'+esc(s.name)+'" style="width:160px"'+d+'></td>'
        + '<td><input type="text" data-path="subjects.'+i+'.short" value="'+esc(s.short)+'" style="width:80px"'+d+'></td>'
        + '<td><button class="small danger edit-act" data-act="delSubject" data-i="'+i+'"'+d+'>削除</button></td></tr>').join('')
      + '</tbody></table><div class="line"><button class="edit-act" data-act="addSubject"'+d+'>＋ 教科を追加</button></div></section>'
      + '<section><h2>編集パスワード</h2><p class="hint">決めておくと、「編集する」のときにパスワードを聞かれます。空のままならパスワードなしで編集できます。</p>'
      + '<div class="row"><span>'+(m.editPasswordHash?'パスワードあり':'パスワードなし')+'</span><button class="edit-act" data-act="setPassword"'+d+'>パスワードを変える</button></div></section>'
      + '<section><h2>バックアップ</h2><p class="hint">データファイルとは別に、今の状態をファイルに控えておけます。ファイル名に日付が入ります。</p>'
      + '<div class="line"><button data-act="exportBackup"'+(isSample?' disabled':'')+'>データを書き出す(バックアップ)</button>'
      + '<button class="edit-act" data-act="importBackup"'+(isSample?' disabled':d)+'>データを読み込む(復元)</button></div></section>'
      + '</div>';
    $('tab-settings').querySelectorAll('[data-act-change="setPeriods"]').forEach(sel=>sel.addEventListener('change', ()=>{
      if(!editing) return;
      const wd = Number(sel.dataset.wd), n = Number(sel.value);
      const days = state.meta.days.filter(x=>x.wd!==wd);
      if(n>0) days.push({ wd, periods:n });
      state.meta.days = days.sort((a,b)=>a.wd-b.wd);
      markDirty(); renderAll();
    }));
  }
};
ACTIONS.addSubject = ()=>{ state.subjects.push({ name:'', short:'' }); markDirty(); renderAll(); };
ACTIONS.delSubject = el=>{
  const s = state.subjects[Number(el.dataset.i)];
  const used = state.teachers.filter(t=>t.subject===s.name).length;
  if(!confirm('教科「'+(s.name||'(名前なし)')+'」を削除します。'+(used?'\n('+used+'人の先生の教科になっています。先生の教科の欄はそのまま残ります)':'')+'\nよろしいですか？')) return;
  state.subjects.splice(Number(el.dataset.i), 1); markDirty(); renderAll();
};
ACTIONS.setPassword = async ()=>{
  const p = prompt('新しいパスワードを入れてください。\n(空のまま「OK」を押すと、パスワードなしになります)', '');
  if(p===null) return;
  state.meta.editPasswordHash = p ? await sha256Hex(p) : '';
  markDirty(); renderAll();
  alert(p ? 'パスワードを変えました。忘れないように控えておいてください。' : 'パスワードなしにしました。');
};
ACTIONS.exportBackup = ()=>exportBackup();
ACTIONS.importBackup = ()=>importBackup();
