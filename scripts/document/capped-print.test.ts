import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { capped_output } from './capped-print'
import { capped_print_fixture } from './capped-print-fixture'

// A command's output under the Bash output cap is printed whole; past it, it is written as part files
// each under the cap and printed as a listing of them (joshuafolkken/kit#3143).

const CAP = 1000
const BUDGET = CAP - capped_output.HEADROOM_CHARS
const LINE = `${'word '.repeat(9)}\n`
const LONG_REPEAT = 30
const LONG = LINE.repeat(LONG_REPEAT)
const SHORT = 'a short output'
const ROOT = mkdtempSync(path.join(os.tmpdir(), 'capped-print-test-'))

mkdirSync(path.join(ROOT, '.claude'))
writeFileSync(
	path.join(ROOT, '.claude', 'settings.json'),
	JSON.stringify({ env: { BASH_MAX_OUTPUT_LENGTH: String(CAP) } }),
)

const info_mock = vi.fn()

function prints(): Array<string> {
	return info_mock.mock.calls.map((call) => String(call[0]))
}

function printed(): string {
	return prints().join('\n')
}

function directory_of(listing: string | undefined = ''): string {
	return path.dirname(capped_print_fixture.part_files(listing)[0] ?? '')
}

beforeEach(() => {
	info_mock.mockReset()
	vi.spyOn(console, 'info').mockImplementation(info_mock)
})

afterAll(() => {
	vi.restoreAllMocks()
	rmSync(ROOT, { recursive: true, force: true })
})

describe('capped_output.capped_print', () => {
	it('prints an output under the cap whole', () => {
		capped_output.capped_print(SHORT, 'label', ROOT)

		expect(printed()).toBe(SHORT)
	})

	it('prints a listing of more than one part, naming the Read tool, for an output past the cap', () => {
		capped_output.capped_print(LONG, 'label', ROOT)

		expect(printed()).toContain('Read tool')
		expect(printed()).not.toContain(LINE)
		expect(capped_print_fixture.part_files(printed()).length).toBeGreaterThan(1)
	})

	it('writes every part under the cap less its headroom', () => {
		capped_output.capped_print(LONG, 'label', ROOT)

		for (const file of capped_print_fixture.part_files(printed())) {
			expect(readFileSync(file, 'utf8').length).toBeLessThanOrEqual(BUDGET)
		}
	})
})

// The launcher line and stderr share the Bash result, so a text just under the bare cap still
// overflows it; the headroom is what the boundary is measured against.
describe('capped_output.capped_print — the boundary and the parts', () => {
	it('prints a text one character under the budget whole', () => {
		const text = 'x'.repeat(BUDGET - 1)

		capped_output.capped_print(text, 'label', ROOT)

		expect(printed()).toBe(text)
	})

	it('writes a text at the budget as parts, though it is under the bare cap', () => {
		capped_output.capped_print('x'.repeat(BUDGET), 'label', ROOT)

		expect(capped_print_fixture.part_files(printed()).length).toBeGreaterThan(0)
	})

	it('writes parts that concatenate back to exactly the output', () => {
		capped_output.capped_print(LONG, 'label', ROOT)

		expect(capped_print_fixture.restored(printed())).toBe(LONG)
	})

	it('gives each call its own directory so parallel calls never share parts', () => {
		capped_output.capped_print(LONG, 'first', ROOT)
		capped_output.capped_print(LONG, 'second', ROOT)

		const [first, second] = prints()

		expect(directory_of(first)).not.toBe(directory_of(second))
	})
})
