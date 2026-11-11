import { admin } from "./common.ts";
import { newVapid } from "./webpush.ts";

export const SUBJECT = "https://laserbunny-coder.github.io/daybook/";
/** This server's VAPID key, made the first time it's needed. */
export async function vapid(): Promise<JsonWebKey> {
  const db = admin();
  const { data } = await db.from("push_config").select("vapid").eq("id", 1).single();
  if (data?.vapid) return data.vapid as JsonWebKey;
  const jwk = await newVapid();
  // Two first calls at once: only one key is kept, and both use that one
  await db.from("push_config").update({ vapid: jwk }).eq("id", 1).is("vapid", null);
  const { data: again } = await db.from("push_config").select("vapid").eq("id", 1).single();
  return (again?.vapid ?? jwk) as JsonWebKey;
}
