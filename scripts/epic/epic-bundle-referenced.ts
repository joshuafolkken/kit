import { git_gh_command } from '#scripts/git/git-gh-command'
import { epic_audit_logic } from './epic-audit'
import type { BacklogIssue } from './epic-bundle'
import { epic_issue, type EpicIssue } from './epic-issue'

// Candidates the open backlog cannot show, read from the subject's own prose.
//
// `epic:bundle` searched open issues only, which left a window of minutes in which it could answer
// correctly: a follow-up issue names its parent, and the parent's pull request merges right after —
// on joshuafolkken/kit#943 the gap between filing and the parent closing was about three minutes.
// Past it the command reported `Nothing to bundle.` with exit 0, asserting there was no relation
// rather than that it had not looked (joshuafolkken/kit#947).
//
// The numbers a body names are information the command already holds; the open listing was never
// what supplied them. Only the *reading* of those issues needs a request, and this module decides
// which ones are worth one and which of the answers count.

// One `gh issue view` each, so the count is what bounds the cost. Chosen an order of magnitude above
// the references a real issue body carries — kit#946's body names five — so the cap is a runaway
// guard rather than something an ordinary issue reaches. A body naming more than this is prose about
// the backlog, not an issue with twenty prerequisites.
const REFERENCED_LOOKUP_LIMIT = 20

// The numbers the subject's body names that the open listing did not already provide.
//
// Deliberately one-way: the reverse — a closed issue whose body names the subject — would mean
// scanning every closed issue in the repository. It is not needed, because a follow-up issue naming
// its parent is what the filing procedure itself requires (`prompts/review.md` → "Review round cap").
interface ReferencedLookups {
	numbers: Array<number>
	// The references the cap left unread. Named rather than dropped: silently truncating puts the
	// command back to asserting there was no relation when it had merely stopped looking — the same
	// failure the whole module removes, reintroduced by its own guard.
	dropped: Array<number>
}

function referenced_lookups(subject: BacklogIssue, known: ReadonlySet<number>): ReferencedLookups {
	const candidates = epic_audit_logic
		.parse_references(subject.body, subject.repo)
		.filter((number) => number !== subject.number && !known.has(number))

	return {
		numbers: candidates.slice(0, REFERENCED_LOOKUP_LIMIT),
		dropped: candidates.slice(REFERENCED_LOOKUP_LIMIT),
	}
}

interface ReferencedContext {
	repo: string
	// Which epic tracks each issue, from the open epics' task lists.
	epics: ReadonlyMap<number, number>
	// The open epics themselves, so an epic never enters its own children's candidate pool.
	epic_numbers: ReadonlySet<number>
}

function to_backlog_issue(issue: EpicIssue, context: ReferencedContext): BacklogIssue {
	const epic = context.epics.get(issue.number)

	return {
		number: issue.number,
		repo: context.repo,
		body: issue.body,
		blocked_by: epic_issue.blockers_of(issue),
		is_epic: context.epic_numbers.has(issue.number),
		...(epic !== undefined && { epic }),
	}
}

// Whether a referenced issue read this way belongs in the candidate pool.
//
// An open one always does — it may simply have been past the listing's cap. A closed one counts only
// when an open epic already tracks it, and that restriction is the point of the whole read: the
// answer worth recovering is `add_to_epic <that epic>`. `create_epic` over a closed issue would
// build an epic whose other child is already finished — nothing for a run to execute, and an epic
// that reads as half-done from the moment it is created.
function is_usable_candidate(issue: BacklogIssue, read: EpicIssue): boolean {
	if (issue.is_epic === true) return false
	// `gh issue view` answers for a pull request too, and a body citing "the fix landed in #952" is
	// ordinary prose. Without this, a merged PR reads as an open issue in no epic and the command
	// proposes creating an epic with a pull request among its children (joshuafolkken/kit#947).
	if (epic_issue.is_pull_request(read)) return false

	return epic_issue.is_open(read.state) || issue.epic !== undefined
}

// How one referenced number came back. `missing` is GitHub resolving it to nothing — a typo, or a
// number belonging to another repository quoted in prose — which is an answer, not a gap: there is
// no candidate and nothing was lost. `unreadable` is the gap, and it is the only one reported
// (joshuafolkken/kit#957).
interface ReferencedRead {
	number: number
	result: EpicIssue | 'missing' | 'unreadable'
}

function is_failed_read(result: ReferencedRead['result']): result is 'missing' | 'unreadable' {
	return typeof result === 'string'
}

interface ReferencedResult {
	// The ones that qualify, shaped like any other backlog issue so the decision logic is unchanged.
	issues: Array<BacklogIssue>
	// The ones whose read failed, and the ones the cap never reached. Both are gaps rather than
	// answers: folded into "no relation found" they become the confident wrong verdict this whole
	// module exists to remove. A number that resolves to nothing is **not** here — reporting it as a
	// gap stops an unattended run over a reference that never existed (joshuafolkken/kit#957).
	unreadable: Array<number>
}

function usable_candidates(
	reads: ReadonlyArray<ReferencedRead>,
	context: ReferencedContext,
): Array<BacklogIssue> {
	return reads.flatMap((read) => {
		if (is_failed_read(read.result)) return []
		const candidate = to_backlog_issue(read.result, context)

		return is_usable_candidate(candidate, read.result) ? [candidate] : []
	})
}

function collect_referenced(
	reads: ReadonlyArray<ReferencedRead>,
	context: ReferencedContext,
): ReferencedResult {
	return {
		issues: usable_candidates(reads, context),
		unreadable: reads.filter((read) => read.result === 'unreadable').map((read) => read.number),
	}
}

// One `gh issue view` per reference, a few at a time. Batched for the same reason the relation reads
// are: spawning every request at once is what turns a rate limit into a wrong answer, because a
// refused read arrives as an absence rather than as an error.
const LOOKUP_CONCURRENCY = 8

// A read that came back shaped wrong counts as unreadable, not as missing: the number resolved to
// something, so the gap is in what arrived rather than in whether there was anything to arrive.
async function read_one(number: number): Promise<ReferencedRead> {
	const read = await git_gh_command.issue_get_plan_fields_classified(String(number))

	if (read.kind !== 'read') return { number, result: read.kind }

	return { number, result: epic_issue.parse_epic_issue(read.json) ?? 'unreadable' }
}

async function fetch_referenced(numbers: ReadonlyArray<number>): Promise<Array<ReferencedRead>> {
	const reads: Array<ReferencedRead> = []

	for (let index = 0; index < numbers.length; index += LOOKUP_CONCURRENCY) {
		const slice = numbers.slice(index, index + LOOKUP_CONCURRENCY)

		reads.push(...(await Promise.all(slice.map(async (number) => await read_one(number)))))
	}

	return reads
}

// What the subject's body names, read and filtered. `undefined` when there was nothing new to read,
// which lets the caller keep the backlog it already has rather than rebuilding an identical one.
async function referenced_candidates(
	subject: BacklogIssue,
	known: ReadonlySet<number>,
	context: ReferencedContext,
): Promise<ReferencedResult | undefined> {
	const { numbers, dropped } = referenced_lookups(subject, known)
	if (numbers.length === 0 && dropped.length === 0) return undefined
	const found = collect_referenced(await fetch_referenced(numbers), context)

	return { ...found, unreadable: [...found.unreadable, ...dropped] }
}

const epic_bundle_referenced = {
	REFERENCED_LOOKUP_LIMIT,
	LOOKUP_CONCURRENCY,
	referenced_lookups,
	is_failed_read,
	to_backlog_issue,
	is_usable_candidate,
	collect_referenced,
	fetch_referenced,
	referenced_candidates,
}

export type { ReferencedContext, ReferencedLookups, ReferencedRead, ReferencedResult }
export { epic_bundle_referenced }
