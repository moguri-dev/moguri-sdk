import { readFileSync } from "node:fs";
import {
  fullMilestoneProduct, isManualKupoEffort, milestoneAxes, milestoneCellId, milestoneClientCells, type MilestoneCell,
} from "./milestone-combinations.ts";

type Axis = keyof typeof milestoneAxes;

export const coveringArrayPath = new URL("./milestone-covering-array.json", import.meta.url);
const axisNames = Object.keys(milestoneAxes) as Axis[];
export const coveringPairs: Axis[][] = axisNames.flatMap((first, index) => axisNames.slice(index + 1).map((second) => [first, second]));
export const coveringTuples: Axis[][] = [["env", "selection", "budget"], ["env", "selection", "input"], ["env", "selection", "effort"]];
const coveringTargets = [...coveringPairs, ...coveringTuples];

const targetKey = (cell: MilestoneCell, axes: Axis[]) => `${axes.join(",")}:${axes.map((axis) => cell[axis]).join("|")}`;
export const supportedMilestoneCells = () => fullMilestoneProduct().filter((cell) => !isManualKupoEffort(cell));

export function uncoveredTargets(cells: MilestoneCell[]) {
  const covered = new Set(cells.flatMap((cell) => coveringTargets.map((axes) => targetKey(cell, axes))));
  return [...new Set(supportedMilestoneCells().flatMap((cell) => coveringTargets.map((axes) => targetKey(cell, axes))))]
    .filter((key) => !covered.has(key));
}

// Deterministic greedy covering: client seeds first, then the earliest product-order cell with the most new targets,
// followed by a reverse pass that drops any non-seed cell whose targets are all covered elsewhere.
export function generateCoveringCells(): MilestoneCell[] {
  const product = supportedMilestoneCells(), ids = new Map<string, number>();
  const targets = product.map((cell) => Int32Array.from(coveringTargets.map((axes) => {
    const key = targetKey(cell, axes);
    if (!ids.has(key)) ids.set(key, ids.size);
    return ids.get(key)!;
  })));
  const index = new Map(product.map((cell, position) => [milestoneCellId(cell), position]));
  const counts = new Int32Array(ids.size), chosen: number[] = [];
  const take = (position: number) => { chosen.push(position); for (const target of targets[position]!) counts[target]!++; };
  const seeds = milestoneClientCells().map((cell) => index.get(milestoneCellId(cell))!);
  seeds.forEach(take);
  for (;;) {
    let best = -1, score = 0;
    for (let position = 0; position < product.length; position++) {
      let gain = 0;
      for (const target of targets[position]!) if (counts[target] === 0) gain++;
      if (gain > score) { score = gain; best = position; }
    }
    if (best < 0) break;
    take(best);
  }
  for (const position of chosen.slice(seeds.length).reverse()) {
    if ([...targets[position]!].every((target) => counts[target]! > 1)) {
      for (const target of targets[position]!) counts[target]!--;
      chosen.splice(chosen.indexOf(position), 1);
    }
  }
  return chosen.sort((first, second) => first - second).map((position) => product[position]!);
}

export function coveringArrayDocument(cells = generateCoveringCells()) {
  return {
    format: "moguri-milestone-covering-array", version: 1,
    method: "Pairwise over every axis plus every supported env x selection x {budget, input, effort} tuple, seeded with the client journey cells. Manual Kupo effort is excluded and refused separately.",
    axes: milestoneAxes, pairs: coveringPairs, tuples: coveringTuples,
    seeds: milestoneClientCells().map(milestoneCellId),
    cells: cells.map(milestoneCellId),
  };
}

export function coveringMilestoneCells(): MilestoneCell[] {
  const document: unknown = JSON.parse(readFileSync(coveringArrayPath, "utf8"));
  if (!document || typeof document !== "object" || !("cells" in document) || !Array.isArray(document.cells)) {
    throw new Error("The checked-in milestone covering array is malformed; regenerate it with npm run generate:covering.");
  }
  const product = new Map(fullMilestoneProduct().map((cell) => [milestoneCellId(cell), cell]));
  return document.cells.map((id: unknown) => {
    const cell = typeof id === "string" ? product.get(id) : undefined;
    if (!cell) throw new Error(`The covering array names an unknown milestone cell: ${String(id)}`);
    return cell;
  });
}
