import { git_branch } from '#scripts/git/git-branch'
import { git_command } from '#scripts/git/git-command'
import { lane_child_marker } from '#scripts/lane/lane-child-marker'
import { bounded_pool } from '#scripts/lib/bounded-pool'
import { run_event_filed, type Filed } from '#scripts/run/event/run-event-filed'
import { run_event_stream, type RunEvent } from '#scripts/run/event/run-event-stream'
import { run_event_stream_emit } from '#scripts/run/event/run-event-stream-emit'
import { issue_file } from './issue-file'
import { issue_fold, type FoldVerdict } from './issue-fold'
import { issue_fold_cli } from './issue-fold-cli'
import { SPLIT_ROUTE_LABEL } from './issue-labels'
import { issue_state_cli } from './issue-state-cli'

// The fold question asked by `josh issue:file` itself, as the scout and
// `epic:bundle` already are. A separate `pnpm josh issue:fold` would cost two or three round trips per
// filing, for a question whose every input the command can read: the run's earlier filings are the `filed` events
// it appends to the event stream itself, and the size is `issue:fold`'s own reading of the diff.
//
// **The verdict is `issue_fold.fold_verdict`, called rather than restated**, with separability
// presumed as `issue:fold` presumes it. Only `fold` holds the filing; `undetermined` — no diff that
// measures the findings' size — files, the size then being the whole request's estimate the filer
// already made.

const REFERENCE_NUMBER = /#(?<number>\d+)$/u
const CLOSED_STATE = 'CLOSED'

// What the fold reads off the filing's arguments.
interface FoldArguments {
	route: string | undefined
	distinct: ReadonlyArray<number>
}

function number_of(reference: string): number {
	return Number(REFERENCE_NUMBER.exec(reference)?.groups?.['number'])
}

// What a filed reference carries before `#<N>`: nothing for this repository's Issue, `<owner>/<repo>`
// for one filed elsewhere. `issue:file` writes its references with it and the fold compares by it, so
// a finding is never folded into another repository's Issue. Compared as the Origin check compares,
// case-insensitively, so `--repo JoshuaFolkken/kit` and no `--repo` name one repository here too.
function reference_prefix(target: string, current: string): string {
	return issue_file.is_same_repository(target, current) ? '' : target
}

function prefix_of(reference: string): string {
	return reference.slice(0, reference.lastIndexOf('#'))
}

// The Issue the checkout's branch names; a git read that fails names none.
async function branch_issue(): Promise<number | undefined> {
	try {
		return git_branch.issue_from_branch(await git_command.branch())
	} catch {
		return undefined
	}
}

// Whose work turned the finding up: the lane child's mark, else the Issue the checkout's branch names,
// so a person's `fullrun` on `3423-x` is one finder across its filings just as a lane child is. A
// checkout on no Issue's branch — a `backlogrun` parent on `main` — has none.
async function finder(): Promise<string | undefined> {
	const marked = lane_child_marker.marked_issue()

	if (marked !== undefined) return marked
	const issue = await branch_issue()

	return issue === undefined ? undefined : String(issue)
}

// The events the fold reads. A finder's filings are its own wherever they fall on the stream, so they
// are read whole — a person's run has no carry record to scope by. With no finder, the invocation the
// carry record scopes is the run.
async function events_of(found_during: string | undefined): Promise<ReadonlyArray<RunEvent>> {
	if (found_during === undefined) return await run_event_stream_emit.current_events()

	return await run_event_stream_emit.all_events()
}

// This run's earlier filings by the same finder — so a parallel lane's filing is never what this one
// folds into — in the repository this filing targets. One the caller named in `--distinct` has been
// declared a separate deliverable and is left out, the same declaration the scout's candidates take.
function prior_filings(
	events: ReadonlyArray<RunEvent>,
	found_during: string | undefined,
	prefix: string,
	distinct: ReadonlyArray<number>,
): ReadonlyArray<Filed> {
	return events
		.filter((event) => event.kind === run_event_stream.EVENT_KIND.FILED)
		.flatMap((event) => run_event_filed.parse(event.text) ?? [])
		.filter((filed) => filed.found_during === found_during && prefix_of(filed.reference) === prefix)
		.filter((filed) => !distinct.includes(number_of(filed.reference)))
}

// Whether an earlier filing is still in the backlog. A finder's filings are read across invocations,
// so one may have closed since — folding into it would take the finding out of the backlog. A state
// that could not be read keeps the filing: a failed read is never taken as closed.
async function is_open(filed: Filed, prefix: string): Promise<boolean> {
	const repo = prefix === '' ? undefined : prefix
	const read = await issue_state_cli.read_issue(String(number_of(filed.reference)), repo)

	return read.kind !== 'state' || read.state.state !== CLOSED_STATE
}

// Through the shared pool at `issue:state`'s bound rather than a raw `Promise.all`, so a finder's
// filings never draw the secondary rate limiting that reads back as `unreadable`.
async function open_filings(
	priors: ReadonlyArray<Filed>,
	prefix: string,
): Promise<ReadonlyArray<Filed>> {
	const verdicts = await bounded_pool.bounded_map(
		priors,
		issue_state_cli.READ_CONCURRENCY,
		async (filed) => await is_open(filed, prefix),
	)

	return priors.filter((_filed, index) => verdicts[index])
}

function references_of(priors: ReadonlyArray<Filed>): string {
	return priors.map((filed) => filed.reference).join(', ')
}

function line_of(verdict: FoldVerdict, priors: ReadonlyArray<Filed>): string {
	return `fold: ${issue_fold_cli.REASONS[verdict]} · filed earlier by this finder: ${references_of(priors)}`
}

function held_message(priors: ReadonlyArray<Filed>): string {
	const listed = priors.map((filed) => String(number_of(filed.reference))).join(',')

	return `✖ fold: add this finding to ${references_of(priors)} (its body or a comment) rather than filing it; a finding that is really a separate deliverable reissues with \`--distinct ${listed}\` (\`split-assessment.md\` → "The question").`
}

// Whether the filing may go on: `true` with no open earlier filing to fold with, and on every verdict
// but `fold`. The verdict is printed whenever there was something to fold with. A split child is
// exempt, as it is from the WIP cap: the split assessment already decided it is a separate deliverable.
async function is_fold_clear(prefix: string, args: FoldArguments): Promise<boolean> {
	if (args.route === SPLIT_ROUTE_LABEL) return true
	const found_during = await finder()
	const filings = prior_filings(await events_of(found_during), found_during, prefix, args.distinct)
	const priors = await open_filings(filings, prefix)

	if (priors.length === 0) return true
	const size = await issue_fold_cli.size_verdict()
	const verdict = issue_fold.fold_verdict(priors.length + 1, true, size)

	console.info(line_of(verdict, priors))
	if (verdict === issue_fold.FOLD) console.error(held_message(priors))

	return verdict !== issue_fold.FOLD
}

const issue_file_fold = { finder, is_fold_clear, prior_filings, reference_prefix }

export { issue_file_fold }
