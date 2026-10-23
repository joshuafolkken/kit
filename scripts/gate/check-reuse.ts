import { git_command } from '#scripts/git/git-command'
import { PROJECT_ROOT } from '#scripts/init/init-paths'
import {
	file_map_stamp,
	type FileMapStamp,
	type FileMapStampAccess,
} from '#scripts/josh/file-map-stamp'
import { stamp_file } from '#scripts/josh/stamp-file'
import { review_tree } from '#scripts/review/review-tree'
import { check_inputs } from './check-inputs'
import { gate_report, type GateStepResult } from './gate-report'
import type { GateTree } from './gate-tree'
import { moved_paths } from './moved-paths'
import { verification_inputs, type PrettierIgnored } from './verification-inputs'

// One green record per declared check, so a gate re-run starts only the checks whose inputs moved
// (`verification-inputs.ts` declares what each reads). The whole-gate record (`gate-skip.ts`) is refused
// the moment the merge base moves; a main sync that brought in only `.claude/**/*.md` then re-ran lint
// and the type check over sources neither had a reason to read again. What moved since a record is
// `moved-paths.ts`.
//
// **A record is reuse of a result, not a check dropped**: no base, an empty changed-file map, an
// unreadable base diff, no root or a fingerprint of the check's tools and environment that moved
// answers "not reusable", and an undeclared check is never reusable. The records are written and read
// only where the CLI entry resolved their destination (`CheckRecords`), so a suite driving the gate
// never plants a green record over the live tree.

const CHECK_PREFIX = 'josh-gate-check-'

function check_stamp(label: string): FileMapStampAccess {
	return file_map_stamp.create(CHECK_PREFIX, PROJECT_ROOT, () =>
		verification_inputs.fingerprint([label]),
	)
}

// Where each check's record lives — a parameter so a test plants records in a directory of its own.
type CheckRecords = (label: string) => string

function default_records(label: string): string {
	return stamp_file.stamp_path(`${CHECK_PREFIX}${label}-`, PROJECT_ROOT)
}

interface ReuseContext {
	tree: GateTree
	records: CheckRecords
	is_ignored: PrettierIgnored
	root: string
}

async function is_stamp_reusable(
	label: string,
	stamp: FileMapStamp,
	context: ReuseContext,
): Promise<boolean> {
	const moved = await moved_paths.moved_since(stamp, context.tree)

	if (moved === undefined || !check_stamp(label).describes_inputs(stamp)) return false

	return !(await check_inputs.touches_inputs(label, moved, context.is_ignored, context.root))
}

// The time the check's record was taken, or `undefined` when the check has to run.
async function reused_at(label: string, context: ReuseContext): Promise<string | undefined> {
	const stamp = verification_inputs.is_declared(label)
		? check_stamp(label).read(context.records(label))
		: undefined

	if (stamp === undefined) return undefined

	return (await is_stamp_reusable(label, stamp, context)) ? stamp.taken_at : undefined
}

async function read_root(): Promise<string | undefined> {
	try {
		return await git_command.repository_root()
	} catch {
		return undefined
	}
}

// Each reusable check's label, mapped to when it was last green.
async function reusable_checks(
	labels: ReadonlyArray<string>,
	tree: GateTree,
	records: CheckRecords = default_records,
): Promise<ReadonlyMap<string, string>> {
	const root = await read_root()

	if (root === undefined) return new Map()

	const context = { tree, records, root, is_ignored: check_inputs.prettier_ignored(root) }
	const answers = await Promise.all(
		labels.map(async (label) => [label, await reused_at(label, context)] as const),
	)

	return new Map(answers.flatMap(([label, at]) => (at === undefined ? [] : [[label, at] as const])))
}

function is_recordable(result: GateStepResult): boolean {
	return (
		verification_inputs.is_declared(result.label) &&
		!gate_report.is_gate_step_failed(result) &&
		gate_report.has_nothing_to_say(result)
	)
}

function write_records(
	results: ReadonlyArray<GateStepResult>,
	tree: GateTree,
	records: CheckRecords,
): void {
	const recordable = results.filter((result) => is_recordable(result))

	for (const { label } of recordable) {
		check_stamp(label).write(tree.files, records(label), tree.base)
	}
}

// Every scoped check that passed silently, recorded against the tree it read — a red gate's green
// checks included, since each record answers for its own check alone. Nothing is written when the tree
// moved while the checks ran, and a failed write leaves no record, the safe direction either way.
async function record_green_checks(
	results: ReadonlyArray<GateStepResult>,
	tree: GateTree,
	records: CheckRecords = default_records,
): Promise<void> {
	try {
		const after = await review_tree.read_changed_tree()

		if (JSON.stringify(after) !== JSON.stringify(tree.files)) return

		write_records(results, { files: after, base: tree.base }, records)
	} catch {
		/* no record is the safe answer */
	}
}

const check_reuse = { DEFAULT_RECORDS: default_records, record_green_checks, reusable_checks }

export type { CheckRecords }
export { check_reuse }
