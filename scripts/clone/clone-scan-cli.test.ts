import { afterEach, describe, expect, it, vi } from 'vitest'
import { clone_scan } from './clone-scan'
import { clone_scan_cli } from './clone-scan-cli'

// joshuafolkken/kit#2217: the CLI carries the argument guard and the exit-code contract, so both
// arms are pinned here rather than left to the entry point alone.

const SUCCESS_EXIT = 0
const FAILURE_EXIT = 1

afterEach(() => {
	vi.restoreAllMocks()
})

// Silence the report path and make it deterministic: the scan itself is covered by clone-scan.test.ts.
function stub_scan(): void {
	vi.spyOn(clone_scan, 'scan').mockReturnValue([])
	vi.spyOn(clone_scan, 'format_report').mockReturnValue(clone_scan.CLEAN_VERDICT)
	vi.spyOn(console, 'info').mockReturnValue(undefined)
}

describe('clone_scan_cli.run guards its arguments', () => {
	it('rejects a positional argument with the usage and a non-zero exit', () => {
		const error = vi.spyOn(console, 'error').mockReturnValue(undefined)

		const code = clone_scan_cli.run(['unexpected'])

		expect(code).toBe(FAILURE_EXIT)
		expect(error).toHaveBeenCalledWith(clone_scan_cli.USAGE)
	})

	it('scans and prints the report when given no positional argument', () => {
		stub_scan()
		const info = vi.spyOn(console, 'info').mockReturnValue(undefined)

		const code = clone_scan_cli.run([])

		expect(code).toBe(SUCCESS_EXIT)
		expect(info).toHaveBeenCalledWith(clone_scan.CLEAN_VERDICT)
	})

	it('treats a flag as non-positional and still scans', () => {
		stub_scan()

		expect(clone_scan_cli.run(['--anything'])).toBe(SUCCESS_EXIT)
	})
})
