import { agent_role_profile } from '#scripts/agent/agent-role-profile'
import { review_attest } from '#scripts/review/review-attest'
import { describe, expect, it } from 'vitest'
import { run_ship_review } from './run-ship-review'

// joshuafolkken/kit#2427: the supervised reviewer's prompt, and the verdict the supervisor routes on.

const { VERDICT } = run_ship_review
const BRIEF = 'stamps/josh-ship-review-brief-x.md'
const CODE_SLOT = review_attest.REVIEW_SLOT.CODE
const SUBMIT = '`pnpm josh review:submit`'
const LOW_ONLY = 'tests:low:a.ts'
const MEDIUM_OPEN = 'bug-risks:medium:a.ts:3'
const MEDIUM_FIXED = `fixed ${MEDIUM_OPEN}`
const MEDIUM_KIND = 'bug-risks:medium'
const MEDIUM_LOCATION = 'a.ts:3'
const ISSUE = '3875'
const SPECS = ['bug-risks:medium:b.ts']

describe('run_ship_review.reviewer_prompt', () => {
	it('is one launch-safe line naming the brief and the submit command', () => {
		const prompt = run_ship_review.reviewer_prompt(BRIEF, CODE_SLOT, ISSUE)

		expect(prompt).not.toMatch(/\n/u)
		expect(agent_role_profile.is_safe_value(prompt)).toBe(true)
		expect(prompt).toContain(BRIEF)
		expect(prompt).toContain(SUBMIT)
		expect(prompt).toContain('review:attest')
	})
})

describe('run_ship_review.read_verdict', () => {
	it('reads an empty file as a clean round with no findings', () => {
		expect(run_ship_review.read_verdict('\n')).toStrictEqual({
			kind: VERDICT.CLEAN,
			specs: [],
			report: [],
		})
	})

	it('reads Low-only findings as clean, keeping them to record', () => {
		const text = 'tests:low:scripts/a.ts:3\ncomments:low:scripts/b.ts\n'
		const specs = ['tests:low:scripts/a.ts:3', 'comments:low:scripts/b.ts']

		expect(run_ship_review.read_verdict(text)).toStrictEqual({
			kind: VERDICT.CLEAN,
			specs,
			report: specs,
		})
	})

	it.each(['medium', 'high'])('blocks on a %s finding', (severity) => {
		const text = `comments:low:a.ts\nbug-risks:${severity}:b.ts:9`

		expect(run_ship_review.read_verdict(text).kind).toBe(VERDICT.BLOCKING)
	})

	it('refuses a line outside the review:record grammar', () => {
		const verdict = run_ship_review.read_verdict('bug-risks:critical:a.ts')

		expect(verdict).toStrictEqual({
			kind: VERDICT.INVALID,
			note: 'unreadable finding: bug-risks:critical:a.ts',
		})
	})

	it('reads a missing findings file as an unfinished review, never as clean', () => {
		expect(run_ship_review.read_verdict(undefined).kind).toBe(VERDICT.INVALID)
	})
})

// joshuafolkken/kit#2489: the round-1 reviewer fixes its local Mediums in place and marks them, and the
// supervisor ships on through a round-2 pass rather than handing the lane child back.
describe('run_ship_review.read_verdict — findings fixed in place', () => {
	const FIXED_MEDIUM = `${run_ship_review.FIXED_PREFIX}bug-risks:medium:b.ts:9`
	const LOW_COMMENT = 'comments:low:a.ts'

	it('reads a fixed Medium as fixed, keeping the mark as its disposition', () => {
		expect(run_ship_review.read_verdict(`${LOW_COMMENT}\n${FIXED_MEDIUM}`)).toStrictEqual({
			kind: VERDICT.FIXED,
			specs: [LOW_COMMENT, FIXED_MEDIUM],
			report: [LOW_COMMENT, FIXED_MEDIUM],
		})
	})

	it('still blocks on a Medium left unfixed beside a fixed one', () => {
		const text = `${FIXED_MEDIUM}\ntests:medium:c.ts`

		expect(run_ship_review.read_verdict(text).kind).toBe(VERDICT.BLOCKING)
	})

	it('blocks on a High even when it is marked fixed — a High is never fixed in place', () => {
		const text = `${run_ship_review.FIXED_PREFIX}bug-risks:high:b.ts`

		expect(run_ship_review.read_verdict(text).kind).toBe(VERDICT.BLOCKING)
	})

	it('refuses a fixed mark over a line outside the grammar', () => {
		const text = `${run_ship_review.FIXED_PREFIX}bug-risks:critical:a.ts`

		expect(run_ship_review.read_verdict(text).kind).toBe(VERDICT.INVALID)
	})
})

describe('run_ship_review — the two rounds route differently', () => {
	it.each([
		[VERDICT.CLEAN, true],
		[VERDICT.FIXED, true],
		[VERDICT.BLOCKING, false],
	] as const)('round 1 reads %s as passing: %s', (kind, is_passing) => {
		const verdict = { kind, specs: SPECS, report: SPECS }

		expect(run_ship_review.round_one_outcome(verdict).is_passing).toBe(is_passing)
	})

	it.each([
		[VERDICT.CLEAN, true],
		[VERDICT.FIXED, false],
		[VERDICT.BLOCKING, false],
	] as const)('round 2 reads %s as passing: %s', (kind, is_passing) => {
		const verdict = { kind, specs: SPECS, report: SPECS }

		expect(run_ship_review.round_two_outcome(verdict).is_passing).toBe(is_passing)
	})
})

// joshuafolkken/kit#4673: a fix of only the cited line left the same pattern for round 2 to stop on.
describe('run_ship_review — every stop that hands findings back asks for the sweep', () => {
	const BLOCKING = { kind: VERDICT.BLOCKING, specs: SPECS, report: SPECS }

	it.each([
		['round 1 blocking', run_ship_review.round_one_outcome(BLOCKING).note],
		['round 1 fixes unverified', run_ship_review.UNVERIFIED_OUTCOME.note],
		['round 2 blocking', run_ship_review.round_two_outcome(BLOCKING).note],
	])('%s', (_name, note) => {
		expect(note).toContain(run_ship_review.SWEEP_INSTRUCTION)
	})

	it('names the three ranges to search and the record to leave', () => {
		const sweep = run_ship_review.SWEEP_INSTRUCTION

		expect(sweep).toContain('the same file')
		expect(sweep).toContain('callers of the same function')
		expect(sweep).toContain('grep of the pattern')
		expect(sweep).toContain('Issue fix comment')
	})

	it.each([
		['reviewer', run_ship_review.reviewer_prompt],
		['report', run_ship_review.report_prompt],
		['verification', run_ship_review.verification_prompt],
	])('the %s prompt asks a high or medium line for its other sites', (_name, prompt_of) => {
		expect(prompt_of(BRIEF, CODE_SLOT, ISSUE)).toContain(run_ship_review.OTHER_SITES_CLAUSE)
	})

	it('leaves a passing round without the sweep', () => {
		const clean = { kind: VERDICT.CLEAN, specs: [], report: [] }

		expect(run_ship_review.round_one_outcome(clean).note).not.toContain(
			run_ship_review.SWEEP_INSTRUCTION,
		)
	})
})

// joshuafolkken/kit#3159: a stopped ship's log carried only `<category>:<severity>:<file>`, so the
// resumed lane child re-derived every finding from the code. The description now rides along.
describe('run_ship_review.read_verdict — a finding carries its description', () => {
	const DESCRIBED = `${MEDIUM_OPEN} — the guard misses a glob search, so the count never trips`

	it('records the spec alone and reports the whole line', () => {
		expect(run_ship_review.read_verdict(`${DESCRIBED}\n`)).toStrictEqual({
			kind: VERDICT.BLOCKING,
			specs: [MEDIUM_OPEN],
			report: [DESCRIBED],
		})
	})

	it('reads a fixed mark and a description together', () => {
		const text = `${run_ship_review.FIXED_PREFIX}${DESCRIBED}`

		expect(run_ship_review.read_verdict(text)).toStrictEqual({
			kind: VERDICT.FIXED,
			specs: [`${run_ship_review.FIXED_PREFIX}${MEDIUM_OPEN}`],
			report: [text],
		})
	})

	it.each([' - ', ' -- ', ' – '])('ends the spec at a %j dash as well', (separator) => {
		const verdict = run_ship_review.read_verdict(`${MEDIUM_OPEN}${separator}the count never trips`)

		expect(verdict).toMatchObject({ specs: [MEDIUM_OPEN] })
	})

	it.each([
		run_ship_review.reviewer_prompt(BRIEF, CODE_SLOT, ISSUE),
		run_ship_review.verification_prompt(BRIEF, CODE_SLOT, ISSUE),
	])('asks each reviewer for the description after the spec', (prompt) => {
		expect(prompt).toContain('<category>:<severity>:<file>[:<line>] — <one sentence')
	})

	// joshuafolkken/kit#3875: a body-only read of the Issue is refused by the issue-comments rule.
	it.each([
		run_ship_review.reviewer_prompt(BRIEF, CODE_SLOT, ISSUE),
		run_ship_review.verification_prompt(BRIEF, CODE_SLOT, ISSUE),
	])('tells each reviewer to read the Issue with its comments', (prompt) => {
		expect(prompt).toContain(`pnpm josh issue:read ${ISSUE}`)
		expect(agent_role_profile.is_safe_value(prompt)).toBe(true)
	})
})

describe('run_ship_review.is_clean_round_one — a resume narrows only past a clean review', () => {
	it.each([
		['', true],
		[LOW_ONLY, true],
		[MEDIUM_FIXED, false],
		['bug-risks:high:a.ts:42', false],
		[MEDIUM_OPEN, false],
		['not a finding', false],
	])('reads %j as clean: %s', (text, is_clean) => {
		expect(run_ship_review.is_clean_round_one(text)).toBe(is_clean)
	})

	it('reads an absent findings file as not clean', () => {
		expect(run_ship_review.is_clean_round_one(undefined)).toBe(false)
	})
})

// joshuafolkken/kit#2961: any finding marked fixed means the reviewer edited the tree, blocking or not.
describe('run_ship_review.has_fixes — whether the reviewer edited the tree', () => {
	it.each([
		['', false],
		[LOW_ONLY, false],
		[MEDIUM_OPEN, false],
		[MEDIUM_FIXED, true],
		[`${MEDIUM_FIXED}\ntests:medium:b.ts`, true],
	])('reads %j as edited: %s', (text, is_edited) => {
		expect(run_ship_review.has_fixes(text)).toBe(is_edited)
	})

	it('reads an absent findings file as not edited', () => {
		expect(run_ship_review.has_fixes(undefined)).toBe(false)
	})
})

// joshuafolkken/kit#4426: the kinds a stopped review's output lists, for the lane ledger — only the
// findings that block, once per kind, never the stage's own prose around them.
describe('run_ship_review.blocking_kinds — the kinds that stopped a review', () => {
	const medium_kind = MEDIUM_KIND
	const tests_kind = 'tests:medium'

	it.each([
		['', []],
		[LOW_ONLY, []],
		[`${MEDIUM_FIXED}\n${tests_kind}:c.ts`, [tests_kind]],
		// A stop no blocking finding decided — fixes red on the scoped pair, a round 2 that edited the
		// tree — was decided by the fixed findings.
		[MEDIUM_FIXED, [medium_kind]],
		[`${MEDIUM_FIXED}\n${LOW_ONLY}\nreview fixes did not pass the scoped checks`, [medium_kind]],
		[`${MEDIUM_FIXED}\nfixed ${tests_kind}:c.ts\n${MEDIUM_FIXED}`, [medium_kind, tests_kind]],
		[`${MEDIUM_OPEN}\n${medium_kind}:b.ts`, [medium_kind]],
		[`${MEDIUM_OPEN} — the guard reads a stale stamp`, [medium_kind]],
		[`fixed assumptions:high:b.ts — never fixed in place`, ['assumptions:high']],
		[
			`${MEDIUM_OPEN}\n${LOW_ONLY}\n${tests_kind}:c.ts\nreview found High/Medium: x`,
			[medium_kind, tests_kind],
		],
		['✗ verification gate failed: test:unit', []],
	])('reads %j as %j', (text, kinds) => {
		expect(run_ship_review.blocking_kinds(text)).toStrictEqual(kinds)
	})
})

// joshuafolkken/kit#4519: each finding that stopped a review, whole, for the durable stop log.
describe('run_ship_review.blocking_details — each finding that stopped a review', () => {
	it('keeps the kind, the file:line and the first sentence of every deciding finding', () => {
		const text = [
			`${MEDIUM_OPEN} — the guard reads a stale stamp. It never re-reads it.`,
			`${MEDIUM_OPEN} – a second finding on the same line`,
			`${LOW_ONLY} — a Low decides nothing`,
			'review found High/Medium: x',
		].join('\n')

		expect(run_ship_review.blocking_details(text)).toStrictEqual([
			{ kind: MEDIUM_KIND, location: MEDIUM_LOCATION, sentence: 'the guard reads a stale stamp.' },
			{
				kind: MEDIUM_KIND,
				location: MEDIUM_LOCATION,
				sentence: 'a second finding on the same line',
			},
		])
	})

	it('falls back to the fixed findings and leaves a finding without a description empty', () => {
		expect(run_ship_review.blocking_details(MEDIUM_FIXED)).toStrictEqual([
			{ kind: MEDIUM_KIND, location: MEDIUM_LOCATION, sentence: '' },
		])
	})

	it('ends a Japanese sentence at its full stop, which takes no space after it', () => {
		const [detail] = run_ship_review.blocking_details(`${MEDIUM_OPEN} — 古い値を読む。再読しない。`)

		expect(detail?.sentence).toBe('古い値を読む。')
	})

	it('caps a run-on sentence with an ellipsis', () => {
		const [detail] = run_ship_review.blocking_details(`${MEDIUM_OPEN} — ${'x'.repeat(500)}`)

		expect(detail?.sentence).toHaveLength(200)
		expect(detail?.sentence.endsWith('…')).toBe(true)
	})
})

describe('run_ship_review — the two prompts', () => {
	it('lets round 1 fix a local Medium and asks it to mark what it fixed', () => {
		const prompt = run_ship_review.reviewer_prompt(BRIEF, CODE_SLOT, ISSUE)

		expect(prompt).toContain('Apply a fix only for a Medium finding')
		expect(prompt).toContain(`"${run_ship_review.FIXED_PREFIX}"`)
		expect(prompt).toContain('never fix a High')
	})

	// joshuafolkken/kit#2500: a fix comes back already green on the scoped pair, or not at all.
	it('asks round 1 to leave its fixes green on the scoped pair, or revert them', () => {
		const prompt = run_ship_review.reviewer_prompt(BRIEF, CODE_SLOT, ISSUE)

		expect(prompt).toContain('pnpm josh lint:related && pnpm josh test:related')
		expect(prompt).toContain('revert a fix you cannot get green')
	})

	it('keeps round 2 a launch-safe, read-only verification pass', () => {
		const prompt = run_ship_review.verification_prompt(BRIEF, CODE_SLOT, ISSUE)

		expect(prompt).not.toMatch(/\n/u)
		expect(agent_role_profile.is_safe_value(prompt)).toBe(true)
		expect(prompt).toContain('round-2 verification pass')
		expect(prompt).toContain('Do not edit any file.')
		expect(prompt).not.toContain(run_ship_review.FIXED_PREFIX.trim())
	})
})

// joshuafolkken/kit#4672: two reviewers fixing, verifying and reverting in one checkout at once race.
describe('run_ship_review.slot_prompt — one reviewer edits the checkout', () => {
	const { CODE, INTERACTION } = review_attest.REVIEW_SLOT
	const BOTH = [CODE, INTERACTION]

	it('keeps the round prompt for the code slot beside the interaction slot', () => {
		const { reviewer_prompt, slot_prompt } = run_ship_review

		expect(slot_prompt(reviewer_prompt, CODE, BOTH)).toBe(reviewer_prompt)
	})

	it('makes the interaction slot beside the code slot read only', () => {
		const prompt_of = run_ship_review.slot_prompt(
			run_ship_review.reviewer_prompt,
			INTERACTION,
			BOTH,
		)
		const prompt = prompt_of(BRIEF, CODE_SLOT, ISSUE)

		expect(prompt).not.toMatch(/\n/u)
		expect(agent_role_profile.is_safe_value(prompt)).toBe(true)
		expect(prompt).toContain('Do not edit any file')
		expect(prompt).not.toContain('Apply a fix')
		expect(prompt).not.toContain(run_ship_review.FIXED_PREFIX.trim())
	})

	it('lets the interaction slot reviewed alone fix in place', () => {
		const { reviewer_prompt, slot_prompt } = run_ship_review

		expect(slot_prompt(reviewer_prompt, INTERACTION, [INTERACTION])).toBe(reviewer_prompt)
	})
})
