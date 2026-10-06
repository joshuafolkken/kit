import { describe, expect, it } from 'vitest'
import {
	COMMAND_TIMEOUT_MS,
	FETCH_TIMEOUT_MS,
	GH_API_TIMEOUT_MS,
	GIT_TIMEOUT_MS,
	HOOK_PROCESS_TIMEOUT_MS,
	INSTALL_TIMEOUT_MS,
	LINT_TIMEOUT_MS,
	PROBE_TIMEOUT_MS,
	SUITE_TIMEOUT_MS,
} from './timeouts'

// The values the file-local constants these replaced carried (joshuafolkken/kit#3265). Consolidating
// them was a rename, never a retune, so each shared limit is pinned to the number its callers had.
const EXPECTED_LIMITS: ReadonlyArray<readonly [string, number, number]> = [
	['PROBE_TIMEOUT_MS', PROBE_TIMEOUT_MS, 2000],
	['FETCH_TIMEOUT_MS', FETCH_TIMEOUT_MS, 10_000],
	['GIT_TIMEOUT_MS', GIT_TIMEOUT_MS, 10_000],
	['HOOK_PROCESS_TIMEOUT_MS', HOOK_PROCESS_TIMEOUT_MS, 15_000],
	['GH_API_TIMEOUT_MS', GH_API_TIMEOUT_MS, 20_000],
	['COMMAND_TIMEOUT_MS', COMMAND_TIMEOUT_MS, 30_000],
	['LINT_TIMEOUT_MS', LINT_TIMEOUT_MS, 180_000],
	['INSTALL_TIMEOUT_MS', INSTALL_TIMEOUT_MS, 600_000],
	['SUITE_TIMEOUT_MS', SUITE_TIMEOUT_MS, 1_800_000],
]

describe('timeouts', () => {
	it.each(EXPECTED_LIMITS)('keeps %s at the value its callers had', (_name, actual, expected) => {
		expect(actual).toBe(expected)
	})

	it('keeps an install well under a suite, since a person waits on the install', () => {
		expect(INSTALL_TIMEOUT_MS).toBeLessThan(SUITE_TIMEOUT_MS)
	})
})
