import { allEntries } from './db.js';
import { outline } from './model.js';
import { bookMarkdown, inline } from './export.js';
import { toFountain } from './script.js';
import { descendants } from './outline.js';
import { titleOf } from './notebook.js';

// The whole vault as one download: plain Markdown files in folders (Library >
// areas > books, daily pages, loose pages) that open in any app, plus
// vault.json with every entry exactly as stored, so nothing depends on this
// app alone.

const clean = (s) => (s || 'Untitled').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-').replace(/^\.+/, '').trim().slice(0, 80) || 'Untitled';

async function pageMarkdown(page) {
  const lines = await descendants(page.id);
  const depth = new Map([[page.id, -1]]);
  const out = [page.kind === 'day' ? `# ${titleOf(page)}` : `# ${page.title || 'Untitled'}`, ''];
  for (const l of lines) {
    const d = (depth.get(l.parent_id) ?? -1) + 1;
    depth.set(l.id, d);
    out.push(`${'  '.repeat(d)}- ${inline(l.content)}`);
  }
  return out.join('\n').trim() + '\n';
}

export async function vaultFiles() {
  const rows = await allEntries();
  const live = rows.filter((r) => !r.deleted);
  const areas = new Map(live.filter((r) => r.kind === 'area').map((a) => [a.id, a]));
  const used = new Set();
  const files = [];
  const add = (path, text) => {
    let p = path;
    for (let n = 2; used.has(p.toLowerCase()); n++) p = path.replace(/(\.\w+)$/, ` (${n})$1`);
    used.add(p.toLowerCase());
    files.push({ path: p, text });
  };
  const areaPath = (id) => {
    const parts = [];
    for (let a = areas.get(id), i = 0; a && i < 50; a = areas.get(a.parent_id), i++) parts.unshift(clean(a.title));
    return parts.length ? parts.join('/') : 'No area';
  };
  const pagesUnder = (pid) => live.filter((r) => r.kind === 'page' && r.parent_id === pid);

  for (const book of live.filter((r) => r.kind === 'project')) {
    const dir = `Library/${areaPath(book.area_id)}/${clean(book.title)}`;
    const acts = await outline(book.id);
    if (acts.length && book.fields?.type === 'screenplay') {
      const rows = [];
      for (const act of acts) for (const ch of act.chapters) rows.push(...live.filter((r) => r.parent_id === ch.id).sort((a, b) => a.sort - b.sort));
      add(`${dir}/${clean(book.title)}.fountain`, toFountain(book.title, rows));
    } else if (acts.length) add(`${dir}/${clean(book.title)}.md`, await bookMarkdown(book, acts));
    for (const p of pagesUnder(book.id)) add(`${dir}/${clean(p.title)}.md`, await pageMarkdown(p));
  }
  for (const p of pagesUnder(null)) add(`Loose pages/${clean(p.title)}.md`, await pageMarkdown(p));
  for (const d of live.filter((r) => r.kind === 'day').sort((a, b) => (a.title < b.title ? -1 : 1))) {
    const md = await pageMarkdown(d);
    if (md.includes('\n- ')) add(`Daily pages/${clean(d.title)}.md`, md);
  }
  add('vault.json', JSON.stringify({ exported_at: new Date().toISOString(), entries: live }, null, 1));
  return files;
}

export async function vaultZip() {
  return zip(await vaultFiles());
}

// A plain (uncompressed) .zip, which every computer and phone can open.
const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export function zip(files, when = new Date()) {
  const enc = new TextEncoder();
  const time = (when.getHours() << 11) | (when.getMinutes() << 5) | (when.getSeconds() >> 1);
  const date = ((when.getFullYear() - 1980) << 9) | ((when.getMonth() + 1) << 5) | when.getDate();
  const parts = [];
  const central = [];
  let offset = 0;
  for (const f of files) {
    const name = enc.encode(f.path);
    const data = enc.encode(f.text);
    const crc = crc32(data);
    const head = new DataView(new ArrayBuffer(30));
    head.setUint32(0, 0x04034b50, true);
    head.setUint16(4, 20, true);
    head.setUint16(6, 0x0800, true); // names are UTF-8
    head.setUint16(10, time, true);
    head.setUint16(12, date, true);
    head.setUint32(14, crc, true);
    head.setUint32(18, data.length, true);
    head.setUint32(22, data.length, true);
    head.setUint16(26, name.length, true);
    parts.push(head, name, data);
    const dir = new DataView(new ArrayBuffer(46));
    dir.setUint32(0, 0x02014b50, true);
    dir.setUint16(4, 20, true);
    dir.setUint16(6, 20, true);
    dir.setUint16(8, 0x0800, true);
    dir.setUint16(12, time, true);
    dir.setUint16(14, date, true);
    dir.setUint32(16, crc, true);
    dir.setUint32(20, data.length, true);
    dir.setUint32(24, data.length, true);
    dir.setUint16(28, name.length, true);
    dir.setUint32(42, offset, true);
    central.push(dir, name);
    offset += 30 + name.length + data.length;
  }
  const size = central.reduce((n, p) => n + p.byteLength, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, files.length, true);
  end.setUint16(10, files.length, true);
  end.setUint32(12, size, true);
  end.setUint32(16, offset, true);
  return new Blob([...parts, ...central, end], { type: 'application/zip' });
}
