import { git_command } from '#scripts/git/git-command'
import { git_spawn } from '#scripts/git/git-spawn'
import { PROJECT_ROOT } from '#scripts/init/init-paths'
import { file_map_stamp, type FileMapStamp } from '#scripts/josh/file-map-stamp'
import { stamp_file } from '#scripts/josh/stamp-file'
import { review_tree } from '#scripts/review/review-tree'
import { check_inputs, type PrettierIgnored } from './check-inputs'
import { gate_report, type GateStepResult } from './gate-report'
import type { GateTree } from './gate-tree'

// One green record per scoped check, so a gate re-run starts only the checks whose inputs moved
// (`check-inputs.ts` decides what each reads). The whole-gate record (`gate-skip.ts`) is refused the
// moment the merge base moves; a main sync that brought in only `.claude/**/*.md` then re-ran lint and
// the type check over sources neither had a reason to read again.
//
// **What moved is the union of two diffs**, and together they are every path whose content can differ
// from the tree the record was taken on. The changed-file map is a diff against the merge base, so a
// path absent from both maps holds the merge base's content — and the base's own diff
// (`git diff <recorded> <current>`) names every path that content moved for. A path in either map whose
// digest differs is the other half (`file_map_stamp.changed_since`).
//
// **A record is reuse of a result, not a check dropped**: no base, an empty changed-file map, an
// unreadable base diff or no root answers "not reusable", and a check with no scope is never reusable
// — the unit step's scope is the test-read map's (`check-inputs.ts`). The records are written and read
// only where the CLI entry resolved their destination (`CheckRecords`), so a suite driving the gate
// never plants a green record over the live tree.

const CHECK_PREFIX = 'josh-gate-check-'
const NAME_SEPARATOR = '\0'
const BASE_DIFF = ['diff', '--name-only', '--no-renames', '-z'] as const

const check_stamp = file_map_stamp.create(CHECK_PREFIX, PROJECT_ROOT)

// Where each check's record lives — a parameter so a test plants records in a directory of its own.
type CheckRecords = (label: string) => string

function default_records(label: string): string {
	return stamp_file.stamp_path(`${CHECK_PREFIX}${label}-`, PROJECT_ROOT)
}

async function base_diff(from: string, to: string): Promise<ReadonlyArray<string> | undefined> {
	if (from === to) return []

	try {
		const names = await git_spawn.read([...BASE_DIFF, from, to])

		return names.split(NAME_SEPARATOR).filter((name) => name !== '')
	} catch {
		return undefined
	}
}

async function moved_since(
	stamp: FileMapStamp,
	tree: GateTree,
): Promise<ReadonlyArray<string> | undefined> {
	// An empty map is also what `gate-tree.ts` answers when git could not be read, so it describes no
	// tree to diff against — the reading `gate_skip.gate_reuse` refuses too.
	const is_unread = Object.keys(tree.files).length === 0

	if (is_unread || stamp.base === undefined || tree.base === undefined) return undefined

	const moved_base = await base_diff(stamp.base, tree.base)

	if (moved_base === undefined) return undefined

	return [...file_map_stamp.changed_since(stamp, tree.files), ...moved_base]
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
	const moved = await moved_since(stamp, context.tree)

	if (moved === undefined) return false

	return !(await check_inputs.touches_inputs(label, moved, context.is_ignored, context.root))
}

// The time the check's record was taken, or `undefined` when the check has to run.
async function reused_at(label: string, context: ReuseContext): Promise<string | undefined> {
	const stamp = check_inputs.is_scoped(label) ? check_stamp.read(context.records(label)) : undefined

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
		check_inputs.is_scoped(result.label) &&
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

	for (const result of recordable) check_stamp.write(tree.files, records(result.label), tree.base)
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
