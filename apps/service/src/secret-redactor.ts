import { isRecord } from "../../../packages/protocol/src/index.ts";

class SecretStage {
  private matched = 0;
  private pending = "";
  private readonly failure: number[];
  constructor(private readonly secret: string) {
    this.failure = Array(secret.length).fill(0);
    for (let index = 1, prefix = 0; index < secret.length; index++) {
      while (prefix && secret[index] !== secret[prefix]) prefix = this.failure[prefix - 1]!;
      if (secret[index] === secret[prefix]) prefix++;
      this.failure[index] = prefix;
    }
  }
  push(text: string): string {
    let result = "";
    for (let index = 0; index < text.length; index++) {
      const character = text[index]!;
      while (this.matched && this.secret[this.matched] !== character) {
        const next = this.failure[this.matched - 1]!;
        result += this.pending.slice(0, this.matched - next);
        this.pending = this.pending.slice(this.matched - next); this.matched = next;
      }
      if (this.secret[this.matched] === character) {
        this.pending += character; this.matched++;
        if (this.matched === this.secret.length) { result += "[redacted]"; this.pending = ""; this.matched = 0; }
      } else result += character;
    }
    return result;
  }
  finish(): string { const result = this.pending; this.pending = ""; this.matched = 0; return result; }
}
export class SecretStreamRedactor {
  private readonly stages: SecretStage[];
  constructor(secrets: string[]) { this.stages = [...new Set(secrets.filter(Boolean))].map((secret) => new SecretStage(secret)); }
  push(text: string): string { for (const stage of this.stages) text = stage.push(text); return text; }
  finish(): string {
    let result = "";
    for (let index = 0; index < this.stages.length; index++) {
      let tail = this.stages[index]!.finish();
      for (const stage of this.stages.slice(index + 1)) tail = stage.push(tail);
      result += tail;
    }
    return result;
  }
}
export function redactSecrets(value: string, secrets: string[]): string;
export function redactSecrets(value: unknown, secrets: string[]): unknown;
export function redactSecrets(value: unknown, secrets: string[]): unknown {
  if (typeof value === "string") { for (const secret of secrets) if (secret) value = String(value).split(secret).join("[redacted]"); return value; }
  if (Array.isArray(value)) return value.map((entry) => redactSecrets(entry, secrets));
  if (isRecord(value)) return Object.fromEntries(Object.entries(value).map(([key, entry]) => [redactSecrets(key, secrets), redactSecrets(entry, secrets)]));
  return value;
}
