# Writing

A quiet, warm writing app for novels and screenplays, built to grow into a notebook and research vault.

When you write, the screen shows only your text. Everything else is a hover or a keystroke away:

- Touch the **left edge** for the outline (acts, chapters, scenes). `⌘1` keeps it open. Double-click a name to rename it.
- Touch the **top edge** for the title, word count and save status.
- `⌘K` opens one menu for every command.
- `⌘2` shows notes beside the text, each lined up with its paragraph. `⌘⇧N` adds a note to the paragraph you're in.
- `⌘⇧↵` adds a scene break inside a chapter.
- `⌘⇧H` opens earlier versions of the chapter. A version is kept every time you pause typing.
- `⌘⇧L` switches light and dark.

## How it's built

- [Tiptap](https://tiptap.dev) (on ProseMirror) is the editor. Plain JavaScript, built with [Vite](https://vite.dev).
- **Everything is an entry.** Projects, acts, chapters, every paragraph, scene breaks and notes are all rows of one shape (`src/model.js`) with a stable id, tags (`#words` in the text) and room for links and typed fields. Daily-page lines and vault captures will use the same shape, so anything can link to anything.
- **Saving never loses text** (`src/chapter.js`). Each change is written at once to a local write-ahead copy, then only the changed paragraphs are saved to the browser's database (IndexedDB). If the tab dies mid-save, the write-ahead copy is picked up on the next open.
- **Past versions** live in their own store so they never slow down the draft.
- It installs to the home screen and works offline (`public/sw.js`).
- Export any chapter or the whole book as Markdown from `⌘K`.

Cloud sync between devices (Supabase, shared with Daybook) comes next.

## Run it

```
npm install
npm run dev
```

`npm test` builds the app and runs the browser checks in `tests/run.mjs`.

Every push to `main` is tested and published to GitHub Pages by `.github/workflows/deploy.yml`.
