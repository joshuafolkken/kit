import { auto_ok_cli } from '#scripts/auto-ok/auto-ok-cli'
import { epic_bundle_gaps } from '#scripts/epic/epic-bundle-gaps'
import type { EpicChild } from '#scripts/epic/epic-graph'
import { epic_report, type EpicNextResult, type EpicVerdict } from '#scripts/epic/epic-report'
import { epic_triage, type TriageVerdict } from '#scripts/epic/epic-triage'
import { issue_not_before } from '#scripts/issue/issue-not-before'
import { session_cite } from '#scripts/issue/session-cite'
import { issue_citation } from '#scripts/rules/issue-citation'
import type { PoolContext } from './backlog-gate-scope'
import { backlog_next_size } from './backlog-next-size'
import { backlog_wait_cause } from './backlog-wait-cause'

// What `backlog:next` prints once its answer is decided: the tokens on standard output and every
// explanation on standard error. Split out of `backlog-next.ts` so the deciding half has room to grow.

const SUCCESS_EXIT_CODE = 0

// What `retry` says that `error` cannot.
//
// The anomaly `epic:next` raises for a child it could not read tells the reader to check
// `gh auth status` and that the issue exists — correct for the failure it was written for, and
// actively misleading for a name resolution that never reached GitHub at all. Neither the issue nor
// the credentials were the problem there, and the graph itself may be perfectly resolvable.
const RETRY_MESSAGE =
	'GitHub did not answer, so a child of the dependency graph could not be read. This is a transport failure and not an unusable graph — the listings this command already read prove `gh` and the credentials work. Ask again after a short wait.'

// `epic:next`'s verdicts, in this command's spelling, plus the one it has no word for.
//
// `complete` becomes `none` because a backlog is never finished the way one epic is — the token says
// "nothing to hand back", which is the same thing `auto-ok:next` prints, so a loop reading either
// command branches on one word. `run` never reaches standard output at all: the numbers do.
//
// **`retry` is this command's own and is deliberately not added to `EpicVerdict`.** `epic:next` has
// no failure path that could emit it, so widening the shared union would give every consumer of it a
// member none of them can produce — and `VERDICT_LINES` a line nothing ever prints. The token is a
// backlog-level answer about the transport, not a reading of one epic's graph.
//
// `triage` is `epic:next`'s word as well as this command's, but it is decided
// after the graph is read rather than from it, so it stays `epic_triage`'s type too.
type BacklogVerdict = EpicVerdict | 'retry' | TriageVerdict

const VERDICT_TOKENS: Readonly<Record<BacklogVerdict, string>> = {
	complete: auto_ok_cli.NONE_TOKEN,
	error: 'error',
	retry: 'retry',
	run: 'run',
	stop: 'stop',
	triage: epic_triage.TRIAGE_VERDICT,
	wait: 'wait',
}

// One token per line on standard output: the runnable issue numbers of **this** repository, in the
// order they may be started, or the single verdict word when there is nothing to offer here. Every
// explanation is on standard error, so `answers=$(pnpm josh backlog:next)` captures something a loop
// can branch on.
//
// **The tokens are scoped to this repository, which is `epic:next --repo`'s shape exactly.** An epic
// may track a child elsewhere, and a bare number would send the loop reading this to *this*
// repository's issue of that number — a different issue. Qualifying it
// instead was tried and is worse: `--exclude` parses bare integers, so a loop feeding a qualified
// token back would be answered with a usage error rather than an exclusion. So a child elsewhere
// stays out of the tokens, and `run` becomes `wait` when this repository has none — the same mapping
// `epic_next.repo_verdict` makes, and for the same reason: the work is real, it is simply not work
// this checkout can start. It is still on standard error, under its own repository and checkout.
function tokens_of(result: EpicNextResult, repo: string): ReadonlyArray<string> {
	if (result.verdict !== 'run') return [VERDICT_TOKENS[result.verdict]]
	const here = epic_report.candidates_for_repo(result, repo)
	if (here.length === 0) return [VERDICT_TOKENS.wait]

	return here.map((child) => String(child.number))
}

// The rows behind the number tokens — a standalone issue and an epic child alike.
function offered_of(result: EpicNextResult, repo: string): ReadonlyArray<EpicChild> {
	return result.verdict === 'run' ? epic_report.candidates_for_repo(result, repo) : []
}

// A listing that was cut short is reported rather than answered from silently: an opted-in issue
// past the cut is still runnable, and an epic past the cut leaves its children reading as untracked,
// which is true of any answer this command reaches — including one that never read a graph at all.
function warn_epic_gap(context: PoolContext): void {
	const epics = epic_bundle_gaps.epic_gap(context.tracking.cutoff, auto_ok_cli.LISTING_LIMIT)

	if (epics !== undefined) console.error(epics)
}

function warn_gaps(context: PoolContext, has_answer: boolean): void {
	const listing = auto_ok_cli.truncation_note(context.opted_in.cutoff, has_answer)

	if (listing !== undefined) console.error(listing)
	warn_epic_gap(context)
}

// Why a row on the time side is not offered yet, when the reason is a declared start time or sample
// condition — the waits a reader cannot see from the labels or the blockers. A sample condition names
// its pull request as `#N`, linkified like the explanation.
function warn_not_before(context: PoolContext): void {
	for (const issue of context.opted_in.issues) {
		const reason = issue_not_before.waiting_reason(issue.body)

		if (reason === undefined) continue

		const cited = session_cite.issue(issue.number, undefined, context.repo)

		console.error(`${cited} ${issue_citation.linkify(reason, context.repo)}`)
	}
}

// Which waiting issues hold the backlog on a dependency chain or a start condition, read back by
// `backlog:offer` so a lane held by them is told apart in `lane:stats` (joshuafolkken/kit#4513).
function warn_wait_causes(result: EpicNextResult, context: PoolContext): void {
	const causes = backlog_wait_cause.classify(result.waiting, context.repo)

	for (const line of backlog_wait_cause.lines_of(causes)) {
		console.error(issue_citation.linkify(line, context.repo))
	}
}

async function report(result: EpicNextResult, context: PoolContext): Promise<number> {
	warn_gaps(context, result.verdict === 'run')
	// The explanation names epics and children as `#N` (`tracked by epic #N`); linkified so the text a
	// run reads carries clickable references rather than bare ones. The stdout
	// tokens below are bare numbers by contract — a loop feeds them back to `--exclude` — so they are
	// left untouched.
	const explanation = epic_report.format_result(result, context.repo)

	console.error(issue_citation.linkify(explanation, context.repo))
	warn_not_before(context)

	const tokens = tokens_of(result, context.repo)

	if (tokens[0] === VERDICT_TOKENS.wait) warn_wait_causes(result, context)
	await backlog_next_size.warn_over_guide(offered_of(result, context.repo), context)
	for (const token of tokens) console.info(token)

	return SUCCESS_EXIT_CODE
}

// The unusable-graph report is withheld here rather than printed beside the retry: its anomaly lines
// name issues and credentials, which is exactly the wrong place to send the reader. **The epic gap is
// not withheld with it** — it says nothing about issues or credentials, and a run that spends its
// retries and then ends still has to have been told its epic listing was cut short.
//
// The opted-in listing's own truncation note is withheld, because both of its tails assert something
// this path did not do: one says an answer was produced, the other that every issue in the listing
// was excluded. Nothing was excluded here — the graph was never read.
function report_retry(context: PoolContext): number {
	warn_epic_gap(context)
	console.error(RETRY_MESSAGE)
	console.info(VERDICT_TOKENS.retry)

	return SUCCESS_EXIT_CODE
}

// The `triage` answer when no triaged candidate is left to offer beside an untriaged one: the numbers
// go to standard error, the one token to standard output.
function report_triage(context: PoolContext, untriaged: ReadonlyArray<EpicChild>): number {
	warn_epic_gap(context)
	console.error(epic_triage.message(untriaged, context.repo))
	console.info(VERDICT_TOKENS.triage)

	return SUCCESS_EXIT_CODE
}

// This repository's candidates without the untriaged ones, which wait for their judgment alone.
function without_untriaged(result: EpicNextResult, repo: string): EpicNextResult {
	const candidates = result.candidates.map((bucket) =>
		bucket.repo === repo
			? { ...bucket, children: bucket.children.filter((child) => epic_triage.is_triaged(child)) }
			: bucket,
	)

	return { ...result, candidates }
}

function has_offer(result: EpicNextResult, repo: string): boolean {
	return result.verdict === 'run' && epic_report.candidates_for_repo(result, repo).length > 0
}

// **An untriaged candidate holds only itself.** The `run:solo` gate cannot be applied to an issue whose
// label is not recorded yet, so it is gated without it: the triaged candidates are offered as before and
// a trailing `triage` token asks for the judgment beside them. A judgment that records `run:solo` stops
// the next offer through the gate's own rule. With nothing triaged left to offer the answer is
// `triage` alone. `gated` is `without_untriaged`'s result after the `run:solo` gate.
async function report_held(
	gated: EpicNextResult,
	context: PoolContext,
	untriaged: ReadonlyArray<EpicChild>,
): Promise<number> {
	if (!has_offer(gated, context.repo)) return report_triage(context, untriaged)

	await report(gated, context)
	console.error(epic_triage.held_message(untriaged, context.repo))
	console.info(VERDICT_TOKENS.triage)

	return SUCCESS_EXIT_CODE
}

// A backlog nobody has opted into answers `none` before the epic listing or the repository is read
// (`backlog_next.context_of`).
function report_none(): number {
	console.error(auto_ok_cli.NONE_OPTED_IN_MESSAGE)
	console.info(auto_ok_cli.NONE_TOKEN)

	return SUCCESS_EXIT_CODE
}

const backlog_next_report = {
	RETRY_MESSAGE,
	VERDICT_TOKENS,
	report,
	report_retry,
	without_untriaged,
	report_held,
	report_none,
}

export { backlog_next_report }
export type { BacklogVerdict }
