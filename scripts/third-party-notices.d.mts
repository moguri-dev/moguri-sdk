export interface NoticeEntry {
  name: string;
  version: string;
  license: string;
  openSource: boolean;
  texts: { name: string; text: string }[];
}
export function packageRoots(ids: Iterable<string>, base?: string): string[];
export function isOpenSourceLicense(expression: string): boolean;
export function collectNotices(roots: string[]): Promise<NoticeEntry[]>;
export function renderNotices(entries: NoticeEntry[]): string;
export function writeThirdPartyNotices(ids: Iterable<string>, outfile: string, base?: string): Promise<NoticeEntry[]>;
