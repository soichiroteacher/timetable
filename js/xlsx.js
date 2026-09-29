'use strict';
// Excel(.xlsx)の書き出し。外部ライブラリを使わず、xlsx の中身(XML)を ZIP にまとめて作る。
// ../exam-manager(定期テスト)の js/xlsx.js をそのまま写したもの。ZIP の作り方は ../school-events(行事予定)の buildZipStore と同じ(圧縮しない「格納」だけの ZIP)。
// 使い方: downloadXlsx('名前.xlsx', [{ name:'シート名', rows:[[...], ...], colWidths:[8,6,...], headerRows:1 }])
//   セルは 文字 / 数 / null(空)。1行目(headerRows 行)は見出しとして太字・色付きにし、固定して表示する。

const XLSX_CRC_TABLE = (()=>{ const t = new Uint32Array(256); for(let n=0;n<256;n++){ let c=n; for(let k=0;k<8;k++) c = (c&1) ? (0xEDB88320 ^ (c>>>1)) : (c>>>1); t[n]=c>>>0; } return t; })();
function xlsxCrc32(bytes){ let c = 0xFFFFFFFF; for(let i=0;i<bytes.length;i++) c = XLSX_CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
function xlsxZip(files){
  const enc = new TextEncoder(), d = new Date();
  const time = ((d.getHours()&0x1F)<<11) | ((d.getMinutes()&0x3F)<<5) | ((d.getSeconds()>>1)&0x1F);
  const date = (((d.getFullYear()-1980)&0x7F)<<9) | (((d.getMonth()+1)&0xF)<<5) | (d.getDate()&0x1F);
  const locals = [], centrals = []; let offset = 0;
  files.forEach(f=>{
    const name = enc.encode(f.name), data = typeof f.data==='string' ? enc.encode(f.data) : f.data;
    const crc = xlsxCrc32(data), size = data.length;
    const lo = new Uint8Array(30 + name.length), lv = new DataView(lo.buffer);
    lv.setUint32(0, 0x04034b50, true); lv.setUint16(4, 20, true); lv.setUint16(6, 0x0800, true); /* 名前は UTF-8 */ lv.setUint16(8, 0, true);
    lv.setUint16(10, time, true); lv.setUint16(12, date, true); lv.setUint32(14, crc, true); lv.setUint32(18, size, true); lv.setUint32(22, size, true);
    lv.setUint16(26, name.length, true); lv.setUint16(28, 0, true); lo.set(name, 30);
    locals.push(lo, data);
    const ce = new Uint8Array(46 + name.length), cv = new DataView(ce.buffer);
    cv.setUint32(0, 0x02014b50, true); cv.setUint16(4, 20, true); cv.setUint16(6, 20, true); cv.setUint16(8, 0x0800, true); cv.setUint16(10, 0, true);
    cv.setUint16(12, time, true); cv.setUint16(14, date, true); cv.setUint32(16, crc, true); cv.setUint32(20, size, true); cv.setUint32(24, size, true);
    cv.setUint16(28, name.length, true); cv.setUint32(42, offset, true); ce.set(name, 46);
    centrals.push(ce);
    offset += lo.length + size;
  });
  const cSize = centrals.reduce((a,p)=>a+p.length, 0);
  const end = new Uint8Array(22), ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true); ev.setUint16(8, files.length, true); ev.setUint16(10, files.length, true); ev.setUint32(12, cSize, true); ev.setUint32(16, offset, true);
  const out = new Uint8Array(offset + cSize + 22); let p = 0;
  locals.concat(centrals, [end]).forEach(part=>{ out.set(part, p); p += part.length; });
  return out;
}
function xlsxEsc(s){ return String(s).replace(/[&<>"]/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])).replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, ''); }
function xlsxCol(n){ let s=''; while(n>0){ const m=(n-1)%26; s=String.fromCharCode(65+m)+s; n=Math.floor((n-1)/26); } return s; }
// スタイル: 0=ふつう 1=見出し(太字・灰色・罫線) 2=本文(罫線)
const XLSX_STYLES = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
  + '<fonts count="2"><font><sz val="11"/><name val="游ゴシック"/></font><font><b/><sz val="11"/><name val="游ゴシック"/></font></fonts>'
  + '<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE8E8E8"/></patternFill></fill></fills>'
  + '<borders count="2"><border/><border><left style="thin"/><right style="thin"/><top style="thin"/><bottom style="thin"/></border></borders>'
  + '<cellStyleXfs count="1"><xf/></cellStyleXfs>'
  + '<cellXfs count="3"><xf/><xf fontId="1" fillId="2" borderId="1" applyFont="1" applyFill="1" applyBorder="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf><xf borderId="1" applyBorder="1"/></cellXfs>'
  + '</styleSheet>';
function xlsxSheet(sh){
  const hr = sh.headerRows || 0;
  const rows = sh.rows.map((r, i)=>'<row r="'+(i+1)+'">'+r.map((v, j)=>{
    const ref = xlsxCol(j+1)+(i+1), s = i < hr ? 1 : 2;
    if(v==null || v==='') return '<c r="'+ref+'" s="'+s+'"/>';
    if(typeof v==='number' && isFinite(v)) return '<c r="'+ref+'" s="'+s+'"><v>'+v+'</v></c>';
    return '<c r="'+ref+'" s="'+s+'" t="inlineStr"><is><t>'+xlsxEsc(v)+'</t></is></c>';
  }).join('')+'</row>').join('');
  const cols = sh.colWidths ? '<cols>'+sh.colWidths.map((w,i)=>'<col min="'+(i+1)+'" max="'+(i+1)+'" width="'+w+'" customWidth="1"/>').join('')+'</cols>' : '';
  const pane = hr ? '<sheetViews><sheetView workbookViewId="0"><pane ySplit="'+hr+'" topLeftCell="A'+(hr+1)+'" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>' : '';
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
    + pane + cols + '<sheetData>'+rows+'</sheetData><pageSetup paperSize="8" orientation="landscape"/></worksheet>';
}
function buildXlsx(sheets){
  const safe = sheets.map((sh,i)=>({ ...sh, name: (String(sh.name||('Sheet'+(i+1))).replace(/[\[\]:*?\/\\]/g,'').slice(0,31)) || ('Sheet'+(i+1)) }));
  const files = [
    { name:'[Content_Types].xml', data:'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
      + safe.map((s,i)=>'<Override PartName="/xl/worksheets/sheet'+(i+1)+'.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>').join('')
      + '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>' },
    { name:'_rels/.rels', data:'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>' },
    { name:'xl/workbook.xml', data:'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>'
      + safe.map((s,i)=>'<sheet name="'+xlsxEsc(s.name)+'" sheetId="'+(i+1)+'" r:id="rId'+(i+1)+'"/>').join('') + '</sheets></workbook>' },
    { name:'xl/_rels/workbook.xml.rels', data:'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
      + safe.map((s,i)=>'<Relationship Id="rId'+(i+1)+'" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet'+(i+1)+'.xml"/>').join('')
      + '<Relationship Id="rId'+(safe.length+1)+'" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>' },
    { name:'xl/styles.xml', data:XLSX_STYLES },
  ].concat(safe.map((s,i)=>({ name:'xl/worksheets/sheet'+(i+1)+'.xml', data:xlsxSheet(s) })));
  return xlsxZip(files);
}
function downloadXlsx(fileName, sheets){
  downloadBlob(new Blob([buildXlsx(sheets)], { type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), fileName);
}
