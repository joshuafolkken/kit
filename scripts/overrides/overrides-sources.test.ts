import { describe, expect, it } from 'vitest'
import { overrides_check, type OverridesSources } from './overrides-logic'

// kit #740: the protection check read `pnpm.overrides` in package.json only, so a project whose
// overrides live in pnpm-workspace.yaml — kit and app-kit both do — passed on an empty record.

const WORKSPACE_YAML = `allowBuilds:
  esbuild: true

overrides:
  svelte: ^5.55.7
  devalue: ^5.8.1
`
const PACKAGE_JSON_WITH_OVERRIDES = '{"pnpm":{"overrides":{"react":"^18.0.0"}}}'
const PACKAGE_JSON_WITHOUT_PNPM = '{"name":"app-kit"}'

function make_sources(package_json: string, workspace_yaml: string): OverridesSources {
	return { package_json, workspace_yaml }
}

describe('overrides_check.read_overrides_from_workspace', () => {
	it('reads the overrides block from pnpm-workspace.yaml', () => {
		expect(overrides_check.read_overrides_from_workspace(WORKSPACE_YAML)).toStrictEqual({
			svelte: '^5.55.7',
			devalue: '^5.8.1',
		})
	})

	it('returns an empty record when the file has no overrides block', () => {
		expect(
			overrides_check.read_overrides_from_workspace('allowBuilds:\n  esbuild: true\n'),
		).toStrictEqual({})
	})

	it('returns an empty record for an absent file', () => {
		expect(overrides_check.read_overrides_from_workspace('')).toStrictEqual({})
	})
})

describe('overrides_check.read_overrides — both locations', () => {
	it('finds workspace overrides when package.json has no pnpm field', () => {
		const sources = make_sources(PACKAGE_JSON_WITHOUT_PNPM, WORKSPACE_YAML)

		expect(Object.keys(overrides_check.read_overrides(sources))).toHaveLength(2)
	})

	it('merges entries from both files', () => {
		const sources = make_sources(PACKAGE_JSON_WITH_OVERRIDES, WORKSPACE_YAML)

		expect(overrides_check.read_overrides(sources)).toStrictEqual({
			react: '^18.0.0',
			svelte: '^5.55.7',
			devalue: '^5.8.1',
		})
	})

	it('lets the workspace entry win a key collision', () => {
		const sources = make_sources('{"pnpm":{"overrides":{"svelte":"^4"}}}', WORKSPACE_YAML)

		expect(overrides_check.read_overrides(sources)).toStrictEqual({
			svelte: '^5.55.7',
			devalue: '^5.8.1',
		})
	})

	it('returns an empty record when neither file declares overrides', () => {
		expect(
			overrides_check.read_overrides(make_sources(PACKAGE_JSON_WITHOUT_PNPM, '')),
		).toStrictEqual({})
	})

	it('tolerates an absent package.json', () => {
		const overrides = overrides_check.read_overrides(make_sources('', WORKSPACE_YAML))

		expect(Object.keys(overrides)).toHaveLength(2)
	})
})

describe('overrides_check.describe_sources', () => {
	it('names pnpm-workspace.yaml when the overrides live there', () => {
		const summary = overrides_check.describe_sources(
			make_sources(PACKAGE_JSON_WITHOUT_PNPM, WORKSPACE_YAML),
		)

		expect(summary).toBe('2 from pnpm-workspace.yaml')
	})

	it('lists both files when both contribute', () => {
		const summary = overrides_check.describe_sources(
			make_sources(PACKAGE_JSON_WITH_OVERRIDES, WORKSPACE_YAML),
		)

		expect(summary).toBe('2 from pnpm-workspace.yaml, 1 from package.json')
	})

	it('names both files it read when nothing was found', () => {
		const summary = overrides_check.describe_sources(make_sources(PACKAGE_JSON_WITHOUT_PNPM, ''))

		expect(summary).toBe('no overrides found in pnpm-workspace.yaml or package.json')
	})
})

describe('overrides_check.format_diff_lines', () => {
	it('renders one line per added, removed and modified entry', () => {
		const diff = overrides_check.compare({ a: '1', b: '2' }, { a: '9', c: '3' })

		expect(overrides_check.format_diff_lines(diff)).toStrictEqual([
			'  + added:   c → 3',
			'  - removed: b (was 2)',
			'  ~ changed: a: 1 → 9',
		])
	})

	it('renders nothing for an unchanged diff', () => {
		expect(overrides_check.format_diff_lines(overrides_check.compare({}, {}))).toStrictEqual([])
	})
})
