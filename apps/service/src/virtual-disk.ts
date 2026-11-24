import { randomUUID } from "node:crypto";
import { readFileSync, realpathSync, statfsSync, statSync } from "node:fs";
import { lstat, mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  GLOBAL_PROFILE_ID, MoguriError, virtualDiskReserve, formatDiskBytes,
  type CommandResult, type EventInput, type VirtualDisk, type VirtualDiskCommand, type VirtualDiskStatus,
} from "../../../packages/protocol/src/index.ts";
import { runProgram } from "./program.ts";
import type { EventStore } from "./store.ts";
import type { WorkspaceVolume } from "./managed-workspaces.ts";

const GIB = 1024 ** 3;
const MARKER = ".moguri-disk";

/** The disk-image operations Moguri needs; production uses macOS hdiutil, tests inject a generated stand-in. */
export interface VirtualDiskDriver {
  readonly supported: boolean;
  create(image: string, bytes: number, signal: AbortSignal): Promise<void>;
  attach(image: string, mountpoint: string, signal: AbortSignal): Promise<void>;
  detach(mountpoint: string, signal: AbortSignal): Promise<void>;
  resize(image: string, bytes: number, signal: AbortSignal): Promise<void>;
  /** Return space freed inside the image to the host disk; only works while detached. */
  compact(image: string, signal: AbortSignal): Promise<void>;
  mounted(mountpoint: string): boolean;
  space(mountpoint: string): { freeBytes: number; totalBytes: number };
}
const hdiutil = (args: string[], signal: AbortSignal) => runProgram("/usr/bin/hdiutil", args, {
  cwd: "/", signal, timeoutMs: 120_000, maxBytes: 64 * 1024, label: "Moguri virtual disk",
}).then(() => undefined);
const megabytes = (bytes: number) => `${Math.round(bytes / 1024 ** 2)}m`;
export const hdiutilDriver: VirtualDiskDriver = {
  supported: process.platform === "darwin",
  create: (image, bytes, signal) => hdiutil(["create", "-size", megabytes(bytes), "-type", "SPARSEBUNDLE", "-fs", "APFS", "-volname", "Moguri Sessions", "-quiet", image], signal),
  attach: (image, mountpoint, signal) => hdiutil(["attach", "-nobrowse", "-noautoopen", "-owners", "on", "-mountpoint", mountpoint, "-quiet", image], signal),
  detach: (mountpoint, signal) => hdiutil(["detach", mountpoint, "-quiet"], signal),
  resize: (image, bytes, signal) => hdiutil(["resize", "-size", megabytes(bytes), image], signal),
  compact: (image, signal) => hdiutil(["compact", image, "-quiet"], signal),
  mounted: (mountpoint) => {
    try { return statSync(mountpoint).dev !== statSync(dirname(mountpoint)).dev; }
    catch { return false; }
  },
  space: (mountpoint) => {
    const stats = statfsSync(mountpoint);
    return { freeBytes: stats.bavail * stats.bsize, totalBytes: stats.blocks * stats.bsize };
  },
};
export interface VirtualDiskOptions {
  driver?: VirtualDiskDriver;
  /** How often the pressure monitor reads free space. */
  intervalMs?: number;
  reserve?: (totalBytes: number) => number;
  /** Free space at which paused work resumes; above the reserve so work doesn't flap. */
  resume?: (totalBytes: number) => number;
}
export interface VirtualDiskHooks {
  changed(): void;
  /** D76. Free space moved by at least 0.1% of the disk (or the size changed) since the last report; clients receive the new status live. */
  usage?(): void;
  /** Park the oldest archived clean, pushed worktrees on this disk until `enough()` holds. */
  reclaim(diskId: string, enough: () => boolean): Promise<void>;
  /** Running turns, terminals, writers or jobs using worktrees on this disk. */
  owners(diskId: string): string[];
  /** Worktrees that still live on this disk. */
  worktrees(diskId: string): number;
}
type Finish = (events: EventInput[], result?: CommandResult) => CommandResult;

/** Moguri's optional fixed-size APFS sparse disk for session worktrees (D47). Global and root-owned, shared by every profile. */
export class VirtualDiskRuntime implements WorkspaceVolume {
  private disk: VirtualDisk | null;
  private timer?: NodeJS.Timeout;
  private checking?: Promise<void>;
  private operation?: Promise<void>;
  private closed = false;
  private privateRoot?: { revision: number; root: string };
  private reported?: { diskId: string; freeBytes: number; totalBytes: number };
  readonly directory: string;
  constructor(private readonly global: EventStore, resourceBase: string, private readonly hooks: VirtualDiskHooks, private readonly options: VirtualDiskOptions = {}) {
    this.directory = join(resourceBase, "virtual-disk");
    const event = global.events().findLast((event) => event.event_type === "application.virtual_disk_saved");
    this.disk = event?.event_type === "application.virtual_disk_saved" ? structuredClone(event.payload.disk) : null;
  }
  private get driver(): VirtualDiskDriver { return this.options.driver ?? hdiutilDriver; }
  private reserve(totalBytes: number): number { return (this.options.reserve ?? virtualDiskReserve)(totalBytes); }
  private resume(totalBytes: number): number { return this.options.resume?.(totalBytes) ?? Math.min(totalBytes, this.reserve(totalBytes) * 1.25); }
  private event(disk: VirtualDisk): EventInput {
    return { event_type: "application.virtual_disk_saved", profile_id: GLOBAL_PROFILE_ID, payload: { disk } };
  }
  private save(changes: Partial<VirtualDisk>): VirtualDisk {
    if (!this.disk) throw new MoguriError("virtual_disk_missing", "There is no virtual disk to update.", 409);
    const next = { ...this.disk, ...changes, revision: this.disk.revision + 1, updatedAt: new Date().toISOString() };
    this.global.commit([this.event(next)]);
    this.disk = next; this.privateRoot = undefined; this.hooks.changed();
    return next;
  }
  async initialize(): Promise<void> {
    const disk = this.disk;
    if (disk && disk.status !== "off") {
      if (disk.status === "creating" || disk.status === "removing" || disk.status === "resizing") {
        const interrupted = `Moguri stopped while the disk was ${disk.status === "creating" ? "being created" : disk.status === "removing" ? "being turned off" : "being resized"}. Nothing was repeated.`;
        // An interrupted creation can't prove the image is Moguri's, so it is neither attached nor deleted.
        if (disk.status === "creating") this.save({ status: "off", pressure: null, diagnostic: await lstat(disk.image).then(() => `${interrupted} Inspect or move ${disk.image} before turning the disk on again.`, () => interrupted) });
        else if (!await lstat(disk.image).then(() => true, () => false)) this.save({ status: disk.status === "removing" ? "off" : "failed", diagnostic: disk.status === "removing" ? null : interrupted, pressure: null });
        else await this.mount().then(() => this.save({ status: "ready", diagnostic: interrupted }), (error: unknown) => this.save({ status: "unmounted", diagnostic: `${interrupted} ${this.message(error)}` }));
      } else if (disk.status !== "failed" || await lstat(disk.image).then(() => true, () => false)) {
        await this.mount().then(() => { if (this.disk?.status !== "ready" || this.disk.diagnostic) this.save({ status: "ready", diagnostic: null }); },
          (error: unknown) => { if (this.disk?.status !== "unmounted" || this.disk.diagnostic !== this.message(error)) this.save({ status: "unmounted", diagnostic: this.message(error) }); });
      }
    }
    this.timer = setInterval(() => { void this.check(); }, this.options.intervalMs ?? 5000);
    this.timer.unref();
  }
  private message(error: unknown): string {
    return error instanceof Error ? error.message : "The disk image operation failed.";
  }
  private async mount(): Promise<void> {
    const disk = this.disk!;
    if (!this.driver.mounted(disk.mountpoint)) {
      await mkdir(disk.mountpoint, { recursive: true, mode: 0o700 });
      await this.driver.attach(disk.image, disk.mountpoint, AbortSignal.timeout(60_000));
    }
    let marker = "";
    try { marker = readFileSync(join(disk.mountpoint, "moguri", MARKER), "utf8").trim(); } catch { /* checked below */ }
    if (marker !== disk.id) throw new MoguriError("virtual_disk_identity", "The mounted volume is not Moguri's recorded virtual disk. No other volume was used.", 409);
  }
  private space(): { freeBytes: number; totalBytes: number } | null {
    const disk = this.disk;
    if (!disk || disk.status !== "ready" || !this.driver.mounted(disk.mountpoint)) return null;
    try { return this.driver.space(disk.mountpoint); } catch { return null; }
  }
  /** The private folder inside the mounted disk, for new worktrees. */
  current(): { root: string; diskId: string } | null {
    const disk = this.disk;
    if (!disk || disk.status !== "ready") return null;
    if (disk.pressure?.paused) throw new MoguriError("virtual_disk_full", `Moguri's virtual disk is full (${formatDiskBytes(disk.pressure.freeBytes)} free). Archive sessions (their clean, pushed worktrees are removed) or make the disk bigger in Settings / Retention before starting new work.`, 409);
    const root = this.root(disk.id);
    return root ? { root, diskId: disk.id } : null;
  }
  root(diskId: string): string | null {
    const disk = this.disk;
    if (!disk || disk.id !== diskId || disk.status !== "ready" || !this.driver.mounted(disk.mountpoint)) return null;
    if (this.privateRoot?.revision !== disk.revision) {
      // Native realpath, like worktree creation's canonical check: the JS realpathSync keeps the configured letter case.
      try { this.privateRoot = { revision: disk.revision, root: realpathSync.native(join(disk.mountpoint, "moguri")) }; } catch { return null; }
    }
    return this.privateRoot.root;
  }
  /** Work on this disk waits while space is short or while the disk is being changed. */
  paused(diskId: string): boolean {
    const disk = this.disk;
    return Boolean(disk && disk.id === diskId && (disk.status === "resizing" || disk.pressure?.paused));
  }
  status(): VirtualDiskStatus {
    const disk = this.disk, space = this.space();
    return { supported: this.driver.supported, disk: disk ? structuredClone(disk) : null,
      usage: space ? { ...space, reserveBytes: this.reserve(space.totalBytes) } : null,
      worktrees: disk && disk.status !== "off" ? this.hooks.worktrees(disk.id) : 0 };
  }
  configure(command: VirtualDiskCommand, finish: Finish): CommandResult {
    if (!this.driver.supported) throw new MoguriError("virtual_disk_unsupported", "Virtual disks need macOS. Nothing was created.", 409);
    if (this.operation) throw new MoguriError("virtual_disk_busy", "The virtual disk is still being changed. Wait for it to finish.", 409);
    const disk = this.disk, active = disk && disk.status !== "off" ? disk : null;
    if ((disk?.revision ?? 0) !== command.expectedRevision) throw new MoguriError("virtual_disk_changed", "The virtual disk changed. Reload its status before changing it.", 409);
    if (command.sizeGiB === null) {
      if (!active) throw new MoguriError("virtual_disk_off", "The virtual disk is already off.", 409);
      const worktrees = this.hooks.worktrees(active.id);
      if (worktrees) throw new MoguriError("virtual_disk_in_use", `${worktrees} worktree${worktrees === 1 ? " still lives" : "s still live"} on the disk. Archive their sessions (clean, pushed worktrees are removed) or remove the worktrees, then turn the disk off.`, 409);
      return this.start(finish, { ...active, status: "removing", diagnostic: null }, () => this.turnOff(active));
    }
    const size = command.sizeGiB;
    if (!active) {
      const now = new Date().toISOString(), id = randomUUID();
      const next: VirtualDisk = { id, revision: (disk?.revision ?? -1) + 1, status: "creating", sizeGiB: size, image: join(this.directory, "sessions.sparsebundle"),
        mountpoint: join(this.directory, "volume"), createdAt: now, updatedAt: now, diagnostic: null, pressure: null };
      return this.start(finish, next, () => this.create(next));
    }
    if (active.status !== "ready") throw new MoguriError("virtual_disk_unready", active.diagnostic ?? "The virtual disk isn't mounted. Restart Moguri to mount it again before resizing.", 409);
    if (size === active.sizeGiB) return { revision: active.revision };
    const owners = this.hooks.owners(active.id);
    if (owners.length) throw new MoguriError("virtual_disk_busy", `Resizing unmounts the disk briefly. Stop the work using it first: ${owners.slice(0, 5).join(", ")}${owners.length > 5 ? ", ..." : ""}.`, 409);
    const space = this.space();
    if (space) {
      const used = space.totalBytes - space.freeBytes, needed = used + this.reserve(size * GIB);
      if (size * GIB < needed) throw new MoguriError("virtual_disk_too_small", `The disk already holds ${formatDiskBytes(used)}. Choose at least ${Math.ceil(needed / GIB)} GB.`, 409);
    }
    return this.start(finish, { ...active, status: "resizing", diagnostic: `Resizing to ${size} GB.` }, () => this.resize(active, size));
  }
  private start(finish: Finish, intent: VirtualDisk, operation: () => Promise<void>): CommandResult {
    const result = finish([this.event(intent)], { revision: intent.revision });
    this.disk = intent; this.privateRoot = undefined;
    this.operation = operation().catch((error: unknown) => console.error("Virtual disk operation failed:", this.message(error)))
      .finally(() => { this.operation = undefined; this.hooks.changed(); void this.check(); });
    return result;
  }
  private async create(disk: VirtualDisk): Promise<void> {
    let created = false;
    try {
      await mkdir(this.directory, { recursive: true, mode: 0o700 });
      const folder = await lstat(this.directory);
      if (!folder.isDirectory() || folder.isSymbolicLink() || folder.uid !== process.getuid?.() || folder.mode & 0o077) throw new MoguriError("virtual_disk_folder", "The virtual disk folder is not private and user-owned. Nothing was created.", 409);
      if (await lstat(disk.image).then(() => true, () => false)) throw new MoguriError("virtual_disk_exists", `A disk image already exists at ${disk.image}. Inspect or move it; Moguri didn't overwrite it.`, 409);
      created = true;
      await this.driver.create(disk.image, disk.sizeGiB * GIB, AbortSignal.timeout(120_000));
      await mkdir(disk.mountpoint, { recursive: true, mode: 0o700 });
      await this.driver.attach(disk.image, disk.mountpoint, AbortSignal.timeout(60_000));
      await mkdir(join(disk.mountpoint, "moguri"), { mode: 0o700 });
      await writeFile(join(disk.mountpoint, "moguri", MARKER), `${disk.id}\n`, { mode: 0o600, flag: "wx" });
      this.save({ status: "ready", diagnostic: null });
    } catch (error) {
      if (created) {
        if (this.driver.mounted(disk.mountpoint)) await this.driver.detach(disk.mountpoint, AbortSignal.timeout(60_000)).catch(() => undefined);
        await rm(disk.image, { recursive: true, force: true }).catch(() => undefined);
      }
      // A refused creation leaves the disk off, so turning it "off" later can never delete an image Moguri didn't create.
      this.save({ status: created ? "failed" : "off", diagnostic: `Creating the disk failed: ${this.message(error)}` });
      throw error;
    }
  }
  private async resize(previous: VirtualDisk, size: number): Promise<void> {
    try {
      await this.driver.detach(previous.mountpoint, AbortSignal.timeout(60_000));
    } catch (error) {
      this.save({ status: "ready", diagnostic: `The disk is in use, so it wasn't resized: ${this.message(error)}` });
      throw error;
    }
    let diagnostic: string | null = null;
    try { await this.driver.resize(previous.image, size * GIB, AbortSignal.timeout(120_000)); }
    catch (error) { diagnostic = `Resizing to ${size} GB failed: ${this.message(error)} The disk kept ${previous.sizeGiB} GB.`; }
    await this.driver.compact(previous.image, AbortSignal.timeout(120_000)).catch(() => undefined);
    try {
      await this.mount();
      this.save({ status: "ready", sizeGiB: diagnostic ? previous.sizeGiB : size, diagnostic, pressure: null });
    } catch (error) {
      this.save({ status: "unmounted", sizeGiB: diagnostic ? previous.sizeGiB : size, diagnostic: `The disk couldn't be mounted again: ${this.message(error)}` });
      throw error;
    }
  }
  private async turnOff(previous: VirtualDisk): Promise<void> {
    try {
      if (this.driver.mounted(previous.mountpoint)) await this.driver.detach(previous.mountpoint, AbortSignal.timeout(60_000));
    } catch (error) {
      this.save({ status: "ready", diagnostic: `The disk is in use, so it stayed on: ${this.message(error)}` });
      throw error;
    }
    await rm(previous.image, { recursive: true, force: true });
    this.save({ status: "off", diagnostic: null, pressure: null });
  }
  /** Read free space; under the reserve, park old archived worktrees first, then pause work on the disk until space frees. */
  check(): Promise<void> {
    if (this.closed || this.operation) return Promise.resolve();
    this.checking ??= this.measure().catch((error: unknown) => console.error("Virtual disk check failed:", this.message(error))).finally(() => { this.checking = undefined; });
    return this.checking;
  }
  private async measure(): Promise<void> {
    const disk = this.disk;
    let space = this.space();
    if (!disk || !space) return;
    const reserve = this.reserve(space.totalBytes), resume = this.resume(space.totalBytes), wasPaused = disk.pressure?.paused ?? false;
    const short = (free: number) => free < (wasPaused ? resume : reserve);
    if (short(space.freeBytes)) {
      await this.hooks.reclaim(disk.id, () => (this.space()?.freeBytes ?? 0) >= resume);
      space = this.space() ?? space;
    }
    const paused = short(space.freeBytes);
    if (paused !== wasPaused && this.disk?.id === disk.id && this.disk.status === "ready") {
      this.save({ pressure: { paused, freeBytes: space.freeBytes, totalBytes: space.totalBytes, reserveBytes: reserve, checkedAt: new Date().toISOString() } });
    }
    const reported = this.reported;
    if (!reported || reported.diskId !== disk.id || reported.totalBytes !== space.totalBytes ||
      Math.abs(reported.freeBytes - space.freeBytes) >= Math.max(1, space.totalBytes / 1000)) {
      this.reported = { diskId: disk.id, ...space };
      this.hooks.usage?.();
    }
  }
  /** Stops the monitor and closes this runtime's store connection; the disk itself stays mounted. */
  async close(): Promise<void> {
    this.closed = true;
    if (this.timer) clearInterval(this.timer);
    await Promise.allSettled([this.operation, this.checking]);
    if (this.global.db.isOpen) this.global.close();
  }
}
