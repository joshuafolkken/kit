import { beforeEach, describe, expect, it, vi } from 'vitest'

const WORKSPACE_YAML = 'overrides:\n  svelte: ^5.55.7\n'
const PACKAGE_JSON_WITHOUT_PNPM = '{"name":"app-kit"}'
const PACKAGE_JSON_PATH = 'package.json'
const WORKSPACE_YAML_PATH = 'pnpm-workspace.yaml'

// Filenames are not valid identifiers, so the fixture is built from entries rather than an object
// literal whose keys the naming-convention rule would reject.
function make_files(entries: Array<[string, string]>): Record<string, string> {
	return Object.fromEntries(entries)
}

const fs_mock = vi.hoisted(() => {
	const state: { files: Record<string, string> } = { files: {} }

	function mock_read_file_sync(path_argument: string): string {
		const content = state.files[path_argument]
		if (content === undefined) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })

		return content
	}

	return { state, mock_read_file_sync }
})

vi.mock('node:fs', () => ({ readFileSync: fs_mock.mock_read_file_sync }))

const { overrides_files } = await import('./overrides-files')

beforeEach(() => {
	fs_mock.state.files = {}
})

describe('overrides_files.read_current_overrides', () => {
	it('reads overrides from pnpm-workspace.yaml when package.json has no pnpm field', () => {
		fs_mock.state.files = make_files([
			[PACKAGE_JSON_PATH, PACKAGE_JSON_WITHOUT_PNPM],
			[WORKSPACE_YAML_PATH, WORKSPACE_YAML],
		])

		expect(overrides_files.read_current_overrides()).toStrictEqual({ svelte: '^5.55.7' })
	})

	it('falls back to package.json when pnpm-workspace.yaml is absent', () => {
		fs_mock.state.files = make_files([
			[PACKAGE_JSON_PATH, '{"pnpm":{"overrides":{"react":"^18.0.0"}}}'],
		])

		expect(overrides_files.read_current_overrides()).toStrictEqual({ react: '^18.0.0' })
	})

	it('returns an empty record when neither file exists', () => {
		expect(overrides_files.read_current_overrides()).toStrictEqual({})
	})
})

describe('overrides_files.read_current_sources', () => {
	it('reports an absent file as empty content', () => {
		fs_mock.state.files = make_files([[WORKSPACE_YAML_PATH, WORKSPACE_YAML]])

		expect(overrides_files.read_current_sources()).toStrictEqual({
			package_json: '',
			workspace_yaml: WORKSPACE_YAML,
		})
	})
})
