import { answer_judge } from '#scripts/agent/answer-judge'
import type { AnswerVerdict, Evidence } from '#scripts/agent/answer-verdict'
import { git_gh_command } from '#scripts/gh/git-gh-command'
import { issue_sources, type SourcesRead } from '#scripts/issue/issue-sources'
import { session_cite } from '#scripts/issue/session-cite'
import { run_hold } from '#scripts/run/hold/run-hold'

// joshuafolkken/kit#6510: **a close `pkg:scout` verdict that the Issue has already decided.** When the
// target Issue — `--issue <n>`, else the run held on this tree — decides to reuse existing code instead
// of adding a package, the shared judgment (`answer-judge.ts`, the park's own) says so with verbatim
// evidence, and that decision is recorded on the Issue as an `Auto-decided:` comment. Each way the
// check can stop is its own outcome with its own note, so a decision not recorded never reads as made.

interface ReuseRequest {
	issue: string | undefined
	keywords: string
	rejected: string
	directory: string
}

type PendingKind = 'unknown' | 'unreadable' | 'failed' | 'undecided' | 'record-failed'

// `note` is the line a caller prints as it is — the decision on `recorded`, the reason it was not
// taken on every other kind.
type ReuseOutcome =
	{ kind: PendingKind; note: string } | { kind: 'recorded'; note: string; url: string }

const RECORD_FAILED = 'record-failed'
// The pending kinds a caller treats as a failed command: the check was asked for and did not finish.
const FAILURE_KINDS: ReadonlySet<ReuseOutcome['kind']> = new Set<PendingKind>([
	'unreadable',
	'failed',
	RECORD_FAILED,
])
const UNKNOWN: ReuseOutcome = {
	kind: 'unknown',
	note: 'Reuse check: no target Issue (no run held here, no --issue), so no Issue decision was read.',
}

const AUTO_DECIDED_REUSE = 'Auto-decided: reuse existing code'

type Answered = Extract<AnswerVerdict, { kind: 'answered' }>
type ReadFailure = Exclude<SourcesRead, { kind: 'sources' }>
type ReadSources = Extract<SourcesRead, { kind: 'sources' }>['sources']

// Outside a git work tree there is no held run to read: the unknown outcome, not a crash.
async function held_directory(): Promise<string | undefined> {
	try {
		return await run_hold.worktree_directory()
	} catch {
		return undefined
	}
}

async function held_issue(): Promise<string | undefined> {
	const target = await held_directory()
	if (target === undefined) return undefined
	const read = run_hold.read_hold(run_hold.hold_path(target))

	if (read.kind !== 'held' || read.hold.issue === run_hold.UNNUMBERED_ISSUE) return undefined

	return read.hold.issue
}

async function target_issue(explicit: string | undefined): Promise<string | undefined> {
	return explicit ?? (await held_issue())
}

function question_of(keywords: string): string {
	return [
		'Does this Issue decide to reuse existing code — naming the source file or function it',
		`reuses — instead of adding an npm package for "${keywords}"?`,
	].join(' ')
}

function unreadable(issue: string, read: ReadFailure): ReuseOutcome {
	const detail = read.hint === undefined ? read.kind : `${read.kind} — ${read.hint}`

	return {
		kind: 'unreadable',
		note: `Reuse check: ${session_cite.issue(issue)} could not be read (${detail}), so its decision is unknown.`,
	}
}

function evidence_line(evidence: Evidence): string {
	return `- ${evidence.source.id}: "${evidence.quote}"`
}

function scout_mark(keywords: string): string {
	return `\`pkg:scout ${keywords}\` ranked a close pair`
}

function comment_body(request: ReuseRequest, verdict: Answered): string {
	const decision = [
		`${AUTO_DECIDED_REUSE} (${verdict.decision}) over adding ${request.rejected}`,
		`because this Issue decides it — ${scout_mark(request.keywords)},`,
		'so no dependency is added (Tier A).',
	].join(' ')

	return [
		decision,
		'',
		'Evidence:',
		...verdict.evidence.map((evidence) => evidence_line(evidence)),
	].join('\n')
}

function decided(issue: string, verdict: Answered): string {
	return `${session_cite.issue(issue)} decides to reuse existing code (${verdict.decision})`
}

function record_failed(issue: string, verdict: Answered, error: unknown): ReuseOutcome {
	const note = [
		`Reuse check: ${decided(issue, verdict)}, but recording the Auto-decided comment failed`,
		`(${String(error)}), so nothing was auto-decided.`,
	].join(' ')

	return { kind: RECORD_FAILED, note }
}

async function record(
	issue: string,
	request: ReuseRequest,
	verdict: Answered,
): Promise<ReuseOutcome> {
	try {
		const url = await git_gh_command.issue_comment(issue, comment_body(request, verdict))

		return { kind: 'recorded', note: decided(issue, verdict), url }
	} catch (error) {
		return record_failed(issue, verdict, error)
	}
}

async function outcome_of(
	issue: string,
	request: ReuseRequest,
	verdict: AnswerVerdict,
): Promise<ReuseOutcome> {
	const cited = session_cite.issue(issue)

	if (verdict.kind === 'failed') {
		const note = `Reuse check: the judgment on ${cited} failed (${verdict.cause}). ${verdict.retry}`

		return { kind: 'failed', note }
	}

	if (verdict.kind === 'unanswered' || verdict.decision_kind !== 'reuse') {
		return {
			kind: 'undecided',
			note: `Reuse check: ${cited} does not decide to reuse existing code.`,
		}
	}

	return await record(issue, request, verdict)
}

function is_record_of(source: ReadSources[number], keywords: string): boolean {
	return source.text.startsWith(AUTO_DECIDED_REUSE) && source.text.includes(scout_mark(keywords))
}

// A re-run reads its own earlier record as trusted evidence, so an Issue whose latest source is this
// scout's Auto-decided comment is settled by it — no second judgment and no second comment. Any source
// after the record may reverse the decision, so the Issue is judged again.
function recorded_before(
	issue: string,
	request: ReuseRequest,
	sources: ReadSources,
): ReuseOutcome | undefined {
	const latest = sources.at(-1)
	if (latest === undefined || !is_record_of(latest, request.keywords)) return undefined

	return {
		kind: 'recorded',
		note: `${session_cite.issue(issue)} already records this reuse decision`,
		url: latest.id,
	}
}

async function check(request: ReuseRequest): Promise<ReuseOutcome> {
	const issue = await target_issue(request.issue)
	if (issue === undefined) return UNKNOWN
	const read = await issue_sources.read_sources(issue)

	if (read.kind !== 'sources') return unreadable(issue, read)
	const prior = recorded_before(issue, request, read.sources)
	if (prior !== undefined) return prior

	const question = question_of(request.keywords)
	const verdict = await answer_judge.judge({
		question,
		sources: read.sources,
		directory: request.directory,
	})

	return await outcome_of(issue, request, verdict)
}

// A caller reading only the exit code must not take a ranking whose check stopped as settled.
function is_failure(outcome: ReuseOutcome): boolean {
	return FAILURE_KINDS.has(outcome.kind)
}

const package_scout_reuse = { check, is_failure }

export type { ReuseOutcome, ReuseRequest }
export { package_scout_reuse }
