import type { CheckResult } from './check-related'
import { check_reuse, type CheckRecords } from './check-reuse'
import { gate_plan } from './gate-plan'
import type { GateStepResult } from './gate-report'
import { gate_tree, type GateTree } from './gate-tree'
import { scoped_green } from './scoped-green'

// **`check:related` runs only the checks whose green record no longer holds** (joshuafolkken/kit#5156):
// a re-run after fixing one failure ran the three that had passed over again, minutes of a hub-file
// `test:related` among them. No record is new here. `lint:related` and `test:related` write their own
// scoped records (`scoped-green.ts`); the type check and cspell read and write the gate's per-check
// records under the gate's labels (`check-reuse.ts`), so a green from either end serves the other. A
// failed check writes no record, so it runs again.

const GATE_LABELS: ReadonlyMap<string, string> = new Map([
	[gate_plan.TYPE_CHECK_TARGET, gate_plan.TYPE_CHECK_LABEL],
	[gate_plan.SPELL_CHECK_TARGET, gate_plan.SPELL_CHECK_LABEL],
])

const UNREAD_TREE: GateTree = { files: {}, base: undefined }

function gate_label(command: string): string {
	return GATE_LABELS.get(command) ?? ''
}

// The commands of `commands` whose green record still describes `tree`.
async function reusable(
	commands: ReadonlyArray<string>,
	tree: GateTree,
	records: CheckRecords = check_reuse.DEFAULT_RECORDS,
): Promise<ReadonlySet<string>> {
	const scoped = new Set(scoped_green.green_scripts(tree.files, tree.base))
	const gate = await check_reuse.reusable_checks([...GATE_LABELS.values()], tree, records)

	return new Set(commands.filter((command) => scoped.has(command) || gate.has(gate_label(command))))
}

function gate_results(results: ReadonlyArray<CheckResult>): Array<GateStepResult> {
	return results
		.filter((result) => GATE_LABELS.has(result.command))
		.map((result) => ({ ...result, label: gate_label(result.command), elapsed_ms: 0 }))
}

// Records the green type check and cspell against `tree`, the tree read before they started.
async function record(
	results: ReadonlyArray<CheckResult>,
	tree: GateTree,
	records: CheckRecords = check_reuse.DEFAULT_RECORDS,
): Promise<void> {
	await check_reuse.record_green_checks(gate_results(results), tree, records)
}

// A tree git could not read is one with no answer, so nothing is reused and every check runs.
async function read_tree(): Promise<GateTree> {
	try {
		return await gate_tree.read_gate_tree()
	} catch {
		return UNREAD_TREE
	}
}

const check_related_reuse = { UNREAD_TREE, read_tree, record, reusable }

export { check_related_reuse }
