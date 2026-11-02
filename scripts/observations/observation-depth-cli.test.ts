import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { observation_depth_cli } from './observation-depth-cli'

// joshuafolkken/kit#5850: the depth alone on stdout, the applied row on stderr.

const info_lines: Array<string> = []
const error_lines: Array<string> = []

beforeEach(() => {
	vi.spyOn(console, 'info').mockImplementation((line: string) => {
		info_lines.push(line)
	})
	vi.spyOn(console, 'error').mockImplementation((line: string) => {
		error_lines.push(line)
	})
})

afterEach(() => {
	info_lines.length = 0
	error_lines.length = 0
	vi.restoreAllMocks()
})

const ROOT = path.resolve('/repo')
const LANE_PLAN = 'scripts/lane/lane-plan.ts'

function exists_always(): boolean {
	return true
}

function is_lane_plan(absolute_path: string): boolean {
	return absolute_path === path.join(ROOT, LANE_PLAN)
}

const PLACES = { root: ROOT, cwd: ROOT, exists: exists_always }

describe('observation_depth_cli.run — a subject path', () => {
	it('prints the depth on stdout and the row it applied on stderr', () => {
		const code = observation_depth_cli.run([LANE_PLAN], PLACES)

		expect(code).toBe(0)
		expect(info_lines).toStrictEqual(['d1'])
		expect(error_lines).toStrictEqual([
			'scripts/lane/lane-plan.ts → d1: The run orchestration that executes an Issue (under scripts/lane/)',
		])
	})

	it('names the fallback when no deeper row claims the path', () => {
		observation_depth_cli.run(['prompts/review.md'], PLACES)

		expect(info_lines).toStrictEqual(['d0'])
		expect(error_lines).toStrictEqual([
			'prompts/review.md → d0: What a consumer of this package touches (no deeper row claims it)',
		])
	})

	it('reads an absolute path as its repository path', () => {
		observation_depth_cli.run([path.join(ROOT, 'tools/time/time-cli.ts')], PLACES)

		expect(info_lines).toStrictEqual(['d2'])
		expect(error_lines).toStrictEqual([
			'tools/time/time-cli.ts → d2: What measures a run (under tools/time/)',
		])
	})
})

describe('observation_depth_cli.run — nothing answered', () => {
	it('refuses a path outside the root rather than answering d0', () => {
		const code = observation_depth_cli.run(['../other/file.ts'], PLACES)

		expect(code).toBe(1)
		expect(info_lines).toStrictEqual([])
		expect(error_lines).toStrictEqual([`Refused: ../other/file.ts is outside ${ROOT}`])
	})

	// joshuafolkken/kit#5885: a root-relative path typed from a subdirectory names nothing.
	it('refuses a path that does not exist rather than answering d0', () => {
		const cwd = path.join(ROOT, 'scripts')
		const code = observation_depth_cli.run([LANE_PLAN], { root: ROOT, cwd, exists: is_lane_plan })

		expect(code).toBe(1)
		expect(info_lines).toStrictEqual([])
		expect(error_lines).toStrictEqual([
			`Refused: ${LANE_PLAN} does not exist (a relative path is read from ${cwd})`,
		])
	})

	it.each([[[]], [['a', 'b']], [['']]])('exits non-zero with the usage for %j', (argv) => {
		expect(observation_depth_cli.run(argv, PLACES)).toBe(1)
		expect(info_lines).toStrictEqual([])
		expect(error_lines).toStrictEqual([observation_depth_cli.USAGE])
	})
})
