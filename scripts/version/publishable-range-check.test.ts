import { afterEach, describe, expect, it, vi } from 'vitest'
import { publishable_range_check } from './publishable-range-check'
import {
	MANIFEST_FIXTURE,
	probe_with_one_suppressed,
	RESOLVED_PROBE,
	SUPPRESSED_NAME,
	SUPPRESSED_RANGE,
	WORKSPACE_NAME,
	WORKSPACE_RANGE,
} from './publishable-range-fixture'

const FAILURE_EXIT_CODE = 1
const SUCCESS_EXIT_CODE = 0
const PUBLISHED_RANGE_COUNT = '2'

afterEach(() => {
	vi.restoreAllMocks()
})

describe('check', () => {
	it('exits zero when every published range resolves', () => {
		vi.spyOn(console, 'info').mockImplementation(() => undefined)

		expect(publishable_range_check.check(MANIFEST_FIXTURE, () => RESOLVED_PROBE)).toBe(
			SUCCESS_EXIT_CODE,
		)
	})

	it('exits non-zero when a range has no visible version', () => {
		vi.spyOn(console, 'error').mockImplementation(() => undefined)

		expect(publishable_range_check.check(MANIFEST_FIXTURE, probe_with_one_suppressed)).toBe(
			FAILURE_EXIT_CODE,
		)
	})

	it('reports the unresolvable range on stderr so a publish log shows what to fix', () => {
		const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)

		publishable_range_check.check(MANIFEST_FIXTURE, probe_with_one_suppressed)

		expect(error.mock.calls[0]?.[0]).toContain(`${SUPPRESSED_NAME}@${SUPPRESSED_RANGE}`)
	})

	it('counts only the registry ranges in the success line', () => {
		const info = vi.spyOn(console, 'info').mockImplementation(() => undefined)

		publishable_range_check.check(MANIFEST_FIXTURE, () => RESOLVED_PROBE)

		expect(info.mock.calls.at(-1)?.[0]).toContain(PUBLISHED_RANGE_COUNT)
	})

	// A workspace link cannot be probed, so it must be named rather than silently dropped from the
	// count — otherwise narrowed coverage reads as full coverage.
	it('names the range it could not check', () => {
		const info = vi.spyOn(console, 'info').mockImplementation(() => undefined)

		publishable_range_check.check(MANIFEST_FIXTURE, () => RESOLVED_PROBE)

		expect(info.mock.calls[0]?.[0]).toContain(`${WORKSPACE_NAME}@${WORKSPACE_RANGE}`)
	})

	it('never probes a range the registry cannot answer for', () => {
		vi.spyOn(console, 'info').mockImplementation(() => undefined)
		const probe = vi.fn(() => RESOLVED_PROBE)

		publishable_range_check.check(MANIFEST_FIXTURE, probe)

		expect(probe).not.toHaveBeenCalledWith(WORKSPACE_NAME, WORKSPACE_RANGE)
	})
})
