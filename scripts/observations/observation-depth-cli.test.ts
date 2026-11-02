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

describe('observation_depth_cli.run — a subject path', () => {
	it('prints the depth on stdout and the row it applied on stderr', () => {
		const code = observation_depth_cli.run(['scripts/lane/lane-plan.ts'])

		expect(code).toBe(0)
		expect(info_lines).toStrictEqual(['d1'])
		expect(error_lines).toStrictEqual([
			'scripts/lane/lane-plan.ts → d1: The run orchestration that executes an Issue (under scripts/lane/)',
		])
	})

	it('names the fallback when no deeper row claims the path', () => {
		observation_depth_cli.run(['prompts/review.md'])

		expect(info_lines).toStrictEqual(['d0'])
		expect(error_lines).toStrictEqual([
			'prompts/review.md → d0: What a consumer of this package touches (no deeper row claims it)',
		])
	})
})

describe('observation_depth_cli.run — a usage error', () => {
	it.each([[[]], [['a', 'b']], [['']]])('exits non-zero with the usage for %j', (argv) => {
		expect(observation_depth_cli.run(argv)).toBe(1)
		expect(info_lines).toStrictEqual([])
		expect(error_lines).toStrictEqual([observation_depth_cli.USAGE])
	})
})
