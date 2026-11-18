import { Type, type Static } from "typebox";

/** Sizes offered by the clients; any whole number of GiB in range is accepted. */
export const VIRTUAL_DISK_SIZES_GIB = [5, 10, 20, 50, 100, 200, 500] as const;
export const VIRTUAL_DISK_MIN_GIB = 1, VIRTUAL_DISK_MAX_GIB = 4096;

export interface VirtualDiskPressure {
  /** Sessions working on the disk pause before their next model call, and queued turns wait, until space frees. */
  paused: boolean; freeBytes: number; totalBytes: number; reserveBytes: number; checkedAt: string;
}
/** Moguri's optional APFS sparse disk image. New session worktrees live inside it; the encrypted store never does. */
export interface VirtualDisk {
  id: string; revision: number;
  status: "creating" | "ready" | "resizing" | "unmounted" | "removing" | "off" | "failed";
  sizeGiB: number; image: string; mountpoint: string;
  createdAt: string; updatedAt: string; diagnostic: string | null;
  pressure: VirtualDiskPressure | null;
}
export interface VirtualDiskStatus {
  /** Whether this host can create disk images (macOS hdiutil). */
  supported: boolean;
  disk: VirtualDisk | null;
  /** Live usage read now, when the disk is mounted. */
  usage: { freeBytes: number; totalBytes: number; reserveBytes: number } | null;
  /** Worktrees that still live on the disk; turning it off needs none. */
  worktrees: number;
}
export const VirtualDiskCommandSchema = Type.Object({
  type: Type.Literal("application.virtual_disk.configure"),
  /** A size in GiB creates or resizes the disk; null turns it off. */
  sizeGiB: Type.Union([Type.Integer({ minimum: VIRTUAL_DISK_MIN_GIB, maximum: VIRTUAL_DISK_MAX_GIB }), Type.Null()]),
  expectedRevision: Type.Integer({ minimum: 0 }),
}, { additionalProperties: false });
export type VirtualDiskCommand = Static<typeof VirtualDiskCommandSchema>;
export const VirtualDiskQuerySchema = Type.Object({ type: Type.Literal("application.virtual_disk.status") }, { additionalProperties: false });
export type VirtualDiskQuery = Static<typeof VirtualDiskQuerySchema>;
export type VirtualDiskResponse = { type: "application.virtual_disk.status"; disk: VirtualDiskStatus };

/** The free space Moguri keeps on the disk before it cleans up or pauses: 5% of the size, at least 512 MiB. */
export function virtualDiskReserve(totalBytes: number): number {
  return Math.max(512 * 1024 ** 2, Math.round(totalBytes * 0.05));
}
export function formatDiskBytes(bytes: number): string {
  return bytes >= 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(1)} GB` : `${Math.round(bytes / 1024 ** 2)} MB`;
}
