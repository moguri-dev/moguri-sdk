export const SESSION_SHORT_ID_LENGTH = 8;

/** Git-style short form of a session ID: its first eight hex digits. */
export const sessionShortId = (id: string): string => id.slice(0, SESSION_SHORT_ID_LENGTH).toLowerCase();

const compact = (value: string) => value.toLowerCase().replace(/^:/, "").replaceAll("-", "");

/** Sessions matching a full session ID or a short-ID prefix of at least eight hex digits. More than one match is ambiguous and must not be attached. */
export function resolveSessionReference<T extends { id: string }>(sessions: readonly T[], reference: string): T[] {
  const key = compact(reference);
  if (!/^[0-9a-f]{8,32}$/.test(key)) return [];
  return sessions.filter((session) => compact(session.id).startsWith(key));
}

/** Full session IDs and `:short` mentions in prompt text, in order of appearance. */
export function sessionReferences(text: string): string[] {
  return [...text.matchAll(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b|(?<=^|\s):[0-9a-f]{8,32}(?=$|[\s.,;!?)\]])/gi)].map((match) => match[0].toLowerCase());
}
