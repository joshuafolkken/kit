import { git_gh_command } from '#scripts/git/git-gh-command'
import { describe, expect, it, vi } from 'vitest'
import { epic_bundle, type BacklogIssue, type BundleDecision } from './epic-bundle'
import { epic_bundle_cli } from './epic-bundle-cli'

// What the command prints for a decision, as distinct from what it decides.
//
// The two are separately wrong-able: `decide_bundle` can name the epic correctly while the headline
// above it still says `Nothing to bundle.`, which reads as "no action" over a line that is entirely
// actionable — add the prerequisite to *that* epic rather than creating a second one
// (joshuafolkken/kit#943). Nothing asserted the headline before, so reverting it left the suite
// green.

const REPO = 'joshuafolkken/kit'
const BODY_WITH_REFERENCE = 'refers to #891'
const EPIC_LISTING = 'epic listing'
const BACKLOG_LISTING = 'backlog listing'
// The shape `warn_about_gaps` reads: a successful listing with nothing missing. Spread into each
// case, so a test names only the gap it is about.
type GapInput = Parameters<typeof epic_bundle_cli.warn_about_gaps>[0]

function read_backlog(): GapInput {
	return { issues: [], unreadable: [], is_readable: true }
}

function issue(number: number, overrides: Partial<BacklogIssue> = {}): BacklogIssue {
	return { number, repo: REPO, body: '', blocked_by: [], ...overrides }
}

function render(decision: BundleDecision, subject: BacklogIssue): string {
	return epic_bundle_cli.format_decision(decision, subject, [])
}

// Looked up through a variable key, as the command itself does: a literal key would be rewritten to
// dot notation by `dot-notation` and then rejected by `noPropertyAccessFromIndexSignature`.
function action_line(action: BundleDecision['action']): string {
	return epic_bundle_cli.ACTION_LINES[action] ?? ''
}

describe('epic_bundle_cli.format_decision — the headline', () => {
	it('tells the caller to use the epic that already tracks the issue', () => {
		const subject = issue(943, { epic: 893 })
		const rendered = render(epic_bundle.decide_bundle(subject, []), subject)

		expect(rendered).toContain(epic_bundle_cli.ALREADY_TRACKED_LINE)
		expect(rendered).toContain('#893 already tracks this issue')
	})

	// The number is the whole point of the line: `josh epic --add <E> ...` needs it.
	it('names the epic in the reason, not only that one exists', () => {
		const subject = issue(943, { epic: 893 })

		expect(render(epic_bundle.decide_bundle(subject, []), subject)).not.toContain(
			'already belongs to an epic',
		)
	})

	it('still says nothing to bundle when no epic is involved', () => {
		const subject = issue(1, { body: 'unrelated prose' })
		const rendered = render(epic_bundle.decide_bundle(subject, [issue(2)]), subject)

		expect(rendered).toContain(action_line('none'))
		expect(rendered).not.toContain(epic_bundle_cli.ALREADY_TRACKED_LINE)
	})

	it('leaves the other actions on their own headlines', () => {
		const decision: BundleDecision = {
			action: 'create_epic',
			epics: [],
			candidates: [2],
			reason: 'r',
		}

		expect(render(decision, issue(1))).toContain(action_line('create_epic'))
	})
})

// joshuafolkken/kit#947: the referenced-issue read is the second half of the fix, and its failure
// mode is the one the whole Issue is about — a read that did not happen must not arrive as "no
// relation found". `warn_about_gaps` is what keeps it visible, so the wiring is asserted here rather
// than left to the pure layer, which never sees the console.
function captured(backlog: Parameters<typeof epic_bundle_cli.warn_about_gaps>[0]): string {
	const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined)

	try {
		epic_bundle_cli.warn_about_gaps(backlog)

		return spy.mock.calls.map((call) => String(call[0])).join('\n')
	} finally {
		spy.mockRestore()
	}
}

describe('epic_bundle_cli.warn_about_gaps — a read that did not happen', () => {
	it('names the issues it could not read', () => {
		const warned = captured({ ...read_backlog(), unreadable: [891] })

		expect(warned).toContain('#891')
	})

	// The wording covered relation reads only, which was accurate while that was the sole extra read.
	// A referenced issue is now read whole, and a warning naming "relations" would send the reader
	// looking for a dependency that was never the thing that failed.
	it('does not claim it was only the relations that failed', () => {
		expect(captured({ ...read_backlog(), unreadable: [891] })).not.toContain('relations for')
	})

	it('says nothing when every read succeeded', () => {
		expect(captured(read_backlog())).toBe('')
	})
})

// The widening is skipped, not crashed, when the epic view is absent — the branch a failed epic
// listing takes, where the command already exits non-zero with its own message.
describe('epic_bundle_cli.widen_with_referenced', () => {
	it('returns the backlog untouched without an epic view', async () => {
		const backlog = { issues: [], unreadable: [], is_readable: true }
		const subject = issue(943, { body: BODY_WITH_REFERENCE })

		expect(await epic_bundle_cli.widen_with_referenced(subject, backlog)).toBe(backlog)
	})

	// No references means no requests: the common case must not pay a round trip to learn that.
	it('makes no request when the body names nothing new', async () => {
		const backlog = {
			issues: [issue(943)],
			unreadable: [],
			is_readable: true,
			context: { repo: REPO, epics: new Map(), epic_numbers: new Set<number>() },
		}
		const subject = issue(943, { body: 'no references here' })

		expect(await epic_bundle_cli.widen_with_referenced(subject, backlog)).toBe(backlog)
	})
})

// An issue an epic already tracks short-circuits in `decide_bundle`, so widening for it is a request
// per reference spent on a verdict that ignores them — and a failed one prints a gap warning above
// an answer the read was never part of (joshuafolkken/kit#947, second review).
describe('epic_bundle_cli.widen_with_referenced — an issue that already has an epic', () => {
	it('does not read the references of an issue an epic already tracks', async () => {
		const backlog = {
			issues: [],
			unreadable: [],
			is_readable: true,
			context: { repo: REPO, epics: new Map(), epic_numbers: new Set<number>() },
		}
		const subject = issue(943, { body: BODY_WITH_REFERENCE, epic: 893 })

		expect(await epic_bundle_cli.widen_with_referenced(subject, backlog)).toBe(backlog)
	})
})

// joshuafolkken/kit#950: the epic listing is capped like the backlog's, and said nothing when it hit
// the cap. An epic past it is invisible, so the issue it tracks reads as tracked by nothing — and
// the caller, following the procedure, creates a second epic over it. "The listing was truncated"
// and "no epic tracks this" arrived as the same `Nothing to bundle.` with exit 0.
describe('epic_bundle_cli.warn_about_gaps — a listing that was cut short', () => {
	const CAP = String(epic_bundle_cli.BACKLOG_LIMIT)

	it('says so when the epic listing hit its cap', () => {
		const warned = captured({ ...read_backlog(), is_epic_list_truncated: true })

		expect(warned).toContain(EPIC_LISTING)
		expect(warned).toContain(CAP)
	})

	// The two caps hide different things — one an epic, the other a backlog issue — so a caller told
	// only "something was truncated" cannot tell whether the epic tracking a candidate was missed.
	it('distinguishes the epic cap from the backlog cap', () => {
		const epics = captured({ ...read_backlog(), is_epic_list_truncated: true })
		const issues = captured({ ...read_backlog(), is_truncated: true })

		expect(epics).not.toBe(issues)
		expect(epics).not.toContain(BACKLOG_LISTING)
		expect(issues).not.toContain(EPIC_LISTING)
	})
})

describe('epic_bundle_cli.warn_about_gaps — the quiet path and both caps at once', () => {
	// The normal path must be unchanged: a warning on every run is a warning nobody reads. The flags
	// are set explicitly false rather than left off — omitted, this repeats the case above it.
	it('says nothing when both listings reported themselves complete', () => {
		expect(
			captured({ ...read_backlog(), is_truncated: false, is_epic_list_truncated: false }),
		).toBe('')
	})

	it('reports both caps when both were reached', () => {
		const warned = captured({ ...read_backlog(), is_truncated: true, is_epic_list_truncated: true })

		expect(warned).toContain(EPIC_LISTING)
		expect(warned).toContain(BACKLOG_LISTING)
	})
})

// The epic listing is what places a candidate in an epic, so a response it could not parse must not
// arrive as "no epics are open" — that is the confident duplicate joshuafolkken/kit#950 is about.
async function fetch_epics_with(raw: string | undefined): Promise<unknown> {
	const spy = vi.spyOn(git_gh_command, 'issue_list_by_label').mockResolvedValue(raw)

	try {
		return await epic_bundle_cli.fetch_epics()
	} finally {
		spy.mockRestore()
	}
}

describe('epic_bundle_cli.fetch_epics — an answer it could not parse', () => {
	it('reports an unparseable listing rather than an empty one', async () => {
		expect(await fetch_epics_with('not json at all')).toBeUndefined()
	})

	it('still reads an empty listing as no epics', async () => {
		expect(await fetch_epics_with('[]')).toEqual({ epics: [], is_truncated: false })
	})

	it('reports a failed listing', async () => {
		expect(await fetch_epics_with(undefined)).toBeUndefined()
	})
})
