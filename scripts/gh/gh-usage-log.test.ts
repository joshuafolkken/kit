import path from 'node:path'
import { durable_state } from '#scripts/josh/durable-state'
import { temporary_directory } from '#tools/test/temporary-directory'
import { describe, expect, it } from 'vitest'
import { gh_usage_log } from './gh-usage-log'

// joshuafolkken/kit#6707: the josh processes' usage lines, in their own capped file under the run state.

const make_directory = temporary_directory()

function fresh_target(): string {
	return path.join(make_directory('josh-gh-usage-log-'), 'usage.jsonl')
}

describe('gh_usage_log.append — the lines', () => {
	it('appends one JSON line per record, oldest first', () => {
		const target = fresh_target()

		gh_usage_log.append(target, { command: 'run:step', calls: 1 })
		gh_usage_log.append(target, { command: 'run:board', calls: 2 })

		expect(gh_usage_log.read_lines(target).map((line): unknown => JSON.parse(line))).toStrictEqual([
			{ command: 'run:step', calls: 1 },
			{ command: 'run:board', calls: 2 },
		])
	})

	it('keeps only the newest lines past its cap', () => {
		const target = fresh_target()

		for (let index = 0; index <= gh_usage_log.USAGE_CAP; index += 1) {
			gh_usage_log.append(target, { calls: index })
		}

		const lines = gh_usage_log.read_lines(target)

		expect(lines).toHaveLength(gh_usage_log.USAGE_CAP)
		expect(lines[0]).toBe('{"calls":1}')
	})

	it('reads a missing file as no lines', () => {
		expect(gh_usage_log.read_lines(fresh_target())).toStrictEqual([])
	})
})

describe('gh_usage_log.target_of — the run state file', () => {
	it('lives in the run state directory, apart from the run event stream', () => {
		const target = gh_usage_log.target_of('/repository')

		expect(path.dirname(target)).toBe(durable_state.ensure(durable_state.root()))
		expect(path.basename(target)).toMatch(/^josh-gh-usage-.*\.jsonl$/u)
	})
})
