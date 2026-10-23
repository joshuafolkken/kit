import { afterEach, describe, expect, it, vi } from 'vitest'
import { run_review_cli } from './run-review-cli'
import { run_review_pinned } from './run-review-pinned'

// joshuafolkken/kit#4647: `--unpinned-ok "<reason>"` is a start, not a usage error — its reason reaches
// the pinned check, and a stop there exits non-zero before the gate opens.

const FAILURE_EXIT_CODE = 1

afterEach(() => {
	vi.restoreAllMocks()
})

describe('run with --unpinned-ok', () => {
	it('hands its reason to the pinned check and stops on its verdict', async () => {
		vi.spyOn(process.stderr, 'write').mockReturnValue(true)
		const check = vi.spyOn(run_review_pinned, 'check').mockResolvedValue({ kind: 'stop', text: '' })

		expect(await run_review_cli.run(['--unpinned-ok', 'only logs'])).toBe(FAILURE_EXIT_CODE)
		expect(check).toHaveBeenCalledWith('only logs')
	})
})
