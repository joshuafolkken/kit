import { existsSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { delivered_rules } from './delivered-rules'
import { lane_direct_tool } from './lane-direct-tool'
import { timed_rerun } from './timed-rerun'

// joshuafolkken/kit#4356: a lane agent timed a whole-tree `eslint` twice to learn what CI already
// records. The refused set is the timer in each spelling a run reaches for; the silent set is the
// record reads the rule points to and the ordinary commands that only mention a timer.

const MEASURED = '/usr/bin/time -p pnpm exec eslint . --cache --cache-location /tmp/exp.cache'
const JOBS_READ = 'gh api --method GET "repos/o/r/actions/runs/12/jobs?per_page=100" --jq ".jobs[]"'
const LANE_STATS = 'pnpm josh lane:stats --period 7'
const TOPIC = new URL('../../prompts/collaboration-workflow/measurement.md', import.meta.url)

describe('timed_rerun.is_timed_run', () => {
	it.each([
		MEASURED,
		'time pnpm exec eslint .',
		'hyperfine "pnpm exec vitest run"',
		'CI=1 time vitest run',
		'cd scripts && time tsc -p .',
	])('fires on %j', (command) => {
		expect(timed_rerun.is_timed_run(command)).toBe(true)
	})

	it.each([
		JOBS_READ,
		LANE_STATS,
		'git commit -m "time eslint"',
		'echo time',
		'pnpm josh reserved-run 2 -- /usr/bin/time -p eslint .',
	])('is silent on %j', (command) => {
		expect(timed_rerun.is_timed_run(command)).toBe(false)
	})
})

describe('timed_rerun.reads_the_record', () => {
	it.each([JOBS_READ, LANE_STATS, 'pnpm josh lst'])(
		'counts %j as reading the record',
		(command) => {
			expect(timed_rerun.reads_the_record(command)).toBe(true)
		},
	)

	it('does not count the timed run itself', () => {
		expect(timed_rerun.reads_the_record(MEASURED)).toBe(false)
	})
})

describe('timed-rerun row', () => {
	it('is delivered ahead of lane-direct-tool, its one overlap', () => {
		const ids = delivered_rules.DELIVERED_RULES.map((rule) => rule.id)

		expect(ids.indexOf('timed-rerun')).toBeLessThan(ids.indexOf('lane-direct-tool'))
	})

	it('names the reissue, since it is delivered once per run', () => {
		expect(timed_rerun.TIMED_RERUN_REASON).toContain('reissue the same command once')
	})

	it('leaves the reissue of a `time`-prefixed heavy tool to lane-direct-tool', () => {
		expect(lane_direct_tool.runs_heavy_tool(MEASURED)).toBe(true)
	})

	it('points at a topic file that exists', () => {
		expect(timed_rerun.TIMED_RERUN_REASON).toContain(
			'prompts/collaboration-workflow/measurement.md',
		)
		expect(existsSync(TOPIC)).toBe(true)
	})
})
