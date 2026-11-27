import { readFileSync } from 'node:fs'
import { epic_chain_kind } from '#scripts/epic/epic-chain-kind'
import { package_path } from '#scripts/init/init-paths'
import { describe, expect, it } from 'vitest'

const SKILL_DIRECTORY = '.claude/skills/board-theme'

function read_skill_file(name: string): string {
	return readFileSync(package_path(`${SKILL_DIRECTORY}/${name}`), 'utf8')
}

describe('board-theme skill', () => {
	const skill = read_skill_file('SKILL.md')

	it('is read unasked before any board look change is proposed or filed', () => {
		expect(skill).toMatch(
			/^description: .*`run:board` look change.*unasked before proposing or filing/mu,
		)
	})

	it('bases a printf on a real colored frame, never a colorless one', () => {
		expect(skill).toContain('FORCE_COLOR=3 pnpm josh run:board --once --theme <theme>')
		expect(skill).not.toContain('NO_COLOR')
	})

	it.each([
		"It moves → the live board's demo mode",
		'It does not move → a `printf` command',
		'Skip it for a fix that only restores the existing look',
		'Measure the original',
		'items changed on purpose',
		'The Issue body names the work tree or commit that holds the look',
		'which element takes which color',
		"leaves the existing themes'\n  look unchanged",
		"Compare the implementation's commit with the work tree or commit the Issue named",
	])('carries the step "%s"', (step) => {
		expect(skill).toContain(step)
	})

	it.each(['#8357', '#8377', '8376#issuecomment-', '8354#issuecomment-', '#8384'])(
		'links the example %s',
		(example) => {
			expect(skill).toContain(example)
		},
	)
})

const SPLIT_FILE = 'theme-split.md'
const ORDER_REASON = /--order-reason "#<seam> -> #<effect>: (?<reason>[^"]+)"/u
const SEAM_CHAIN = [1, 2]

function section_of(markdown: string, heading: string): string {
	return markdown.split(heading)[1]?.split('\n## ', 1)[0] ?? ''
}

describe('board-theme skill theme split', () => {
	const skill = read_skill_file('SKILL.md')
	const split = read_skill_file(SPLIT_FILE)

	it('points step 5 at the seam-then-parallel split', () => {
		const step = section_of(skill, '## 5. File the Issue once the user decides')

		expect(step).toContain('seam child, then parallel effect children')
		expect(step).toContain(`(${SPLIT_FILE})`)
	})

	it.each([
		"the theme's row in `THEME_DEFS` with every field",
		'the colors',
		'the sound palette',
		'the signal each effect reads',
		'the draw order',
		'the shared timing constants',
		'a function that draws nothing',
		'It touches its own files and tests only, never a shared file',
		'Declare no dependency between effect children',
		'Compare the planned paths',
		'move that socket into the seam child',
		'after every effect child has\n  merged',
		'"6. After the first merge"',
	])('the split carries the rule "%s"', (rule) => {
		expect(split).toContain(rule)
	})

	it('gives an order reason the epic accepts for each seam-to-effect chain', () => {
		const reason = ORDER_REASON.exec(split)?.groups?.['reason'] ?? ''

		expect(reason).not.toBe('')
		expect(epic_chain_kind.find_refusal([{ chain: SEAM_CHAIN, reason }])).toBeUndefined()
	})
})

const COST_FILE = 'render-cost.md'
// A millisecond limit, apart from the board's paces the demo keeps.
const MS_NUMBER = /\d ?ms\b/u
const PACE_LINE = 'a letter every 50 ms'
const EFFECT_BUDGET = 'Each effect child keeps the budget test green'

describe('board-theme skill render cost', () => {
	const skill = read_skill_file('SKILL.md')
	const split = read_skill_file(SPLIT_FILE)
	const cost = read_skill_file(COST_FILE)

	it.each([
		['5. File the Issue once the user decides', '"When filing"'],
		['6. After the first merge', '"After every effect child has merged"'],
	])('points step %s at the render-cost section %s', (step, heading) => {
		expect(section_of(skill, `## ${step}`)).toContain(`(${COST_FILE}) → ${heading}`)
	})

	it.each([
		'#8825, `scripts/run/board/run-board-composite-budget.test.ts`',
		'stays green',
		'`ghost`), each run on the real',
		'`pnpm josh run:board --timing --theme <theme>`',
		'stall and wake lag no worse than',
		'baseline recorded on #8904',
		'The seam child adds the new theme to the budget test',
		EFFECT_BUDGET,
		'the stalls (count, length, `at` and\n  stage), the wake lag',
		'the `redraw` breakdown outside the draws',
	])('the render-cost steps carry "%s"', (rule) => {
		expect(cost).toContain(rule)
	})

	it.each(['the new theme in the budget test', EFFECT_BUDGET])(
		'the split carries the budget rule "%s"',
		(rule) => {
			expect(split).toContain(rule)
		},
	)

	it.each(['SKILL.md', SPLIT_FILE, COST_FILE])('%s holds no millisecond limit', (name) => {
		const lines = read_skill_file(name).split('\n')

		expect(lines.filter((line) => MS_NUMBER.test(line) && !line.includes(PACE_LINE))).toEqual([])
	})
})

// joshuafolkken/kit#9096: themes are built in kit directly and shown on the live board's demo mode.
describe('board-theme skill live demo', () => {
	const skill = read_skill_file('SKILL.md')

	it.each([
		'No throwaway JS demo.',
		'the one view command alone in its code block, no trailing comment',
		'`s` `a` `d` `w` `q` `e`',
	])('carries the rule "%s"', (rule) => {
		expect(skill).toContain(rule)
	})

	it.each(['demo-template.md', '.mjs', 'scratch:run', 'DEMO_STEPS'])(
		'no longer points at the throwaway demo by "%s"',
		(gone) => {
			expect(skill).not.toContain(gone)
		},
	)
})
