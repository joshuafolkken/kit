import { PROJECT_ROOT } from '#scripts/init/init-paths'
import { stamp_file } from '#scripts/josh/stamp-file'
import { json_value } from '#scripts/lib/json-value'
import { z } from 'zod'
import type { GateTree } from './gate-tree'
import { input_fingerprint } from './input-fingerprint'
import { scoped_green } from './scoped-green'
import { verification_inputs } from './verification-inputs'

// **A bare related check asked again of a tree it already answered for answers at once**
// (joshuafolkken/kit#5657): a cut and resume, or a re-check after a review, re-ran `josh lint:related`
// and `josh check:related` for minutes on bytes they had already read. The key is the tree's content —
// each changed or untracked file's digest and the base — so one changed byte runs the check again. A
// red answer is kept as red, so a reuse never turns a failure green; a failure the tree does not hold
// (a dependency install, a flaky test) runs again once the record its reuse line names is removed.
//
// On disk rather than `stamped-memo.ts`: that memo lives in one process, and each check is its own.

const verdict_schema = z.object({
	tree: z.string(),
	exit_code: z.number(),
	tail: z.string(),
	at: z.string(),
})

type TreeVerdict = z.infer<typeof verdict_schema>

interface VerdictEntry {
	before: GateTree | undefined
	exit_code: number
	tail: string
}

const SHORT_HASH_LENGTH = 12

function record_path(name: string): string {
	return stamp_file.stamp_path(`josh-tree-verdict-${name}-`, PROJECT_ROOT)
}

// The tools and environment every declared check reads join the files and the base
// (`verification-inputs.ts`), so a tool upgrade or a changed `TZ` runs the checks again.
function tree_hash(tree: GateTree): string {
	const files = Object.entries(tree.files).map(([file, digest]) => `${file}\t${digest}`)
	const inputs = verification_inputs.fingerprint(verification_inputs.DECLARED_LABELS)

	return input_fingerprint.of_entries([...files, `base\t${tree.base ?? ''}`, `inputs\t${inputs}`])
}

function read_record(target: string): TreeVerdict | undefined {
	const raw = stamp_file.read_stamp_text(target)

	return raw === undefined ? undefined : json_value.parse_with(raw, verdict_schema)
}

// A tree read without a base is one git could not read, which describes no tree to key on.
function read(tree: GateTree | undefined, target: string): TreeVerdict | undefined {
	if (tree?.base === undefined) return undefined

	const verdict = read_record(target)

	return verdict?.tree === tree_hash(tree) ? verdict : undefined
}

function reused_line(verdict: TreeVerdict, target: string): string {
	const is_green = verdict.exit_code === 0
	const state = is_green ? 'green' : 'red'
	const line = `reused: tree ${verdict.tree.slice(0, SHORT_HASH_LENGTH)} ${state} at ${verdict.at}`

	return is_green ? line : `${line} — remove ${target} to run it again`
}

// `live` holds the notices the caller asks again rather than keeps: answers that read state outside the
// tree key (a running `test:pinned`, the lane's `lane:plan` record), so they can change on this tree.
function replay(
	verdict: TreeVerdict,
	target: string,
	live: ReadonlyArray<string | undefined> = [],
): number {
	const notices = live.map((notice) => (notice === undefined ? '' : `\n${notice}\n`)).join('')

	process.stdout.write(`${reused_line(verdict, target)}\n${notices}${verdict.tail}`)

	return verdict.exit_code
}

// Kept only for a tree that did not move while the check ran, as `scoped-green.ts` keeps its record:
// otherwise the verdict would answer for bytes no check read.
async function record(
	entry: VerdictEntry,
	read_after: () => Promise<GateTree>,
	target: string,
): Promise<void> {
	const { before, exit_code, tail } = entry

	if (before?.base === undefined || !scoped_green.is_unmoved(before, await read_after())) return

	const at = new Date().toISOString()

	stamp_file.replace_stamp(target, { tree: tree_hash(before), exit_code, tail, at })
}

const tree_verdict = { read, record, record_path, replay, reused_line }

export type { TreeVerdict, VerdictEntry }
export { tree_verdict }
