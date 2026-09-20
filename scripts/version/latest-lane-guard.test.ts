import { afterEach, describe, expect, it, vi } from 'vitest'
import { latest_lane_guard } from './latest-lane-guard'

// joshuafolkken/kit#2135: a lane never runs `josh latest`. The stamp `latest:scope` reads is keyed
// to the project root, so a fresh lane always reads as stale — the answer is fixed at the source
// rather than left to a prose prohibition nothing enforces.

// A lane directory is `<something>-lanes/<issue-number>`; a primary checkout is not.
const LANE_CWD = '/Users/dev/.kit-lanes/2135'
const PRIMARY_CWD = '/Users/dev/kit'

afterEach(() => {
	vi.restoreAllMocks()
	process.exitCode = undefined
})

describe('latest_lane_guard.is_lane', () => {
	it('is true for a lane work tree', () => {
		expect(latest_lane_guard.is_lane(LANE_CWD, {})).toBe(true)
	})

	it('is false for the primary checkout', () => {
		expect(latest_lane_guard.is_lane(PRIMARY_CWD, {})).toBe(false)
	})
})

describe('latest_lane_guard.main', () => {
	it('refuses inside a lane, naming why and where to run it', () => {
		vi.spyOn(process, 'cwd').mockReturnValue(LANE_CWD)
		const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)

		latest_lane_guard.main()

		expect(process.exitCode).toBe(latest_lane_guard.REFUSAL_EXIT_CODE)
		expect(error).toHaveBeenCalledWith(latest_lane_guard.LANE_REFUSAL)
	})

	it('passes silently in the primary checkout', () => {
		vi.spyOn(process, 'cwd').mockReturnValue(PRIMARY_CWD)
		const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)

		latest_lane_guard.main()

		expect(process.exitCode).toBeUndefined()
		expect(error).not.toHaveBeenCalled()
	})
})

// The refusal has to carry both halves the acceptance criteria name: why a lane is not asked (the
// stamp is per project root) and that the primary checkout is where it is asked.
describe('the lane messages', () => {
	it('name the project-root stamp and the primary checkout', () => {
		for (const message of [latest_lane_guard.LANE_REFUSAL, latest_lane_guard.LANE_SCOPE_REASON]) {
			expect(message).toContain('project root')
			expect(message).toContain('primary checkout')
		}
	})
})
