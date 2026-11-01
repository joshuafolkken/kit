import { describe, expect, it } from 'vitest'
import { lint_timing } from './lint-timing'

// joshuafolkken/kit#5712: the one shape `josh lint:related` prints and `lane:breakdown` reads back.

const LABEL = 'josh lint:related'
const FACTS = ['12 files', 'daemon started', 'cache absent']
const DETAIL = 'prettier 1.0 s · eslint 2.0 s · 12 files · daemon started · cache absent'

describe('lint_timing.line', () => {
	it('prints each tool’s seconds, then the facts it was given', () => {
		const line = lint_timing.line({
			label: LABEL,
			prettier_ms: 1000,
			eslint_ms: 2000,
			facts: FACTS,
		})

		expect(line).toBe(`${LABEL} timing — ${DETAIL}\n`)
	})

	it('prints only the two tools when given no facts, as the gate does', () => {
		const line = lint_timing.line({ label: 'lint', prettier_ms: 1000, eslint_ms: 2000, facts: [] })

		expect(line).toBe('lint timing — prettier 1.0 s · eslint 2.0 s\n')
	})
})

describe('lint_timing.detail_of', () => {
	it('reads the detail of the label’s line among the run’s other output', () => {
		const output = `Checking formatting...\n${LABEL} timing — ${DETAIL}\n\n✓ ${LABEL} passed\n`

		expect(lint_timing.detail_of(LABEL, output)).toBe(DETAIL)
	})

	it('answers undefined for a run that printed no timing line', () => {
		expect(lint_timing.detail_of(LABEL, `✓ ${LABEL} passed\n`)).toBeUndefined()
	})

	it('answers undefined for another label’s timing line', () => {
		expect(lint_timing.detail_of(LABEL, `lint timing — ${DETAIL}\n`)).toBeUndefined()
	})
})
