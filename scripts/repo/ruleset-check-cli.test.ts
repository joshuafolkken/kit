import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { RequiredChecksReport } from './required-checks-report'
import { ruleset_check_cli } from './ruleset-check-cli'

const mocks = vi.hoisted(() => ({
	repo: 'joshuafolkken/game-kit',
	inspect: vi.fn(),
	apply_missing: vi.fn(),
}))

vi.mock('#scripts/gh/gh-spawn', () => ({
	gh_spawn: { get_repo_name_with_owner: (): string => mocks.repo },
}))

vi.mock('./ruleset-check', () => ({
	ruleset_check: { inspect: mocks.inspect, apply_missing: mocks.apply_missing },
}))

const RULESET_ID = 7
const FAILURE = 1
const RELEASE_CLASSIFICATION = 'Release classification'
const MISSING: RequiredChecksReport = {
	repo: mocks.repo,
	branch: 'main',
	source: { kind: 'ruleset', ruleset_id: RULESET_ID, contexts: ['Checks'] },
	expected: ['Checks', RELEASE_CLASSIFICATION],
	missing: [RELEASE_CLASSIFICATION],
}
const COMPLETE: RequiredChecksReport = { ...MISSING, missing: [] }

beforeEach(() => {
	vi.resetAllMocks()
	vi.spyOn(console, 'info').mockImplementation(() => undefined)
	vi.spyOn(console, 'error').mockImplementation(() => undefined)
})

describe('ruleset_check_cli.run', () => {
	// Changing a repository setting is outward-facing: only the flag a person typed may write.
	it('never writes without --apply, and exits non-zero while a check is missing', () => {
		mocks.inspect.mockReturnValue(MISSING)

		expect(ruleset_check_cli.run([])).toBe(FAILURE)
		expect(mocks.apply_missing).not.toHaveBeenCalled()
	})

	it('writes the missing checks with --apply', () => {
		mocks.inspect.mockReturnValue(MISSING)
		mocks.apply_missing.mockReturnValue(true)

		expect(ruleset_check_cli.run([ruleset_check_cli.APPLY_FLAG])).toBe(0)
		expect(mocks.apply_missing).toHaveBeenCalledWith(MISSING)
	})

	it('writes nothing with --apply when nothing is missing', () => {
		mocks.inspect.mockReturnValue(COMPLETE)

		expect(ruleset_check_cli.run([ruleset_check_cli.APPLY_FLAG])).toBe(0)
		expect(mocks.apply_missing).not.toHaveBeenCalled()
	})

	it('reports a failed write instead of throwing', () => {
		mocks.inspect.mockReturnValue(MISSING)
		mocks.apply_missing.mockImplementation(() => {
			throw new Error('HTTP 403')
		})

		expect(ruleset_check_cli.run([ruleset_check_cli.APPLY_FLAG])).toBe(FAILURE)
	})
})
