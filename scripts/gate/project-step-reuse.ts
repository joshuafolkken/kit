import type { GateStepDefinition } from '#scripts/lib/package-manifest'
import { check_reuse, type CheckInputs, type CheckRecords, type InputsOf } from './check-reuse'
import type { GateStepResult } from './gate-report'
import type { GateTree } from './gate-tree'
import { path_glob } from './path-glob'

// A project gate step's `paths` as its inputs to the gate's per-check green record (`check-reuse.ts`),
// so a re-run starts only the steps a path moved under since each last passed (joshuafolkken/kit#7205).
// What moved is the same `moved-paths.ts` answer kit's own checks are reused on; no second diff.
//
// A step without `paths` declares no inputs and always runs. The record's fingerprint is the step's
// command and paths, so editing either re-runs it; the tool behind the command (a new `cargo`) is not
// in it — `josh gate --force` runs every step.

// Where the gate keeps the records, and the tree they are read against. `records` is `undefined` where
// the gate keeps none (CI's `--no-unit` gate, a suite), so every step runs and nothing is written.
interface StepRecords {
	tree: GateTree
	records: CheckRecords | undefined
	is_forced: boolean
}

function touches(moved: ReadonlyArray<string>, patterns: ReadonlyArray<string>): boolean {
	return moved.some((file) => patterns.some((pattern) => path_glob.matches(file, pattern)))
}

function step_inputs(step: GateStepDefinition): CheckInputs | undefined {
	const { command, paths } = step

	if (paths === undefined) return undefined

	return {
		fingerprint: () => JSON.stringify({ command, paths }),
		touches: async (moved) => touches(moved, paths),
	}
}

function inputs_of(steps: ReadonlyArray<GateStepDefinition>): InputsOf {
	const by_name = new Map(steps.map((step) => [step.name, step_inputs(step)] as const))

	return (label) => by_name.get(label)
}

// Each step whose record still holds, mapped to when it was last green.
async function reusable_steps(
	steps: ReadonlyArray<GateStepDefinition>,
	reuse: StepRecords,
): Promise<ReadonlyMap<string, string>> {
	if (reuse.records === undefined || reuse.is_forced) return new Map()

	const labels = steps.map((step) => step.name)

	return await check_reuse.reusable_checks(labels, reuse.tree, reuse.records, inputs_of(steps))
}

async function record_green_steps(
	steps: ReadonlyArray<GateStepDefinition>,
	results: ReadonlyArray<GateStepResult>,
	reuse: StepRecords,
): Promise<void> {
	if (reuse.records === undefined) return

	await check_reuse.record_green_checks(results, reuse.tree, reuse.records, inputs_of(steps))
}

const project_step_reuse = { record_green_steps, reusable_steps }

export type { StepRecords }
export { project_step_reuse }
