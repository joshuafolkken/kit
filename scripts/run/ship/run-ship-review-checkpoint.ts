import { gate_tree, type GateTree } from '#scripts/gate/gate-tree'
import { git_command } from '#scripts/git/git-command'
import { PROJECT_ROOT } from '#scripts/init/init-paths'
import { file_map_stamp, type FileMapStampAccess } from '#scripts/josh/file-map-stamp'
import type { JoshResult } from '#scripts/josh/josh-run'
import { review_attest } from '#scripts/review/review-attest'
import { review_prompt_level, type RetryTrigger } from '#scripts/review/review-prompt-level'
import { run_ship_scoped, type Phase } from './run-ship-scoped'

// A step's phase; a rerun step receives the retry that reruns it, when one names it.
type RetryPhase = (retry?: RetryTrigger) => Promise<JoshResult>
type NamedPhase = readonly [name: string, phase: RetryPhase]

interface Checkpoint {
	name: string
	phase: RetryPhase
	stamp: FileMapStampAccess
}

// How many leading steps are reused, and the retry the rest rerun under.
interface Resume {
	count: number
	retry: RetryTrigger | undefined
}

function checkpoints(
	issue: string,
	stage: string,
	phases: ReadonlyArray<NamedPhase>,
	head: string,
): ReadonlyArray<Checkpoint> {
	return phases.map(([name, phase]) => ({
		name,
		phase,
		stamp: file_map_stamp.create(
			`josh-ship-review-step-${issue}-${stage}-${name}-`,
			PROJECT_ROOT,
			() => head,
		),
	}))
}

function matches(stamp: FileMapStampAccess, tree: GateTree): boolean {
	const prior = stamp.read()

	if (prior?.completed_at === undefined) return false

	return (
		stamp.describes_inputs(prior) &&
		file_map_stamp.describes_base(prior, tree.base) &&
		file_map_stamp.changed_since(prior, tree.files).length === 0
	)
}

// A provider rerun because its attestation is missing or mismatched names that retry to the phases it
// reruns, so the relaunched reviewers' prompts say why they run (joshuafolkken/kit#8492).
async function attested_prefix(entries: ReadonlyArray<Checkpoint>, count: number): Promise<Resume> {
	const provider = entries.findIndex(({ name }) => name === 'provider')

	if (provider === -1 || provider >= count) return { count, retry: undefined }
	const { status } = await review_attest.check_here()

	return status === 'missing' || status === 'mismatch'
		? { count: provider, retry: review_prompt_level.RETRY.ATTEST }
		: { count, retry: undefined }
}

// Only a completed prefix survives: rerunning a provider replaces its brief and nonce, so a later
// attestation from an earlier attempt must never be reused even when the file map is unchanged.
async function reusable_prefix(
	entries: ReadonlyArray<Checkpoint>,
	tree: GateTree,
	is_stale: boolean,
): Promise<Resume> {
	const missing = entries.findIndex(({ stamp }) => is_stale || !matches(stamp, tree))
	const resume = await attested_prefix(entries, missing === -1 ? entries.length : missing)

	for (const { stamp } of entries.slice(resume.count)) stamp.remove()

	return resume
}

async function recorded(
	phase: Phase,
	stamp: FileMapStampAccess,
	tree: GateTree,
): Promise<JoshResult> {
	stamp.write(tree.files, { base: tree.base })
	const result = await phase()

	if (result.code === 0) stamp.complete()

	return result
}

async function run(
	issue: string,
	stage: string,
	phases: ReadonlyArray<NamedPhase>,
	is_stale = false,
): Promise<JoshResult> {
	const tree = await gate_tree.read_gate_tree()

	if (tree.base === undefined || Object.keys(tree.files).length === 0) {
		for (const { stamp } of checkpoints(issue, stage, phases, '')) stamp.remove()

		return await run_ship_scoped.run_phases(phases.map(([, phase]) => phase))
	}

	const entries = checkpoints(issue, stage, phases, await git_command.head_commit())
	const { count, retry } = await reusable_prefix(entries, tree, is_stale)

	return await run_ship_scoped.run_phases(
		entries.map(({ name, phase, stamp }, index) => async () => {
			if (index < count) return { code: 0, out: `review step ${name}: reused` }

			return await recorded(async () => await phase(retry), stamp, tree)
		}),
	)
}

const run_ship_review_checkpoint = { run }

export type { NamedPhase, RetryPhase }
export { run_ship_review_checkpoint }
