import { afterEach, expect, it, vi } from 'vitest'
import { run_ship_cli } from './run-ship-cli'

const FAILED = 1

afterEach(() => {
	vi.restoreAllMocks()
})

it('names --unpinned-ok in the usage a malformed command prints', async () => {
	const error = vi.spyOn(console, 'error').mockReturnValue()

	expect(await run_ship_cli.run(['--force'])).toBe(FAILED)
	expect(error).toHaveBeenCalledWith(
		expect.stringContaining('[--review [--unpinned-ok "<reason>"]]'),
	)
})
