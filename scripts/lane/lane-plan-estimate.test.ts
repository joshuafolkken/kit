import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { split_assess } from '#scripts/split/split-assess'
import { temporary_directory } from '#tools/test/temporary-directory'
import { describe, expect, it } from 'vitest'
import { lane_plan_estimate } from './lane-plan-estimate'

const directory = temporary_directory()
const SOURCE = 'scripts/a.ts'
const NEW_MODULE = 'scripts/new.ts'
const SCOPE = 'scope.json'
const ESTIMATE = '--estimate'
const PLAN = { issue: 7381, paths: [SOURCE], planned_at: '' }
const CHANGES = [
	{ path: SOURCE, changed_lines: 20 },
	{ path: 'scripts/caller.ts', changed_lines: 10 },
	{ path: 'docs/a.md', changed_lines: 6 },
	{ path: 'scripts/a.test.ts', changed_lines: 500 },
	{ path: 'scripts/__snapshots__/a.snap', changed_lines: 4 },
	{ path: '.josh/observations/a.md', changed_lines: 500 },
]

function file(content: string): string {
	const target = path.join(directory('estimate-'), SCOPE)

	writeFileSync(target, content)

	return target
}

describe('lane_plan_estimate', () => {
	it('adds selected callers, docs, snapshots and verification paths using the actual-size definition', async () => {
		const input = file(JSON.stringify({ changes: CHANGES }))
		const plan = await lane_plan_estimate.attach(PLAN, input)

		expect(plan.paths).toEqual(CHANGES.map((change) => change.path))
		expect(plan.estimated_size).toEqual({ files: 4, lines: 40 })
		expect(split_assess.measure(CHANGES)).toMatchObject({ ...plan.estimated_size })
	})

	it('preserves old plans when no estimate is supplied', async () => {
		await expect(lane_plan_estimate.attach(PLAN, undefined)).resolves.toBe(PLAN)
	})

	it('rejects a missing file rather than recording a zero estimate', async () => {
		await expect(lane_plan_estimate.attach(PLAN, '/absent/scope.json')).rejects.toThrow()
	})
})

describe('lane_plan_estimate validation', () => {
	it.each([
		'',
		'bad json',
		'{}',
		'{"changes":[{"path":"a","changed_lines":-1}]}',
		'{"changes":[{"path":"a","changed_lines":1.5}]}',
		'{"changes":[{"path":"a","changed_lines":"1"}]}',
		'{"changes":[{"path":"","changed_lines":1}]}',
	])('rejects malformed estimate %s', async (content) => {
		await expect(lane_plan_estimate.read(file(content))).rejects.toThrow()
	})

	it('rejects duplicate paths', async () => {
		const input = file(JSON.stringify({ changes: [CHANGES[0], CHANGES[0]] }))

		await expect(lane_plan_estimate.read(input)).rejects.toThrow('duplicate estimate path')
	})

	it('rejects an added module with no line estimate', async () => {
		const input = file(JSON.stringify({ changes: [], added: [SOURCE] }))

		await expect(lane_plan_estimate.read(input)).rejects.toThrow('added path needs an estimate')
	})

	it('rejects an estimate omitting an explicitly planned path', async () => {
		await expect(lane_plan_estimate.attach(PLAN, file('{"changes":[]}'))).rejects.toThrow(
			'planned path needs an estimate',
		)
	})
})

describe('lane_plan_estimate grouping', () => {
	it('groups an added module and importer without losing their changed lines', async () => {
		const changes = [
			{ path: SOURCE, changed_lines: 20 },
			{ path: NEW_MODULE, changed_lines: 30 },
		]
		const input = file(JSON.stringify({ changes, added: [NEW_MODULE] }))

		await expect(lane_plan_estimate.attach(PLAN, input)).resolves.toMatchObject({
			estimated_size: { files: 1, lines: 50 },
		})
	})
})

// Non-test numstat from merges 04d89c047 (#7333) and fbe1f81e3 (#7354).
// Counts include docs, generated command listings and fixture follow-through.
const HISTORY = [
	{
		issue: 7333,
		files: 10,
		lines: 229,
		rows: [
			'1\t1\tdocs/josh-command-catalog.md',
			'4\t1\tdocs/josh-commands-lane.md',
			'8\t0\tdocs/maintainers/lane-limit-measurement.md',
			'24\t0\tscripts/gh/git-pr-checks-failed.ts',
			'1\t1\tscripts/josh/josh-commands-ai.ts',
			'4\t1\tscripts/lane/lane-ledger-schema-ship.ts',
			'3\t0\tscripts/lane/lane-stats-tables.ts',
			'117\t0\tscripts/lane/lane-stop-check-stats.ts',
			'30\t6\tscripts/lane/lane-stop-stats.ts',
			'3\t11\tscripts/lane/lane-why-causes.ts',
			'12\t1\tscripts/run/ship/run-ship-stop-cause.ts',
		],
		added: ['scripts/gh/git-pr-checks-failed.ts', 'scripts/lane/lane-stop-check-stats.ts'],
	},
	{
		issue: 7354,
		files: 8,
		lines: 104,
		rows: [
			'2\t0\tcspell.config.yaml',
			'1\t1\tdocs/environment-variables.md',
			'2\t1\tdocs/josh-commands-lane.md',
			'1\t1\tdocs/maintainers/josh-commands-run-rationale.md',
			'20\t6\tscripts/agent/agent-argv.ts',
			'44\t0\tscripts/agent/agent-ship-cap.ts',
			'9\t4\tscripts/lane/lane-relaunch.ts',
			'7\t2\tscripts/run/cut/run-cut-cli-fixture.ts',
			'2\t1\tscripts/run/cut/run-cut-cli.ts',
		],
		added: ['scripts/agent/agent-ship-cap.ts'],
	},
]

describe('historical scope calibration', () => {
	it.each(HISTORY)(
		'reproduces #$issue actual size from the same per-file estimate input',
		async (sample) => {
			const changes = split_assess.parse_numstat(sample.rows.join('\n'))
			const input = file(JSON.stringify({ changes, added: sample.added }))
			const plan = await lane_plan_estimate.attach({ ...PLAN, paths: [] }, input)

			expect(plan.estimated_size).toEqual({ files: sample.files, lines: sample.lines })
			expect(
				split_assess.assess(sample.rows.join('\n'), undefined, new Set(sample.added)),
			).toMatchObject({
				...plan.estimated_size,
			})
		},
	)
})

describe('lane_plan_estimate.split', () => {
	it('removes only the estimate option and preserves plan flags', () => {
		expect(lane_plan_estimate.split(['7381', SOURCE, ESTIMATE, SCOPE, '--single'])).toEqual({
			tokens: ['7381', SOURCE, '--single'],
			file: SCOPE,
		})
		expect(lane_plan_estimate.split(['7381', SOURCE])).toEqual({ tokens: ['7381', SOURCE] })
	})

	it.each(
		[[ESTIMATE], [ESTIMATE, '--single'], [ESTIMATE, 'a', ESTIMATE, 'b']].map((tokens) => ({
			tokens,
		})),
	)('rejects ambiguous flags %j', ({ tokens }) => {
		expect(() => lane_plan_estimate.split(tokens)).toThrow()
	})
})
