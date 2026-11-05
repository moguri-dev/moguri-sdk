export interface AppleInitPin {
  reference: string;
  repository: string;
  indexDigest: string;
  licenseUrl: string;
  licenseSha256: string;
}
export const APPLE_INIT: Readonly<AppleInitPin>;
export function prepareAppleInitArchive(options: {
  directory: string;
  cacheDirectory?: string;
  fetch?: typeof globalThis.fetch;
  pin?: AppleInitPin;
}): Promise<{
  reference: string;
  indexDigest: string;
  archive: string;
  sha512: string;
  licensePath: string;
  licenseSha256: string;
  inputBytes: number;
}>;
