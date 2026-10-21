# Inkwell

A quiet, warm writing app for novels and screenplays, built to grow into a notebook and research vault.

Live at https://laserbunny-coder.github.io/inkwell/

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

## Notebook

⌘J switches between the manuscript and today's page. Every day has a page, and you can make named pages too. Pages are nested lines: Tab nests, Shift+Tab lifts. Type `[[` to link a page, day or chapter (or make a new page), and `#tag` to tag a line. Each page lists the lines that link to it, and the shelves (left edge) list pages, recent days and tags. Every line is its own entry, so it syncs, links and can be found like a manuscript paragraph.

## Library

Everything lives in the Library (⌘O jumps to anything by name; the left edge shows the whole tree). Areas can nest as deep as you like, e.g. Writing › Novels › Working. Each area holds books (novels) and notes collections. A new book starts with an Idea page. A book's home shows its manuscript, its pages and the lines from daily pages that link to it. Pages with no book yet are listed as loose pages until you move them. The daily page scrolls back through earlier days, and the app reopens wherever you last were.
