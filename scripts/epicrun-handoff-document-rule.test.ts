import { read_repo_file, read_unwrapped } from '#scripts/ai-document-fixture'
import { epicrun_loop, EPICRUN_SKILL } from '#scripts/epicrun-loop-fixture'
import { describe, expect, it } from 'vitest'

// joshuafolkken/kit#968: an `epicrun` that runs every child in one context pays for the earlier
// children on every later turn. The hand-off is what stops that.
//
// It used to be asserted against two documents that had to agree — the skill a run reads and the
// Japanese canonical a person settling a disagreement reads. joshuafolkken/kit#1188 single-sourced
// the procedure into the skill and shrank the canonical to a pointer, so there is one document to
// assert against and nothing left to disagree. `POINTER` is checked for the opposite: that the body
// did not stay behind.

const SKILL = EPICRUN_SKILL
const POINTER = 'prompts/collaboration-workflow/epicrun.md'
const SINGLE_SOURCE: ReadonlyArray<string> = [SKILL]

const COMMAND = 'pnpm josh cost --over 400000'
// joshuafolkken/kit#1567: a merge is only half the seam. Under parallel lanes another child is
// still in flight, and cutting there loses the reference to it rather than pausing it.
const LANE_COMMAND = 'pnpm josh lane:list'

const QUEUE = '.claude/skills/workflow-commands/queue.md'
const DOCS = 'docs/josh-commands.md'
const CITATION = '`epicrun.md` → "The hand-off"'

// The moment is the whole safety argument: this child's work is written down only after a merge,
// and another lane still running is what makes a merge alone insufficient.
const AFTER_MERGE = 'immediately after its merge'
const NEVER_MID_CHILD = 'never mid-child'
const EVERY_MERGE = "is asked after every child's merge"
const SAFE_SEAM = '`none` is the safe seam'
const RESUME_LINE = 'Please run `epicrun #<E>` to continue this epic in a fresh session.'
// `epic:next --lanes` keeps the seats full, so an idle pool never merely happens: the reading has to
// drain to one, or the cut is unreachable on exactly the run joshuafolkken/kit#1567 measured.
const DRAIN = 'Open no new lane and take no new child from `epic:next`'

// A sibling entry point may say what happens; it may not restate when the check is asked, what makes
// a seam safe, or what the stop report says. Those are the procedure, and a second copy drifts.
const BODY_ONLY: ReadonlyArray<string> = [
	AFTER_MERGE,
	NEVER_MID_CHILD,
	EVERY_MERGE,
	SAFE_SEAM,
	DRAIN,
	RESUME_LINE,
]

// The directives, not the prose. A rewrite that keeps the section heading and drops one of these
// leaves a run that hands off at the wrong moment, or never.
const REQUIRED: ReadonlyArray<string> = [
	COMMAND,
	LANE_COMMAND,
	...BODY_ONLY,
	// joshuafolkken/kit#1567. Reading the threshold and doing nothing with it is the failure this
	// one names, and it is the half joshuafolkken/kit#1212 had removed.
	'stop and ask the person to cut the session',
	// A hand-off must not be mistaken for a park — they look alike and mean opposite things.
	'not a failure and not a park',
	'`needs-decision` is not applied',
	// The resumed session runs `josh latest` again; skipping it would merge against stale deps.
	'A resumed session is a new session',
]

// Command names are signposts a contents list is allowed to carry; directive prose is not.
const SIGNPOSTS: ReadonlySet<string> = new Set([COMMAND, LANE_COMMAND])

describe.each(SINGLE_SOURCE)('%s — the hand-off is written down', (document_path) => {
	const content = read_repo_file(document_path)
	const unwrapped = read_unwrapped(document_path)

	// A heading, not merely the words: the canonical's sections are `###` under a `##` title, and a
	// section appended at the wrong level reads as a sibling of the document title.
	it('has the section as a heading of its own', () => {
		expect(content).toMatch(/^#{2,4} .*hand-off/imu)
	})

	// The hand-off is a way the run stops, so the list of ways it stops has to know about it.
	it('lists the hand-off among the stopping conditions', () => {
		const start = content.search(/停止条件|Stopping conditions/u)

		expect(start).toBeGreaterThan(-1)
		expect(content.slice(start).replaceAll(/\s+/gu, ' ')).toContain(COMMAND)
	})

	// `over` / `under` are not the only answers; an unmeasurable session must not read as `under`.
	it('defines the branch for a check that could not answer', () => {
		expect(unwrapped).toMatch(/exits 1 with empty standard output|終了コード 1 で標準出力が空/u)
	})

	it.each(REQUIRED)('states %j', (directive) => {
		expect(unwrapped).toContain(directive.replaceAll(/\s+/gu, ' '))
	})
})

// What the next session needs must be readable back; if any of it lived only in the conversation,
// the hand-off would lose it.
// The numbered per-child loop lives in the skill — the canonical states the rules, the skill states
// the procedure — so this one is asserted there rather than against both.
describe('the skill asks the question inside the loop', () => {
	it('reaches the check by following the numbered steps', () => {
		expect(epicrun_loop.per_child_step()).toContain(COMMAND)
	})
})

describe.each(SINGLE_SOURCE)('%s — names where the carried state lives', (document_path) => {
	const unwrapped = read_unwrapped(document_path)

	it.each(['pnpm josh epic:next', 'the epic body', 'the child Issue body'])(
		'names %j as a source the next session reads back',
		(source) => {
			expect(unwrapped).toContain(source)
		},
	)

	it('says nothing is carried in the conversation', () => {
		expect(unwrapped).toContain('Nothing is carried in the conversation')
	})
})

// The measurement is what makes the growth a number rather than a feeling. A reader who doubts it
// has to be able to find it.
describe('the threshold cites the measurement it came from', () => {
	it.each(SINGLE_SOURCE)('%s cites the measured growth', (document_path) => {
		const unwrapped = read_unwrapped(document_path)

		expect(unwrapped).toContain('222k per request')
		expect(unwrapped).toContain('645k')
		expect(unwrapped).toContain('joshuafolkken/kit#968')
	})
})

// joshuafolkken/kit#984: the measurement supports breaking almost immediately, not 400,000 — the
// number is a tokens-against-human-touches trade-off. A document that keeps claiming the
// measurement produced it sends the next reader to defend a figure the data does not support.
describe('the threshold is not passed off as the measurement’s own answer', () => {
	it.each(SINGLE_SOURCE)('%s does not repeat the corrected claim', (document_path) => {
		expect(read_unwrapped(document_path)).not.toContain(
			"the threshold is the same number the epic's own measurement produced",
		)
	})

	it.each(SINGLE_SOURCE)(
		'%s says outright that the measurement did not produce it',
		(document_path) => {
			expect(read_unwrapped(document_path)).toContain('閾値 400,000 は計測が出した数字ではない')
		},
	)

	// Naming what the number *is* matters as much as denying what it is not: without it the figure
	// reads as arbitrary and the next run lowers it on a feeling.
	it.each(SINGLE_SOURCE)('%s names the trade-off the number represents', (document_path) => {
		expect(read_unwrapped(document_path)).toContain('トークン対人の手数')
	})
})

// The unit that replaced breaking-per-child. Delegation is what the measurement actually asked for;
// the hand-off survives as the backstop, and a document that lost the distinction would have a run
// paying the old bill while believing it had been fixed.
const DELEGATION_COMMAND = 'pnpm josh delegate epic-child'

describe.each(SINGLE_SOURCE)('%s — each child runs in a delegated unit', (document_path) => {
	const unwrapped = read_unwrapped(document_path)

	it('routes the decision to the command rather than to judgement', () => {
		expect(unwrapped).toContain(DELEGATION_COMMAND)
	})

	// The verifier is the reason the unit may be delegated at all. Advancing on the summary discards
	// it, so both documents have to say where the parent reads the child's state.
	it('says the parent confirms the child from GitHub, not from the summary', () => {
		expect(unwrapped).toMatch(
			/親が読むのは要約ではなく GitHub の状態|The parent reads GitHub, never the summary/u,
		)
	})

	it('reuses joshuafolkken/kit#969’s mechanism rather than building a second', () => {
		expect(unwrapped).toContain('joshuafolkken/kit#969')
		expect(unwrapped).toMatch(/機構は新設しない|The mechanism is not new/u)
	})

	// Backstop, not alternative: read the other way, a run that can delegate would still break every
	// few children and a run that cannot would think itself covered.
	it('keeps the hand-off as the backstop for where delegation is unavailable', () => {
		expect(unwrapped).toMatch(/委譲の代替ではなく|not an alternative to it/u)
	})
})

// The other half of single-sourcing: asserting the skill carries the procedure says nothing about
// whether the Japanese copy went away. A pointer that kept its body would satisfy every case above
// while leaving the hand-off a rule to be written twice — the state joshuafolkken/kit#1188 removed.
// What must be absent is the directive prose, not the command name. Every pointer written under
// joshuafolkken/kit#1176 lists what the skill holds, and naming the command in that list is a
// signpost a reader follows — `eval-gate.md` names `pnpm josh eval:scope` the same way. Excluding it
// is what keeps this suite checking for a body left behind rather than for a contents list.
const POINTER_MUST_NOT_RESTATE = REQUIRED.filter((marker) => !SIGNPOSTS.has(marker))

describe(`${POINTER} — keeps none of the hand-off body`, () => {
	const unwrapped = read_unwrapped(POINTER)

	it.each(POINTER_MUST_NOT_RESTATE)('does not restate %j', (marker) => {
		expect(unwrapped).not.toContain(marker)
	})
})

// joshuafolkken/kit#1212's two qualifications, withdrawn by joshuafolkken/kit#1567. Left standing,
// each one reads as correct — both cite a real measurement — and each one alone is enough for a run
// to never ask the question or never act on the answer. So they are asserted absent by name.
const WITHDRAWN: ReadonlyArray<string> = [
	"The parent's context grew by that child's summary and nothing else",
	'Do not ask the person to retype the command',
	'A session that compacts is safe for this workflow',
]

describe.each(SINGLE_SOURCE)('%s — the withdrawn qualifications are gone', (document_path) => {
	const unwrapped = read_unwrapped(document_path)

	it.each(WITHDRAWN)('no longer states %j', (claim) => {
		expect(unwrapped).not.toContain(claim)
	})

	// The removal has to be arguable from the document itself, or the next reader restores it.
	it('carries the measurement that withdrew them', () => {
		expect(unwrapped).toContain('joshuafolkken/kit#1567')
		expect(unwrapped).toContain('732 requests')
		expect(unwrapped).toContain('$0.241 per request')
	})
})

// A queue accumulates in one session exactly as an epic does, so the boundary binds there too — and
// the single-source pattern is what keeps it from becoming a second procedure that drifts.
describe(`${QUEUE} — cites the hand-off instead of copying it`, () => {
	const unwrapped = read_unwrapped(QUEUE)

	it('asks the same check', () => {
		expect(unwrapped).toContain(COMMAND)
	})

	// A queue runs one issue at a time, so its seam is idle already — and `lane:list` reads the
	// repository's work trees rather than this run's units, so one lane an earlier `epicrun` left
	// behind would disable a queue's cut permanently, and silently.
	it('does not gate its cut on the lane listing', () => {
		expect(unwrapped).toContain('There is no drain here, and no lane reading either')
	})

	it('cites the single source', () => {
		expect(unwrapped).toContain(CITATION)
	})

	it.each(BODY_ONLY)('does not copy %j', (marker) => {
		expect(unwrapped).not.toContain(marker)
	})
})

describe(`${DOCS} — the narrowing is not still documented`, () => {
	const unwrapped = read_unwrapped(DOCS)

	// The command reference is what a reader checks when the skill and their memory disagree, so a
	// withdrawn condition left here outlives its removal from the procedure.
	it('no longer says the check is asked only after a child run in the parent context', () => {
		expect(unwrapped).not.toContain(
			"it asks only after a child that ran in the parent's own context",
		)
	})

	it('names what removed it', () => {
		expect(unwrapped).toContain('removed that narrowing')
		expect(unwrapped).toContain('issues/1567')
	})

	it('routes the threshold to its single source', () => {
		expect(unwrapped).toContain('→ "The hand-off"')
	})
})
