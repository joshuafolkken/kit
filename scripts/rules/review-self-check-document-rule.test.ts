import { read_repo_file, read_unwrapped } from '#scripts/document/ai-document-fixture'
import { document_section } from '#scripts/document/document-section'
import { describe, expect, it } from 'vitest'

// joshuafolkken/kit#3786: about two in three round-1 High/Medium findings were of a kind the
// implementer could clear before the review, and each one makes round 2 due. The self-check that
// clears them is only worth anything while both chain-rule entries — the lane child's step 0 and the
// main-line step 1 — send a run through it **before** the scoped pair that precedes round 1; a pointer
// placed after the review starts, or dropped from one entry, silently returns the run to the old rate.

const REVIEW_PROMPT = 'prompts/review.md'
const CHAIN_RULE = '.claude/skills/workflow-commands/chain-rule.md'
const HEADING = "Before round 1 — the implementer's self-check"
const POINTER = `\`prompts/review.md\` → "${HEADING}"`

// One stem per top pre-clearable category the Issue's classification recorded, so a rewrite that
// drops a category from the list fails here rather than at the next sample.
const CATEGORY_STEMS: ReadonlyArray<string> = [
	'Tests pin the change',
	'Prose matches the code',
	'Failure is not a negative answer',
	'Every caller moved with it',
	'The Issue is met on HEAD',
	// joshuafolkken/kit#4426: the three themes of lane-stopping findings the first five did not reach.
	'State is read fresh',
	'The rule covers its whole input space',
	'Edge inputs and environments',
	// joshuafolkken/kit#4479: wrong premises about another component, the top theme still stopping lanes.
	'Claims about other components are checked in their code',
]

// The intro's count, indexed by the number of items, so adding an item without rewording
// "Answer these <n>" fails here.
const COUNT_WORDS: ReadonlyArray<string> = [
	'zero',
	'one',
	'two',
	'three',
	'four',
	'five',
	'six',
	'seven',
	'eight',
	'nine',
	'ten',
]

// The two chain-rule entries — each its numbered item's opening, and the words its scoped pair is
// run by, which the pointer has to precede.
const STEP_MARKERS: ReadonlyArray<[string, string]> = [
	['0. **A lane child**', '`pnpm josh check:related`'],
	['1. Run `pnpm josh main:merge`', 'run the final scoped lint/test pair'],
]

// Unwrapped, since a stem or a pointer wraps at whatever column the prose wraps at.
function unwrapped(text: string): string {
	return text.replaceAll(/\s+/gu, ' ')
}

function raw_self_check_section(): string {
	return document_section.section(read_repo_file(REVIEW_PROMPT), HEADING)?.text ?? ''
}

function self_check_section(): string {
	return unwrapped(raw_self_check_section())
}

function item_count(): number {
	return raw_self_check_section().match(/^\d+\. \*\*/gmu)?.length ?? 0
}

function count_word(count: number): string {
	return COUNT_WORDS[count] ?? String(count)
}

function chain_step(start: string): string {
	const content = read_unwrapped(CHAIN_RULE)
	const from = content.indexOf(start)

	return from === -1 ? '' : content.slice(from)
}

describe('the implementer self-check before review round 1', () => {
	it('prompts/review.md carries the section', () => {
		expect(self_check_section()).not.toBe('')
	})

	it.each(CATEGORY_STEMS)('the section asks "%s"', (stem) => {
		expect(self_check_section()).toContain(stem)
	})

	it('the intro states the number of items the section lists', () => {
		const count = item_count()

		expect(count).toBe(CATEGORY_STEMS.length)
		expect(self_check_section()).toContain(`Answer these ${count_word(count)} over`)
	})

	it('the section leaves the review, its severity tests and the round cap unchanged', () => {
		expect(self_check_section()).toContain('the round cap are unchanged')
	})

	it.each(STEP_MARKERS)(
		'chain-rule step "%s" points at it before its scoped pair',
		(start, scoped_pair) => {
			const step = chain_step(start)
			const pointer_at = step.indexOf(POINTER)

			expect(pointer_at).toBeGreaterThan(-1)
			expect(pointer_at).toBeLessThan(step.indexOf(scoped_pair))
		},
	)
})

// joshuafolkken/kit#4647: question 1 reads the command's output rather than asking for a hand check.
// joshuafolkken/kit#4770: the check runs beside the gate, so its lines arrive at `--join`.
describe('the self-check question 1 and josh test:pinned', () => {
	it('question 1 reads the test:pinned lines run:review --join prints', () => {
		expect(self_check_section()).toContain(
			'read the `unpinned` and `unchecked` lines `pnpm josh run:review --join` prints from `pnpm josh test:pinned`',
		)
	})

	it('the chain rule says run:review runs test:pinned beside the gate and how it carries on past it', () => {
		const step = read_unwrapped(CHAIN_RULE)

		expect(step).toContain("its `--join`'s `test:pinned` lines answer the self-check")
		expect(step).toContain(
			'it starts `pnpm josh test:pinned` and `pnpm josh gate` in the background',
		)
		expect(step).toContain('on a red gate, `3` on an `unpinned` line')
		// joshuafolkken/kit#4920: the stop note names the call that passes the reason without a re-run.
		expect(step).toContain('`3` on an `unpinned` line (its note names the `--unpinned-ok` call)')
	})
})
