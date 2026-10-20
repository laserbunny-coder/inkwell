import { children } from './db.js';

// Plain Markdown, so the writing stays readable in any app even if this one breaks.

function inline(content) {
  if (!content) return '';
  return content.map((n) => {
    if (n.type === 'hardBreak') return '  \n';
    let t = n.text || '';
    for (const m of n.marks || []) {
      if (m.type === 'bold') t = `**${t}**`;
      if (m.type === 'italic') t = `*${t}*`;
      if (m.type === 'strike') t = `~~${t}~~`;
    }
    return t;
  }).join('');
}

export function chapterMarkdown(chapter, rows) {
  const out = [`## ${chapter.title}`, ''];
  for (const r of rows) {
    if (r.kind === 'scene') out.push(r.title ? `### ${r.title}` : '* * *', '');
    else if (r.kind === 'heading') out.push(`${'#'.repeat(Math.min((r.fields?.level || 2) + 1, 6))} ${inline(r.content)}`, '');
    else out.push(inline(r.content), '');
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

export async function bookMarkdown(project, acts) {
  const out = [`# ${project.title}`, ''];
  for (const act of acts) {
    out.push(`# ${act.title}`, '');
    for (const ch of act.chapters) out.push(chapterMarkdown(ch, await children(ch.id)), '');
  }
  return out.join('\n');
}

export function download(name, text) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'text/markdown' }));
  a.download = name.replace(/[\\/:*?"<>|]/g, '-');
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
