// First light (Part 5): one chapter of the ESV, fetched with Michael's own
// key (the Supabase secret ESV_API_KEY; the repo is public, so never here).
// Until the key exists the answer is { nokey: true } and the app links each
// chapter to esv.org instead. One chapter per request (Crossway's limit is
// 500 verses), nothing stored here.
import { json } from "../_shared/common.ts";
import { cleanRef, esvUrl, splitNotice } from "./esvref.ts";

export async function esv(body: { ref?: unknown }) {
  const key = Deno.env.get("ESV_API_KEY");
  if (!key) return json({ nokey: true });
  const ref = cleanRef(body?.ref);
  if (!ref) return json({ error: "That isn't a chapter." }, 400);
  try {
    const res = await fetch(esvUrl(ref), { headers: { Authorization: `Token ${key}` } });
    if (res.status === 401 || res.status === 403) return json({ nokey: true });
    if (!res.ok) return json({ error: "The ESV didn't answer. Try again in a moment." }, 502);
    const got = splitNotice(await res.json());
    if (!got) return json({ error: "No text came back for that chapter." }, 502);
    return json({ ref, ...got });
  } catch (err) {
    console.error(err);
    return json({ error: "The ESV didn't answer. Try again in a moment." }, 502);
  }
}
