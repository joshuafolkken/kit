import { describe, expect, it } from 'vitest'
import { run_ship, type ShipSection } from './run-ship'

const OK = 0
const FAILED = 1

function section(header: string, body: string, code = OK): ShipSection {
	return { header, body, code }
}

describe('run_ship.format_report — each step under its own header', () => {
	it('joins the executed sections with a blank line', () => {
		const report = run_ship.format_report([
			section(run_ship.GATE_HEADER, 'green'),
			section(run_ship.COMMIT_HEADER, 'pushed'),
		])

		expect(report).toBe('=== gate ===\ngreen\n\n=== commit/push/PR ===\npushed')
	})

	it('closes with the name of the step that stopped the run', () => {
		const report = run_ship.format_report([section(run_ship.GATE_HEADER, 'red', FAILED)])

		expect(report).toBe(`=== gate ===\nred\n\n${run_ship.STOPPED_PREFIX}${run_ship.GATE_HEADER}`)
	})
})

// joshuafolkken/kit#4166: a stopped preflight's unmet preconditions reach the stop record.
describe('run_ship.section_of — a stage result under its header', () => {
	it('carries the preconditions and the conflicts a stage handed back', () => {
		const result = { code: FAILED, out: 'red', conflicts: ['a.ts'], preconditions: ['lock'] }

		expect(run_ship.section_of('h', result)).toStrictEqual({
			header: 'h',
			body: 'red',
			code: FAILED,
			conflicts: ['a.ts'],
			preconditions: ['lock'],
		})
	})

	it('adds neither key to a result that has none', () => {
		expect(run_ship.section_of('h', { code: OK, out: 'ok' })).toStrictEqual(section('h', 'ok'))
	})
})

describe('run_ship.failed_section — the step that stopped the ship', () => {
	it('returns the first failed section', () => {
		const failed = run_ship.failed_section([section('a', '', OK), section('b', '', FAILED)])

		expect(failed?.header).toBe('b')
	})

	it('returns undefined when every executed step was green', () => {
		expect(run_ship.failed_section([section('a', '', OK)])).toBeUndefined()
	})
})

describe('run_ship.exit_code — a ship is clean only when every executed step was', () => {
	it('exits zero when all steps succeeded', () => {
		expect(run_ship.exit_code([section('a', '', OK), section('b', '', OK)])).toBe(OK)
	})

	it('exits non-zero when any step failed', () => {
		expect(run_ship.exit_code([section('a', '', OK), section('b', '', FAILED)])).toBe(FAILED)
	})
})
