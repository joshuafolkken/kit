import { live_evidence } from '#scripts/review/live-evidence'
import { describe, expect, it } from 'vitest'
import { run_ship_evidence } from './run-ship-evidence'

// joshuafolkken/kit#5585: the evidence section is written by running the command, in the shape the
// ship's preflight reads, instead of being pasted from the terminal history.

const RUNTIME_PATH = 'scripts/run/ship/run-ship-evidence.ts'
const ROWS = '## 受け入れ条件の対応\n\n- `ac-12345678` the criterion — 満たした: test'
const DRAFT = `${ROWS}\n\n<!-- a hint with \`backticks\` -->\n\n${live_evidence.EVIDENCE_HEADING}\n`
const COMMAND = ['pnpm', 'josh', 'run:step', '5585']
const OUTPUT = 'implement\nall green\n'

function verdict_of(body: string): string {
	return live_evidence.verdict_for([RUNTIME_PATH], body)
}

describe('run_ship_evidence.with_evidence', () => {
	it('fills the draft run:prep writes so the live-evidence check passes', () => {
		const block = run_ship_evidence.block_of(COMMAND, OUTPUT)

		expect(verdict_of(DRAFT)).toBe('required')
		expect(verdict_of(run_ship_evidence.with_evidence(DRAFT, block))).toBe('satisfied')
	})

	it('writes the invocation as a code span and the output in a fence', () => {
		const body = run_ship_evidence.with_evidence(DRAFT, run_ship_evidence.block_of(COMMAND, OUTPUT))

		expect(body).toBe(
			`${DRAFT}\n\`pnpm josh run:step 5585\`\n\n\`\`\`\nimplement\nall green\n\`\`\`\n`,
		)
	})

	it('appends a second block after the first, inside the section', () => {
		const once = run_ship_evidence.with_evidence(DRAFT, run_ship_evidence.block_of(COMMAND, 'one'))
		const twice = run_ship_evidence.with_evidence(once, run_ship_evidence.block_of(['ls'], 'two'))

		expect(twice.indexOf('`ls`')).toBeGreaterThan(twice.indexOf('one'))
		expect(twice.endsWith('```\ntwo\n```\n')).toBe(true)
	})

	it('lands before a heading that follows the section, not after it', () => {
		const draft = `${live_evidence.EVIDENCE_HEADING}\n\n## Notes\n\ntext\n`
		const body = run_ship_evidence.with_evidence(draft, run_ship_evidence.block_of(['ls'], 'x'))

		expect(body.indexOf('`ls`')).toBeLessThan(body.indexOf('## Notes'))
		expect(verdict_of(body)).toBe('satisfied')
	})

	it('adds the section when the draft has none', () => {
		const body = run_ship_evidence.with_evidence(ROWS, run_ship_evidence.block_of(['ls'], 'x'))

		expect(verdict_of(body)).toBe('satisfied')
	})
})

describe('run_ship_evidence.block_of', () => {
	it('fences output holding a fence with a longer one, so the section still reads', () => {
		const block = run_ship_evidence.block_of(['cat', 'notes.md'], '```ts\ncode\n```')

		expect(block).toContain('````\n```ts\ncode\n```\n````')
		expect(verdict_of(run_ship_evidence.with_evidence(DRAFT, block))).toBe('satisfied')
	})

	it('quotes a token the shell would expand and widens a span holding a backtick', () => {
		expect(run_ship_evidence.block_of(['echo', 'a`b'], 'a`b')).toMatch(/^`` echo 'a`b' ``\n/u)
	})

	it('keeps only the tail of a long output, colors stripped', () => {
		const lines = Array.from(
			{ length: run_ship_evidence.TAIL_LINES + 5 },
			(_, index) => `line ${String(index)}`,
		)
		const block = run_ship_evidence.block_of(['ls'], `\u{1B}[31m${lines.join('\n')}\u{1B}[0m`)

		expect(block).not.toContain('line 4\n')
		expect(block).toContain(`line 5\n`)
		expect(block).not.toContain('\u{1B}')
	})
})
