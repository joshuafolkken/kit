import { describe, expect, it } from 'vitest'
import { observation_ledger_line } from './observation-ledger-line'

const VALID_LINE =
	'- k:example | d1 | 2026-09-10 | pnpm josh run:progress | a placeholder where a clock belonged'

function reason_for(line: string): string | undefined {
	return observation_ledger_line.broken_ledger_lines(line)[0]?.reason
}

describe('observation_ledger_line — conforming input', () => {
	it('passes a conforming line', () => {
		expect(observation_ledger_line.broken_ledger_lines(VALID_LINE)).toEqual([])
	})

	it('ignores prose and headings that are not entry lines', () => {
		const content = ['## Ledger', '', 'some prose', VALID_LINE].join('\n')

		expect(observation_ledger_line.broken_ledger_lines(content)).toEqual([])
	})
})

describe('observation_ledger_line — broken lines', () => {
	it('rejects an uppercase slug', () => {
		expect(reason_for(VALID_LINE.replace('k:example', 'k:Example'))).toContain('slug')
	})

	it('rejects depth d0', () => {
		expect(reason_for(VALID_LINE.replace('d1', 'd0'))).toContain('d0')
	})

	it('rejects a malformed date', () => {
		expect(reason_for(VALID_LINE.replace('2026-09-10', '2026/09/10'))).toContain('YYYY-MM-DD')
	})

	it('rejects a vertical bar inside the last field', () => {
		expect(reason_for(`${VALID_LINE} | extra`)).toContain('fields')
	})

	it('rejects an empty where field', () => {
		expect(reason_for('- k:example | d1 | 2026-09-10 |  | a phenomenon')).toContain('where')
	})
})
