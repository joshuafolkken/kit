import { git_branch } from '#scripts/git/git-branch'
import { git_command } from '#scripts/git/git-command'
import { issue_declared_size } from '#scripts/issue/issue-declared-size'
import { lane_ledger_write } from '#scripts/lane/lane-ledger-write'
import { observation_ledger_home } from '#scripts/observations/observation-ledger-home'
import { split_measure } from '#scripts/split/split-measure'
import { review_comment_round } from './review-comment-round'
import { review_finding_ledger, type LineKind } from './review-finding-ledger'
import { review_gate_mode } from './review-gate-mode'
import { review_round } from './review-round'

const NOTE = 'round1: skipped-in-size'
const BLOCKING = new Set(['high', 'medium'])
const KINDS: ReadonlyArray<LineKind> = ['code', 'interaction']

async function is_in_size(issue: number): Promise<boolean> {
	const declared = await issue_declared_size.read(String(issue))

	if (declared === undefined || Math.min(declared.files, declared.lines) <= 0) return false
	const actual = await split_measure.read_branch()

	return actual.files <= declared.files && actual.lines <= declared.lines
}

async function is_eligible(issue: number): Promise<boolean> {
	if (!(await is_in_size(issue))) return false
	const content = await observation_ledger_home.read(undefined, true)

	if (content === undefined) return false
	const comments = await review_comment_round.issue_lines(issue)
	const history = [content, ...comments].join('\n')

	return KINDS.every((kind) =>
		review_finding_ledger
			.issue_dispositions(history, issue, kind)
			.every((line) => !BLOCKING.has(line.severity)),
	)
}

// Every uncertainty keeps round one; only a complete history and measurement can omit it.
async function eligible_issue(): Promise<number | undefined> {
	if (review_gate_mode.read() !== 'local') return undefined

	try {
		const issue = git_branch.issue_from_branch(await git_command.branch())

		return issue !== undefined && (await is_eligible(issue)) ? issue : undefined
	} catch {
		return undefined
	}
}

async function record(issue: number): Promise<void> {
	await lane_ledger_write.record_round_one({ issue, verdict: 'skipped' })
	process.stderr.write(`${NOTE}\n`)
}

async function run(
	issue: number | undefined,
	review: (round: number, is_full_change: boolean) => Promise<number>,
): Promise<number> {
	const is_skipped = issue !== undefined
	const result = await review(is_skipped ? review_round.SECOND_ROUND : 1, is_skipped)

	if (result === 0 && issue !== undefined) await record(issue)

	return result
}

const review_round_one_skip = { eligible_issue, record, run, NOTE }

export { review_round_one_skip }
