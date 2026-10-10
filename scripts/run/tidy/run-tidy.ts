import { session_cite } from '#scripts/issue/session-cite'
import { observation_ledger_line } from '#scripts/observations/observation-ledger-line'

// The decisions behind `josh run:tidy`, kept apart from the git and GitHub reads so each
// can be pinned without either. A run start sweeps what merged work left behind — the
// lanes holding a seat after their branch merged, and the stashes of issues that are all merged — and
// every rule here is written so that doubt keeps the thing: a lane with any uncommitted change or any
// commit no remote has, and a stash naming any issue that is not merged or naming none at all, stay.

const LINE_SEPARATOR = '\n'
const CLEANED_HEADER = 'run:tidy — cleaned:'
const KEPT_HEADER = 'run:tidy — kept:'
const CHANGES_REASON = 'uncommitted changes'
const UNPUSHED_REASON = 'commits no remote has'
const RUNNING_REASON = 'held by a live run'

interface LaneFacts {
	issue: string
	is_merged: boolean
	has_changes: boolean
	has_unpushed: boolean
	is_running: boolean
}

interface StashFacts {
	subject: string
	issues: ReadonlyArray<string>
}

type Verdict = { kind: 'clean' } | { kind: 'keep'; reason: string }

interface Outcome {
	target: string
	verdict: Verdict
}

const CLEAN: Verdict = { kind: 'clean' }

function keep(reason: string): Verdict {
	return { kind: 'keep', reason }
}

// A lane whose issue is still open is some run's, so it is left out of the report entirely rather than
// listed as kept — the report names what merged work left behind, not every lane.
function lane_verdict(facts: LaneFacts): Verdict | undefined {
	if (!facts.is_merged) return undefined

	if (facts.has_changes) return keep(CHANGES_REASON)

	if (facts.has_unpushed) return keep(UNPUSHED_REASON)

	return facts.is_running ? keep(RUNNING_REASON) : CLEAN
}

function unmerged_reason(unmerged: ReadonlyArray<string>): string {
	const named = unmerged.map((issue) => session_cite.issue(issue)).join(', ')

	return `${named} not merged`
}

// Like a lane, a stash naming no merged issue is left out of the report: one naming no issue at all,
// or only open ones, is not merged work's residue, and listing it at every run start would bury the
// entries that are.
function stash_verdict(facts: StashFacts, merged: ReadonlySet<string>): Verdict | undefined {
	const unmerged = facts.issues.filter((issue) => !merged.has(issue))

	if (unmerged.length === facts.issues.length) return undefined

	return unmerged.length === 0 ? CLEAN : keep(unmerged_reason(unmerged))
}

// The ledger lines a stash would carry away with it, less those the ledger already holds — the same
// line appended twice would read as a recurrence to the observation digest, which counts repeats.
function ledger_carry(added: ReadonlyArray<string>, ledger: string): Array<string> {
	const entries = added.filter((line) => observation_ledger_line.is_ledger_entry_line(line))

	return observation_ledger_line.missing_lines([...new Set(entries)], ledger)
}

function format_outcome(outcome: Outcome): string {
	const suffix = outcome.verdict.kind === 'keep' ? ` — ${outcome.verdict.reason}` : ''

	return `  ${outcome.target}${suffix}`
}

function section(header: string, outcomes: ReadonlyArray<Outcome>): Array<string> {
	return outcomes.length === 0 ? [] : [header, ...outcomes.map((item) => format_outcome(item))]
}

// `undefined` when the sweep found nothing merged, so an ordinary run start prints nothing.
function format_report(outcomes: ReadonlyArray<Outcome>): string | undefined {
	const cleaned = outcomes.filter((outcome) => outcome.verdict.kind === 'clean')
	const kept = outcomes.filter((outcome) => outcome.verdict.kind === 'keep')
	const lines = [...section(CLEANED_HEADER, cleaned), ...section(KEPT_HEADER, kept)]

	return lines.length === 0 ? undefined : lines.join(LINE_SEPARATOR)
}

const run_tidy = { CLEAN, format_report, keep, lane_verdict, ledger_carry, stash_verdict }

export type { LaneFacts, Outcome, StashFacts, Verdict }
export { run_tidy }
