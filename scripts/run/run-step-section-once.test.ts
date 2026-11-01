import { randomUUID } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { run_step_section } from './run-step-section'

const lane_child_mock = vi.hoisted(() => vi.fn(() => false))

vi.mock('#scripts/lane/lane-child-marker', () => ({
	lane_child_marker: { is_child_of: lane_child_mock },
}))

const SUCCESS = 0
const SESSION_KEY = 'CLAUDE_CODE_SESSION_ID'
const CHAIN_HEADING = /^## Run the review-to-merge chain/u
const LANE_CHILD_STEP = /^0\. \*\*A lane child\*\*/u
const REPEAT_LINE = /printed earlier this session; after a compaction: pnpm josh doc:section /u
const REVIEW = 'run:review'

beforeEach(() => {
	vi.stubEnv(SESSION_KEY, randomUUID())
	lane_child_mock.mockReturnValue(false)
	vi.spyOn(console, 'info').mockImplementation(() => undefined)
	vi.spyOn(console, 'error').mockImplementation(() => undefined)
})

afterEach(() => {
	vi.unstubAllEnvs()
	vi.restoreAllMocks()
})

function printed(): ReadonlyArray<string> {
	return vi.mocked(console.info).mock.calls.map((call) => String(call[0]))
}

function print_again(key: string): number {
	vi.mocked(console.info).mockClear()

	return run_step_section.print_once(key)
}

describe('run_step_section.print_once — a governing section once per session', () => {
	it('prints the section verbatim the first time a session asks', () => {
		expect(run_step_section.print_once(REVIEW)).toBe(SUCCESS)
		expect(printed()[0]).toMatch(CHAIN_HEADING)
	})

	it('names the section in one line after run:step printed it', () => {
		run_step_section.print_section('ship')

		expect(print_again(REVIEW)).toBe(SUCCESS)
		expect(printed()).toHaveLength(1)
		expect(printed()[0]).toMatch(REPEAT_LINE)
	})

	it('names the section in one line for ship after run:review printed it', () => {
		run_step_section.print_once(REVIEW)

		expect(print_again('ship')).toBe(SUCCESS)
		expect(printed()).toHaveLength(1)
		expect(printed()[0]).toMatch(REPEAT_LINE)
	})

	it('always prints without a session id, remembering nothing', () => {
		vi.stubEnv(SESSION_KEY, undefined)
		run_step_section.print_once(REVIEW)

		expect(print_again(REVIEW)).toBe(SUCCESS)
		expect(printed()[0]).toMatch(CHAIN_HEADING)
	})

	it("prints a lane child's own step of the chain", () => {
		lane_child_mock.mockReturnValue(true)

		expect(run_step_section.print_once('ship')).toBe(SUCCESS)
		expect(printed()[0]).toMatch(LANE_CHILD_STEP)
	})

	it('prints nothing and succeeds for a command with no row', () => {
		expect(run_step_section.print_once('run:hold')).toBe(SUCCESS)
		expect(console.info).not.toHaveBeenCalled()
	})
})
