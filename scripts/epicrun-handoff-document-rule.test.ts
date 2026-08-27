import { read_repo_file, read_unwrapped } from '#scripts/ai-document-fixture'
import { describe, expect, it } from 'vitest'

// joshuafolkken/kit#968: an `epicrun` that runs every child in one context pays for the earlier
// children on every later turn. The hand-off is what stops that, and it only works if the skill and
// the canonical agree — a run reads the skill, and a person settling a disagreement reads the
// canonical.

const SKILL = '.claude/skills/workflow-commands/epicrun.md'
const CANONICAL = 'prompts/collaboration-workflow/epicrun.md'
const BOTH: ReadonlyArray<string> = [SKILL, CANONICAL]

const COMMAND = 'pnpm josh cost --over 400000'

// The directives, not the prose. A rewrite that keeps the section heading and drops one of these
// leaves a run that hands off at the wrong moment, or never.
const REQUIRED: ReadonlyArray<string> = [
	COMMAND,
	// The moment is the whole safety argument: nothing is in flight only just after a merge.
	'immediately after its merge',
	'never mid-child',
	'Please run `epicrun #<E>` to continue this epic in a fresh session.',
	// A hand-off must not be mistaken for a park — they look alike and mean opposite things.
	'not a failure and not a park',
	'`needs-decision` is not applied',
	// The resumed session runs `josh latest` again; skipping it would merge against stale deps.
	'A resumed session is a new session',
]

describe.each(BOTH)('%s — the hand-off is written down', (document_path) => {
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
		const content = read_repo_file(SKILL)
		const loop = content.slice(content.indexOf('1. Run the command above.'))
		const per_child = loop.slice(0, loop.indexOf('3. '))

		expect(per_child.replaceAll(/\s+/gu, ' ')).toContain(COMMAND)
	})
})

describe.each(BOTH)('%s — names where the carried state lives', (document_path) => {
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
	it.each(BOTH)('%s cites the measured growth', (document_path) => {
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
	it.each(BOTH)('%s does not repeat the corrected claim', (document_path) => {
		expect(read_unwrapped(document_path)).not.toContain(
			"the threshold is the same number the epic's own measurement produced",
		)
	})

	it.each(BOTH)('%s says outright that the measurement did not produce it', (document_path) => {
		expect(read_unwrapped(document_path)).toContain('閾値 400,000 は計測が出した数字ではない')
	})

	// Naming what the number *is* matters as much as denying what it is not: without it the figure
	// reads as arbitrary and the next run lowers it on a feeling.
	it.each(BOTH)('%s names the trade-off the number represents', (document_path) => {
		expect(read_unwrapped(document_path)).toContain('トークン対人の手数')
	})
})

// The unit that replaced breaking-per-child. Delegation is what the measurement actually asked for;
// the hand-off survives as the backstop, and a document that lost the distinction would have a run
// paying the old bill while believing it had been fixed.
const DELEGATION_COMMAND = 'pnpm josh delegate epic-child'

describe.each(BOTH)('%s — each child runs in a delegated unit', (document_path) => {
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
