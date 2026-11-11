// Snapshots of links shared into Inkwell: the page's title, its picture (kept
// in the person's writing-files folder, so it outlives the page) and a short
// summary from Claude, so a saved link is still useful if the page disappears.
import Anthropic from "npm:@anthropic-ai/sdk@0.133.0";
import { admin, json } from "../_shared/common.ts";
import { tagFor } from "./enrich.ts";

const PAGE_LIMIT = 3 * 1024 * 1024;
const IMAGE_LIMIT = 8 * 1024 * 1024;
const UA = "Mozilla/5.0 (compatible; InkwellSnapshot/1.0; +https://laserbunny-coder.github.io/inkwell/)";

// Only ordinary public web addresses: nothing on this machine or a private network.
function allowed(u: URL): boolean {
  if (!["http:", "https:"].includes(u.protocol)) return false;
  const h = u.hostname.toLowerCase();
  if (h === "localhost" || h.endsWith(".local") || h.endsWith(".internal") || !h.includes(".")) return false;
  if (/^(127\.|10\.|0\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(h)) return false;
  if (h.startsWith("[") || h.includes(":")) return false;
  return true;
}

// YouTube shows servers a "Before you continue" consent page unless told the
// choice was already made.
const YOUTUBE = /(^|\.)(youtube\.com|youtu\.be|youtube-nocookie\.com)$/i;
const headersFor = (u: URL, accept: string): Record<string, string> => ({ "User-Agent": UA, Accept: accept, ...(YOUTUBE.test(u.hostname) ? { Cookie: "SOCS=CAI; CONSENT=YES+" } : {}) });

async function fetchLimited(url: string, limit: number, accept: string): Promise<{ res: Response; bytes: Uint8Array; at: URL } | null> {
  let at = new URL(url);
  for (let hop = 0; hop < 5; hop++) {
    if (!allowed(at)) return null;
    const res = await fetch(at, { headers: headersFor(at, accept), redirect: "manual", signal: AbortSignal.timeout(12000) });
    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) { at = new URL(res.headers.get("location")!, at); continue; }
    if (!res.ok || !res.body) return null;
    const reader = res.body.getReader();
    const parts: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > limit) { reader.cancel(); return null; }
      parts.push(value);
    }
    const bytes = new Uint8Array(size);
    let o = 0;
    for (const p of parts) { bytes.set(p, o); o += p.length; }
    return { res, bytes, at };
  }
  return null;
}

const decode = (s: string) => s.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16))).replace(/\s+/g, " ").trim();

function meta(html: string, keys: string[]): string {
  for (const key of keys) {
    const re = new RegExp(`<meta[^>]+(?:property|name)=["']${key}["'][^>]*>`, "i");
    const tag = html.match(re)?.[0];
    const m = tag?.match(/content=(?:"([^"]*)"|'([^']*)')/i);
    const content = m?.[1] ?? m?.[2];
    if (content) return decode(content);
  }
  return "";
}

function readable(html: string): string {
  return decode(html.replace(/<(script|style|noscript|svg|nav|footer|header)[\s\S]*?<\/\1>/gi, " ").replace(/<[^>]+>/g, " ")).slice(0, 12000);
}

// Video sites say what a video is through oEmbed, which works even when the
// page itself is a wall of script or a consent screen. X and TikTok pages are
// all script to a server too; their own oEmbed gives the post's words and who
// posted it.
export const X_POST = /(^|\.)(x\.com|twitter\.com)$/i;
const OEMBED: [RegExp, string][] = [
  [YOUTUBE, "https://www.youtube.com/oembed?format=json&url="],
  [/(^|\.)vimeo\.com$/i, "https://vimeo.com/api/oembed.json?url="],
  [X_POST, "https://publish.x.com/oembed?omit_script=1&dnt=1&url="],
  [/(^|\.)tiktok\.com$/i, "https://www.tiktok.com/oembed?url="],
];
type Video = { title: string; author: string; site: string; thumbnail: string; words: string };

// The words of a post on X, from the blockquote its oEmbed sends: the first
// paragraph, with the pic.twitter.com and t.co links that stand for its video
// or pictures taken off.
export function postWords(html: string): string {
  const p = html.match(/<p[^>]*>([\s\S]*?)<\/p>/i)?.[1] ?? "";
  return decode(p.replace(/<br\s*\/?>/gi, " ").replace(/<a[^>]*>\s*(pic\.twitter\.com\/\S+|https?:\/\/t\.co\/\S+)\s*<\/a>/gi, " ").replace(/<[^>]+>/g, ""));
}

// What an oEmbed answer says, made the same shape for every site.
export function readOembed(o: Record<string, unknown>, at: URL): Video {
  const author = decode(String(o.author_name ?? ""));
  let title = decode(String(o.title ?? ""));
  let words = "";
  let site = String(o.provider_name ?? "");
  if (X_POST.test(at.hostname)) {
    site = "X";
    words = postWords(String(o.html ?? ""));
    const short = words.length > 90 ? `${words.slice(0, 90).replace(/\s+\S*$/, "")}…` : words;
    title = short ? `${author || "A post"} on X: “${short}”` : author ? `A post by ${author} on X` : "";
  }
  return { title, author, site, thumbnail: String(o.thumbnail_url ?? ""), words };
}

export async function videoInfo(url: URL): Promise<Video | null> {
  const found = OEMBED.find(([re]) => re.test(url.hostname));
  if (!found) return null;
  try {
    const got = await fetchLimited(found[1] + encodeURIComponent(url.href), 256 * 1024, "application/json");
    if (!got) return null;
    return readOembed(JSON.parse(new TextDecoder().decode(got.bytes)), url);
  } catch { return null; }
}

// A consent screen, sign-in wall or bot check isn't the page they saved.
export const walled = (title: string, at: URL) => /^consent\.|^accounts\./i.test(at.hostname) || /^(before you continue|sign in|log in|just a moment|javascript is not available)/i.test(title);

const newId = (prefix: string) => {
  const t = Date.now().toString(36).padStart(9, "0");
  const r = Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => (b % 36).toString(36)).join("");
  return `${prefix}_${t}${r}`;
};

const SUMMARY_SYSTEM = `You keep notes for a writer and filmmaker who saves links as references and inspiration. Given a web page they saved, write one or two plain sentences saying what it is and what's on it, so they can recognise it later even if the page is gone. Facts from the page only, no opinions, no Markdown. If the page has nothing readable (a login wall, an error), return an empty summary.`;

async function summarise(client: Anthropic, page: { url: string; title: string; description: string; text: string }): Promise<string> {
  if (!page.text && !page.description) return "";
  const response = await client.beta.messages.create({
    model: "claude-opus-5-5",
    max_tokens: 4000,
    system: SUMMARY_SYSTEM,
    messages: [{ role: "user", content: `Address: ${page.url}\nTitle: ${page.title}\nDescription: ${page.description}\n\nPage text:\n${page.text}` }],
    output_config: { effort: "low", format: { type: "json_schema", schema: { type: "object", additionalProperties: false, required: ["summary"], properties: { summary: { type: "string" } } } } },
    betas: ["server-side-fallback-2026-07-01"],
    // @ts-ignore: server-side fallback parameter (beta)
    fallbacks: "default",
  });
  if (response.stop_reason !== "end_turn") return "";
  const text = response.content.find((b) => b.type === "text");
  if (!text || text.type !== "text") return "";
  return String(JSON.parse(text.text).summary ?? "").trim().slice(0, 500);
}

export async function snapshot(client: Anthropic, userId: string, body: { url?: string; tags?: string[]; words?: string }): Promise<Response> {
  let url: URL;
  try { url = new URL(String(body.url ?? "")); } catch { return json({ error: "Not a web address" }, 400); }
  if (!allowed(url)) return json({ error: "That address can't be saved" }, 400);
  const [got, video] = await Promise.all([
    fetchLimited(url.href, PAGE_LIMIT, "text/html,application/xhtml+xml").catch(() => null),
    videoInfo(url),
  ]);
  const type = got?.res.headers.get("content-type") ?? "";
  let html = got && type.includes("html") ? new TextDecoder().decode(got.bytes) : "";
  if (html && walled(meta(html, ["og:title"]) || decode(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? ""), got!.at)) html = "";
  const title = video?.title || meta(html, ["og:title", "twitter:title"]) || decode(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "");
  const description = meta(html, ["og:description", "twitter:description", "description"]);
  const site = video?.site || meta(html, ["og:site_name"]) || url.hostname.replace(/^www\./, "");
  const imageUrl = meta(html, ["og:image:secure_url", "og:image", "twitter:image", "twitter:image:src"]) || video?.thumbnail || "";

  let image: { id: string; type: string; size: number; name: string } | null = null;
  if (imageUrl) {
    try {
      const pic = await fetchLimited(new URL(imageUrl, got?.res.url || url).href, IMAGE_LIMIT, "image/*");
      const picType = pic?.res.headers.get("content-type")?.split(";")[0] ?? "";
      if (pic && /^image\/(jpeg|png|webp|gif)$/.test(picType)) {
        const id = newId("fi");
        const { error } = await admin().storage.from("writing-files").upload(`${userId}/${id}`, pic.bytes, { contentType: picType, upsert: true });
        const ext = picType.split("/")[1].replace("jpeg", "jpg");
        if (!error) image = { id, type: picType, size: pic.bytes.length, name: `${(title || site).slice(0, 60)}.${ext}` };
      }
    } catch (err) { console.error(err); }
  }
  // A video page's text is mostly script; its title, channel and description say more.
  const about = video?.words
    ? [`A post by ${video.author || "someone"} on ${video.site || site}: “${video.words}”`, description].filter(Boolean).join(" ")
    : [video?.author ? `A video by ${video.author} on ${video.site || site}.` : "", description].filter(Boolean).join(" ");
  let summary = "";
  try { summary = await summarise(client, { url: url.href, title, description: about, text: video ? "" : readable(html) }); } catch (err) { console.error(err); }
  // Even a page that couldn't be read gets a tag, from what they wrote and the address.
  let tag = "";
  try { tag = await tagFor(client, [body.words, title, site, summary || about, url.href].filter(Boolean).join("\n"), body.tags); } catch (err) { console.error(err); }
  if (!title && !summary && !image && !tag) return json({ error: "The page couldn't be read" }, 422);
  return json({ title: title.slice(0, 200), summary, site, image, tag });
}
