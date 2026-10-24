export interface ShortcutEvent { code: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean }
export interface Shortcut { code: string; primary: boolean; control: boolean; meta: boolean; alt: boolean; shift: boolean }
const aliases: Record<string, string> = { Ctrl: "Control", Cmd: "Meta", Command: "Meta", Option: "Alt" };
export function parseShortcut(value: string): Shortcut | null {
  if (value === "none") return null;
  const parts = value.split("+").map((part) => aliases[part] ?? part), code = parts.pop();
  if (!code || !/^(Space|Key[A-Z]|Digit[0-9]|F[1-9]|F1[0-2])$/.test(code) || !parts.length ||
    parts.some((part) => !["Primary", "Control", "Meta", "Alt", "Shift"].includes(part)) || new Set(parts).size !== parts.length ||
    !parts.some((part) => ["Primary", "Control", "Meta", "Alt"].includes(part)) ||
    parts.includes("Primary") && (parts.includes("Control") || parts.includes("Meta"))) throw new Error("Use a qualified modifier chord such as Control+Space or Primary+Shift+KeyD, or none. Editing/navigation keys stay fixed.");
  const shortcut = { code, primary: parts.includes("Primary"), control: parts.includes("Control"), meta: parts.includes("Meta"), alt: parts.includes("Alt"), shift: parts.includes("Shift") };
  if (!shortcut.alt && !shortcut.shift && (shortcut.primary || shortcut.control || shortcut.meta) && /^Key[ACVXZYSQWRLTFN]$/.test(code) ||
    shortcut.alt && code === "F4" || code === "F12") throw new Error("This chord is reserved for standard editing, browser or operating-system actions. Choose another shortcut.");
  return shortcut;
}
export function shortcutModifiersHeld(event: ShortcutEvent, shortcut: Shortcut): boolean {
  return (!shortcut.primary || event.ctrlKey || event.metaKey) && (!shortcut.control || event.ctrlKey) && (!shortcut.meta || event.metaKey) &&
    (!shortcut.alt || event.altKey) && (!shortcut.shift || event.shiftKey);
}
export function shortcutMatches(event: ShortcutEvent, value: string): boolean {
  const shortcut = parseShortcut(value);
  return Boolean(shortcut && event.code === shortcut.code && event.altKey === shortcut.alt && event.shiftKey === shortcut.shift &&
    (shortcut.primary ? (event.ctrlKey || event.metaKey) && !(event.ctrlKey && event.metaKey) : event.ctrlKey === shortcut.control && event.metaKey === shortcut.meta));
}
export function shortcutLabel(value: string): string {
  const shortcut = parseShortcut(value);
  if (!shortcut) return "Not assigned";
  return [shortcut.primary ? "Cmd/Ctrl" : "", shortcut.control ? "Ctrl" : "", shortcut.meta ? "Cmd" : "", shortcut.alt ? "Alt" : "", shortcut.shift ? "Shift" : "",
    shortcut.code.replace(/^Key|^Digit/, "")].filter(Boolean).join("+");
}
export function shortcutFromEvent(event: ShortcutEvent): string {
  const value = [event.ctrlKey ? "Control" : "", event.metaKey ? "Meta" : "", event.altKey ? "Alt" : "", event.shiftKey ? "Shift" : "", event.code].filter(Boolean).join("+");
  parseShortcut(value); return value;
}
export function validateShortcutSet(values: Record<string, string>): string[] {
  const errors: string[] = [], used = new Map<string, string>();
  for (const [name, value] of Object.entries(values)) {
    let shortcut: Shortcut | null;
    try { shortcut = parseShortcut(value); } catch (error) { errors.push(`${name}: ${error instanceof Error ? error.message : "Invalid shortcut."}`); continue; }
    if (!shortcut) continue;
    for (const primary of shortcut.primary ? ["control", "meta"] as const : ["none"] as const) {
      const key = JSON.stringify([shortcut.code, shortcut.control || primary === "control", shortcut.meta || primary === "meta", shortcut.alt, shortcut.shift]);
      const previous = used.get(key);
      if (previous && previous !== name) errors.push(`${name} conflicts with ${previous}. No action was silently reassigned.`);
      used.set(key, name);
    }
  }
  return errors;
}
