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
		expect(printed(console.error)).toContain('✖ pnpm-workspace.yaml overrides changed since HEAD:')
		expect(printed(console.info)).not.toContain('✔ overrides unchanged')
	})

	it('reports devEngines moved on a restore verdict', () => {
		vi.mocked(development_engines_verdict.describe).mockReturnValue(
			'devEngines: restore (integrity suffix missing)',
		)

		const verdict = overrides_diff_report.report('HEAD')

		expect(verdict).toStrictEqual({ is_overrides_moved: false, is_engines_moved: true })
	})

	it('answers undefined when the range resolves to no commit, printing nothing', () => {
		vi.mocked(overrides_diff.read_sources).mockReturnValue(undefined)

		expect(overrides_diff_report.report('no-such-ref')).toBeUndefined()
		expect(vi.mocked(console.info)).not.toHaveBeenCalled()
	})
})
