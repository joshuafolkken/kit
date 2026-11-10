import { development_engines_verdict } from '#scripts/version/development-engines-verdict'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { overrides_diff, type ChangedBlock } from './overrides-diff'
import { overrides_diff_report } from './overrides-diff-report'

const SOURCES = {
	before: { package_json: '{"name":"before"}', workspace_yaml: '' },
	after: { package_json: '{"name":"after"}', workspace_yaml: '' },
}
const REMOVED_BLOCK: ChangedBlock = {
	file: 'pnpm-workspace.yaml',
	diff: {
		is_changed: true,
		added: [],
		removed: [{ key: 'esbuild@<=0.24.2', value: '>=0.25.0' }],
		modified: [],
	},
}

const UNCHANGED = 'devEngines: unchanged'
const MOVED_HEADING = '✖ pnpm-workspace.yaml overrides changed since HEAD:'
const KEEP_LINE = 'overrides: keep'
const RESTORE_LINE = 'overrides: restore (pnpm-workspace.yaml changed since HEAD)'

function printed(stream: typeof console.info): string {
	return vi
		.mocked(stream)
		.mock.calls.map((call) => String(call[0]))
		.join('\n')
}

beforeEach(() => {
	vi.restoreAllMocks()
	vi.spyOn(console, 'info').mockImplementation(() => undefined)
	vi.spyOn(console, 'error').mockImplementation(() => undefined)
	vi.spyOn(overrides_diff, 'read_sources').mockReturnValue(SOURCES)
	vi.spyOn(overrides_diff, 'changed_blocks').mockReturnValue([])
	vi.spyOn(development_engines_verdict, 'describe').mockReturnValue(UNCHANGED)
})

describe('overrides-diff-report — the pins held', () => {
	it('prints the devEngines line and the unchanged overrides line, moving nothing', () => {
		const verdict = overrides_diff_report.report('HEAD')

		expect(verdict).toStrictEqual({ is_overrides_moved: false, is_engines_moved: false })
		expect(printed(console.info)).toContain(UNCHANGED)
		expect(printed(console.info)).toContain('✔ overrides unchanged since HEAD')
	})

	it('judges devEngines on the two package.json contents of the range', () => {
		overrides_diff_report.report('HEAD')

		expect(vi.mocked(development_engines_verdict.describe)).toHaveBeenCalledWith(
			SOURCES.before.package_json,
			SOURCES.after.package_json,
		)
	})
})

describe('overrides-diff-report — a pin moved', () => {
	it('names the moved overrides block and reports the overrides moved', () => {
		vi.mocked(overrides_diff.changed_blocks).mockReturnValue([REMOVED_BLOCK])

		const verdict = overrides_diff_report.report('HEAD')

		expect(verdict?.is_overrides_moved).toBe(true)
		expect(printed(console.error)).toContain(MOVED_HEADING)
		expect(printed(console.info)).not.toContain('✔ overrides unchanged')
	})

	it.each(['devEngines: restore (integrity suffix missing)', 'devEngines: not judged (no HEAD)'])(
		'reports devEngines moved on %j',
		(line) => {
			vi.mocked(development_engines_verdict.describe).mockReturnValue(line)

			const verdict = overrides_diff_report.report('HEAD')

			expect(verdict).toStrictEqual({ is_overrides_moved: false, is_engines_moved: true })
		},
	)

	it('reports devEngines intact on a kept verdict', () => {
		vi.mocked(development_engines_verdict.describe).mockReturnValue('devEngines: kept')

		expect(overrides_diff_report.report('HEAD')?.is_engines_moved).toBe(false)
	})

	it('answers undefined when the range resolves to no commit, printing nothing', () => {
		vi.mocked(overrides_diff.read_sources).mockReturnValue(undefined)

		expect(overrides_diff_report.report('no-such-ref')).toBeUndefined()
		expect(vi.mocked(console.info)).not.toHaveBeenCalled()
	})
})

describe('overrides-diff-report — the overrides verdict line', () => {
	it('ends the report on keep when no block moved', () => {
		overrides_diff_report.report('HEAD')

		expect(vi.mocked(console.info)).toHaveBeenLastCalledWith(KEEP_LINE)
	})

	it('ends the report on restore naming the moved file', () => {
		vi.mocked(overrides_diff.changed_blocks).mockReturnValue([REMOVED_BLOCK])

		overrides_diff_report.report('HEAD')

		expect(vi.mocked(console.info)).toHaveBeenLastCalledWith(RESTORE_LINE)
	})
})

describe('overrides-diff-report — judge_overrides', () => {
	it('answers kept on keep, printing only on stderr', () => {
		expect(overrides_diff_report.judge_overrides('HEAD')).toBe(true)
		expect(vi.mocked(console.error)).toHaveBeenLastCalledWith(KEEP_LINE)
		expect(vi.mocked(console.info)).not.toHaveBeenCalled()
	})

	it('answers not kept on restore, after the moved entries', () => {
		vi.mocked(overrides_diff.changed_blocks).mockReturnValue([REMOVED_BLOCK])

		expect(overrides_diff_report.judge_overrides('HEAD')).toBe(false)
		expect(printed(console.error)).toContain(MOVED_HEADING)
		expect(vi.mocked(console.error)).toHaveBeenLastCalledWith(RESTORE_LINE)
	})

	it('answers not kept when the range resolves to no commit', () => {
		vi.mocked(overrides_diff.read_sources).mockReturnValue(undefined)

		expect(overrides_diff_report.judge_overrides('HEAD')).toBe(false)
		expect(vi.mocked(console.error)).toHaveBeenLastCalledWith(
			'overrides: not judged (no commit at HEAD)',
		)
	})
})
