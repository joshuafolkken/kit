import { describe, expect, it } from 'vitest'
import { baseline_measure } from './baseline-measure'

const HEADING = '## ベースライン'
const COMMAND = 'pnpm josh run:wake'
const DATE = '2026-09-20'
const BODY = [HEADING, '', `- \`${COMMAND}\` → 1.00`, ''].join('\n')

describe('baseline_measure.parse_baselines', () => {
	it('reads a command and value pair', () => {
		expect(baseline_measure.parse_baselines(BODY)).toEqual([{ command: COMMAND, value: '1.00' }])
	})

	it('reads nothing from a prose-only section', () => {
		const prose = `${HEADING}\n\nだいたい 1.00 のままだった`

		expect(baseline_measure.parse_baselines(prose)).toEqual([])
	})

	it('accepts an ASCII arrow', () => {
		const ascii = `${HEADING}\n\n- \`echo hi\` -> hi`

		expect(baseline_measure.parse_baselines(ascii)).toEqual([{ command: 'echo hi', value: 'hi' }])
	})
})

describe('baseline_measure.has_command_value', () => {
	it('is true when at least one pair parses', () => {
		expect(baseline_measure.has_command_value(BODY)).toBe(true)
	})

	it('is false for a prose-only section', () => {
		expect(baseline_measure.has_command_value(`${HEADING}\n\nそのまま`)).toBe(false)
	})
})

describe('baseline_measure.format_pair', () => {
	it('prints the command with its before and after', () => {
		const pair = baseline_measure.format_pair({ command: COMMAND, value: '1.00' }, '1.00')

		expect(pair).toBe('`pnpm josh run:wake`\n  before: 1.00\n  after:  1.00')
	})
})

describe('baseline_measure.is_no_change', () => {
	it('is true when the value did not move', () => {
		expect(baseline_measure.is_no_change('1.00', ' 1.00 ')).toBe(true)
	})

	it('is false when the value moved', () => {
		expect(baseline_measure.is_no_change('1.00', '1.42')).toBe(false)
	})
})

describe('baseline_measure.ledger_line', () => {
	it('writes a grammar-conforming line keyed to the command', () => {
		const line = baseline_measure.ledger_line({ command: COMMAND, value: '1.00' }, DATE)

		expect(line).toBe(
			'- k:pnpm-josh-run-wake | d1 | 2026-09-20 | pnpm josh measure:rerun | 反証: pnpm josh run:wake は before/after とも 1.00（変化なし）',
		)
	})

	it('splits into exactly five ` | ` fields even when the command has a pipe', () => {
		const line = baseline_measure.ledger_line({ command: 'a | wc -l', value: '3' }, DATE)

		expect(line.split(' | ')).toHaveLength(5)
	})

	it('derives a lowercase dash-joined slug', () => {
		expect(baseline_measure.slug_of('pnpm josh Run:Wake')).toBe('pnpm-josh-run-wake')
	})

	it('falls back to a fixed slug for an all-symbol command', () => {
		expect(baseline_measure.slug_of('>>>')).toBe('baseline')
	})
})
