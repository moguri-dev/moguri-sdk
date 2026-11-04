import { isRecord, MoguriError } from "./core.ts";
export interface WorkItemCommentFilter {
  kind: "work-item-comments-v1";
  document?: { sourceDigest: string; viewDigest: string };
  result?: { sourceDigest: string; viewDigest: string };
}

export function stripMarkdownComments(text: string): string {
  const start = text.search(/<(?:!|-)--/);
  if (start < 0) return text;
  const boundary = Math.max(0, start - 3);
  let prefix = text.slice(0, boundary);
  const visible = text.slice(boundary, start).split("");
  for (let index = start; index < text.length; index++) {
    visible.push(text[index]!);
    const length = visible.length;
    if (length < 4 || visible[length - 4] !== "<" || visible[length - 2] !== "-" || visible[length - 1] !== "-" ||
      visible[length - 3] !== "!" && visible[length - 3] !== "-") continue;
    visible.length -= 4;
    // Keep enough visible suffix to recognize delimiters joined by earlier removals.
    if (prefix && visible.length < 3) {
      const count = Math.min(3 - visible.length, prefix.length);
      visible.unshift(...prefix.slice(-count).split(""));
      prefix = prefix.slice(0, -count);
    }
    const end = text.indexOf("-->", index + 1);
    if (end < 0) break;
    index = end + 2;
  }
  return prefix + visible.join("");
}

export function workItemSnapshotView(text: string): string {
  let value: unknown;
  try { value = JSON.parse(text); }
  catch { throw new MoguriError("work_item_snapshot", "The retained work-item snapshot is not valid structured text. No unfiltered or replacement source was used."); }
  if (!isRecord(value) || typeof value.title !== "string" || typeof value.body !== "string") {
    throw new MoguriError("work_item_snapshot", "The retained work item is missing its original title/body fields. Its source was preserved, not reclassified or substituted.");
  }
  const linked = value.linkedPull;
  const title = stripMarkdownComments(value.title), body = stripMarkdownComments(value.body);
  const filteredLinked = isRecord(linked) && typeof linked.title === "string" && typeof linked.body === "string" ?
    { ...linked, title: stripMarkdownComments(linked.title), body: stripMarkdownComments(linked.body) } : linked;
  if (title === value.title && body === value.body && JSON.stringify(filteredLinked) === JSON.stringify(linked)) return text;
  return JSON.stringify({ ...value, title, body, ...(filteredLinked !== linked ? { linkedPull: filteredLinked } : {}) }, null, 2);
}
