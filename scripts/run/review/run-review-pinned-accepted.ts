import path from 'node:path'
import { git_command } from '#scripts/git/git-command'
import { stamp_file } from '#scripts/josh/stamp-file'
import { error_text } from '#scripts/lib/error-message'
import { test_pinned_record, type PinnedSummary } from '#scripts/test/test-pinned-record'
import { run_review_pinned, type PinnedVerdict } from './run-review-pinned'

// **An `--unpinned-ok` reason outlives the run that gave it** (joshuafolkken/kit#4775). A lane
// dispatched again after its ship stopped launched the next ship without the reason, and the join
// stopped on the places the earlier ship had already accepted. The accepted reason and places are kept
// in the work tree's own git directory, beside the ship body draft (`run-ship-body-draft.ts`), for the
// branch that accepted them. A later run with no reason carries on under the recorded one while every
// unpinned place is among the recorded ones; a place outside them stops the run as before.

const RECORD_NAME = 'josh-unpinned-ok.json'
const RECORDED_NOTE = 'Unpinned accepted by an earlier run on this branch: '

interface Accepted {
	branch: string
	reason: string
	unpinned: ReadonlyArray<string>
}

async function record_path(): Promise<string | undefined> {
	const [git_directory] = await git_command.git_directories()

	return git_directory === undefined ? undefined : path.join(git_directory, RECORD_NAME)
}

async function write(reason: string, unpinned: ReadonlyArray<string>): Promise<void> {
	const target = await record_path()

	if (target === undefined) return
	stamp_file.replace_stamp(target, { branch: await git_command.branch(), reason, unpinned })
}

function to_accepted(record: Record<string, unknown>): Accepted | undefined {
	const { branch, reason, unpinned } = record

	if (typeof branch !== 'string' || typeof reason !== 'string') return undefined

	return test_pinned_record.is_text_list(unpinned) ? { branch, reason, unpinned } : undefined
}

function read_record(target: string | undefined): Accepted | undefined {
	const raw = target === undefined ? undefined : stamp_file.read_stamp_text(target)
	const record = raw === undefined ? undefined : test_pinned_record.parsed(raw)

	return record === undefined ? undefined : to_accepted(record)
}

// A record another branch left in a shared git directory accepts nothing here.
async function recorded(): Promise<Accepted | undefined> {
	const accepted = read_record(await record_path())

	return accepted?.branch === (await git_command.branch()) ? accepted : undefined
}

function covering_reason(
	accepted: Accepted | undefined,
	unpinned: ReadonlyArray<string>,
): string | undefined {
	const known = new Set(accepted?.unpinned)

	return unpinned.every((site) => known.has(site)) ? accepted?.reason : undefined
}

// A record that could not be written or read accepts nothing later, so the run stops as before.
async function remember(reason: string, unpinned: ReadonlyArray<string>): Promise<void> {
	try {
		await write(reason, unpinned)
	} catch (error) {
		error_text.trace_swallowed('run_review_pinned_accepted.remember', error)
	}
}

async function earlier_reason(unpinned: ReadonlyArray<string>): Promise<string | undefined> {
	try {
		return covering_reason(await recorded(), unpinned)
	} catch (error) {
		error_text.trace_swallowed('run_review_pinned_accepted.earlier_reason', error)

		return undefined
	}
}

// The reason this branch recorded, whatever places it held (joshuafolkken/kit#4974): a `josh ship
// --review` given none carries it as its `--unpinned-ok`. One that could not be read is none.
async function recorded_reason(): Promise<string | undefined> {
	try {
		const accepted = await recorded()

		return accepted?.reason
	} catch (error) {
		error_text.trace_swallowed('run_review_pinned_accepted.recorded_reason', error)

		return undefined
	}
}

// `run_review_pinned.verdict_of`, with this run's reason recorded and, without one, the recorded reason
// standing in for it. **The recorded reason never judges a check cut at its first unpinned hunk**
// (joshuafolkken/kit#5153): its list is not every place, so a place outside the record could be
// among those it left, and the run stops.
async function judge(summary: PinnedSummary, reason: string | undefined): Promise<PinnedVerdict> {
	if (summary.unpinned.length === 0) return run_review_pinned.verdict_of(summary, reason)

	if (reason !== undefined) {
		await remember(reason, summary.unpinned)

		return run_review_pinned.verdict_of(summary, reason)
	}

	const earlier = summary.is_cut === true ? undefined : await earlier_reason(summary.unpinned)

	if (earlier === undefined) return run_review_pinned.verdict_of(summary, undefined)

	return { kind: 'accepted', text: `${summary.text}${RECORDED_NOTE}${earlier}\n` }
}

const run_review_pinned_accepted = { RECORD_NAME, judge, recorded_reason }

export { run_review_pinned_accepted }
