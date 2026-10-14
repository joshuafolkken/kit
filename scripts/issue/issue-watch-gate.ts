import { git_command } from '#scripts/git/git-command'
import { session_cite } from '#scripts/issue/session-cite'
import { review_attest } from '#scripts/review/review-attest'
import { issue_watch, type WatchRecord } from './issue-watch'

// The refusals a person's unread issue update raises, composed once so the hook, `josh review:attest
// --check` and `josh followup` say the same thing about the same state.
//
// **The gates poll on every call** (`interval_ms: 0`): they run a handful of times per run, and the
// poll is a conditional request that a 304 answers for free. Only the hook, which runs on every tool
// call, spaces its polls out.

const EVERY_CALL_MS = 0

function ack_command(issue: string): string {
	return `pnpm josh issue:ack ${issue}`
}

function unread_message(record: Pick<WatchRecord, 'issue' | 'pending'>): string {
	return [
		`A person updated issue ${session_cite.issue(record.issue)} after this run read it, and the run has not taken the update in:`,
		record.pending ?? '',
		`Read it, compare it with the acceptance criteria, fix what it changes, then run \`${ack_command(record.issue)}\` to record that it was read.`,
	].join('\n\n')
}

function review_message(record: WatchRecord, briefed_at: string): string {
	return [
		`Issue ${session_cite.issue(record.issue)} was updated after the review was briefed (taken in at ${record.acknowledged_at}, briefed at ${briefed_at}), so the review read the earlier specification.`,
		'Re-run `/code-review` with a fresh `pnpm josh review:brief`, so the review reads the change against the updated issue.',
	].join('\n')
}

async function polled(root: string): Promise<WatchRecord | undefined> {
	return await issue_watch.poll({ interval_ms: EVERY_CALL_MS }, root)
}

// The merge-time refusal: a person's update the run has not acknowledged. `undefined` when there is
// none, when no run recorded a baseline in this checkout, or when the issue could not be read — an
// unreachable GitHub does not hold a merge `josh followup` would otherwise make.
async function unread_refusal(root: string): Promise<string | undefined> {
	const record = await polled(root)

	return record?.pending === undefined ? undefined : unread_message(record)
}

// The review-time refusal: an unread update, or one taken in after the review was briefed — the fix
// it led to is then a change the review never saw.
async function review_refusal(root: string): Promise<string | undefined> {
	const record = await polled(root)

	if (record === undefined) return undefined
	if (record.pending !== undefined) return unread_message(record)

	const pointer = review_attest.read_pointer(root)

	if (pointer === undefined || record.acknowledged_at <= pointer.taken_at) return undefined

	return review_message(record, pointer.taken_at)
}

async function review_refusal_here(): Promise<string | undefined> {
	return await review_refusal(await git_command.repository_root())
}

// Throws the refusal, for the `josh followup` seams that stop by throwing.
async function assert_read_here(): Promise<void> {
	const refusal = await unread_refusal(await git_command.repository_root())

	if (refusal !== undefined) throw new Error(refusal)
}

const issue_watch_gate = {
	assert_read_here,
	review_refusal,
	review_refusal_here,
	unread_message,
	unread_refusal,
}

export { issue_watch_gate }
