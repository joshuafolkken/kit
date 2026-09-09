import { AI_DOCS, read_unwrapped, read_unwrapped_rule_surface } from '#scripts/ai-document-fixture'
import { describe, expect, it } from 'vitest'

// joshuafolkken/kit#1584: 波は既存の依存宣言で組めるが、それがどこにも書かれていなかったので、
// 必要になった人は毎回発見し直すか別の機構を作ろうとしていた。以下のマーカーは、書き換えで
// 最初に落ちる要点 — 単独実行が専用機構ではないこと、宣言してよい条件、詰まったときの伝播 — を
// 固定する。表現を変えるときは、その要点がまだ書かれているかを確かめてから直すこと。

const SKILL = '.claude/skills/epic-commands/SKILL.md'
const POINTER = 'prompts/collaboration-workflow/execution-waves.md'

const SURFACE_MARKERS: ReadonlyArray<string> = [
	'Execution waves',
	'chaining every child of the later wave to every child of the earlier one',
	'Running one child alone is a wave of one',
	'There is no `solo` mechanism, and none is needed',
	'The block above is an illustration, not something to paste',
	'Write the boundary with `pnpm josh epic --add`, not by hand',
	'are both refused while the hub sits in more than one chain with nothing after it',
	'The first child of the next wave therefore goes into the declaration by hand',
	'Declare a boundary only where the later wave needs the earlier wave',
	'The park itself is not the halt',
	'A mere preference of order is not a dependency',
	'one stuck child in the earlier wave stops every wave behind it',
	"removing that child's `needs-decision`",
	'joshuafolkken/kit#1474',
]

const ORDER_MARKERS: ReadonlyArray<string> = [
	'### The shape',
	'### Running one child alone is a wave of one',
	'### When a wave may be declared',
	'### What a jam does, and how it is cleared',
	'### The worked example',
]

const FIRST_CHAIN_LINE = '#A -> #D -> #X'
const CHAIN_LINES: ReadonlyArray<string> = [FIRST_CHAIN_LINE, '#B -> #D -> #Y', '#C -> #D -> #Z']

const POINTER_MARKERS: ReadonlyArray<string> = [
	SKILL,
	'クローン禁止・単一ソース化',
	'単独実行は「1 件だけの波」である',
]

describe('execution waves documentation', () => {
	it.each(AI_DOCS)('is reachable from %s', (document_name) => {
		const surface = read_unwrapped_rule_surface(document_name)
		for (const marker of SURFACE_MARKERS) expect(surface).toContain(marker)
	})

	it('names the wave shape, the solo case, the condition and the jam in order', () => {
		const content = read_unwrapped(SKILL)
		const positions = ORDER_MARKERS.map((marker) => content.indexOf(marker))

		expect(positions.every((position) => position !== -1)).toBe(true)
		expect(positions).toEqual(positions.toSorted((left, right) => left - right))
	})

	it('shows the fan-in chain lines that draw a boundary', () => {
		const content = read_unwrapped(SKILL)

		for (const line of CHAIN_LINES) expect(content).toContain(line)
	})
})

describe('the canonical topic file is a pointer to the skill single source', () => {
	it('names the skill as the single source and indexes what lives there', () => {
		const content = read_unwrapped(POINTER)
		for (const marker of POINTER_MARKERS) expect(content).toContain(marker)
	})

	it('does not duplicate the rule body', () => {
		const content = read_unwrapped(POINTER)

		expect(content).not.toContain(FIRST_CHAIN_LINE)
	})
})
