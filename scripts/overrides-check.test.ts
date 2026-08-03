import { beforeEach, describe, expect, it, vi } from 'vitest'

const DEFAULT_PACKAGE_JSON = '{"pnpm":{"overrides":{}}}'
const REACT_18_SNAPSHOT = '{"react":"^18.0.0"}'
const PROCESS_EXIT_CALLED = 'process.exit called'
const SVELTE_SNAPSHOT = '{"svelte":"^5.55.7"}'
const PACKAGE_JSON_WITHOUT_PNPM = '{"name":"app-kit"}'
const WORKSPACE_YAML_WITH_SVELTE = 'overrides:\n  svelte: ^5.55.7\n'

const fs_mock = vi.hoisted(() => {
	const state: {
		package_json: string
		workspace_yaml: string
		snapshot_content?: string
		snapshot_save_error?: Error
	} = {
		package_json: '',
		workspace_yaml: '',
	}

	function read_snapshot_content(): string {
		if (state.snapshot_save_error !== undefined) throw state.snapshot_save_error

		if (state.snapshot_content === undefined) {
			throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
		}

		return state.snapshot_content
	}

	function mock_read_file_sync(path_argument: string): string {
		if (path_argument.includes('overrides-snapshot')) return read_snapshot_content()
		if (path_argument === 'pnpm-workspace.yaml') return state.workspace_yaml

		return state.package_json
	}

	return { state, mock_read_file_sync }
})

vi.mock('node:fs', () => ({
	readFileSync: fs_mock.mock_read_file_sync,
	writeFileSync: vi.fn(),
}))

const { run_overrides_check } = await import('./overrides-check')

beforeEach(() => {
	vi.spyOn(process, 'exit').mockImplementation(() => {
		throw new Error(PROCESS_EXIT_CALLED)
	})
	vi.spyOn(console, 'error').mockImplementation(vi.fn())
	vi.spyOn(console, 'info').mockImplementation(vi.fn())
	delete fs_mock.state.snapshot_content
	delete fs_mock.state.snapshot_save_error
	fs_mock.state.package_json = DEFAULT_PACKAGE_JSON
	fs_mock.state.workspace_yaml = ''
})

describe('overrides-check — snapshot not found (ENOENT)', () => {
	it('throws when snapshot file does not exist', () => {
		expect(() => {
			run_overrides_check(false)
		}).toThrow()
	})
})

describe('overrides-check — invalid snapshot JSON', () => {
	it('throws when snapshot file contains invalid JSON', () => {
		fs_mock.state.snapshot_content = 'not valid json'

		expect(() => {
			run_overrides_check(false)
		}).toThrow()
	})
})

describe('overrides-check — valid snapshot matches current', () => {
	it('does not call process.exit when overrides match snapshot', () => {
		fs_mock.state.snapshot_content = REACT_18_SNAPSHOT
		fs_mock.state.package_json = '{"pnpm":{"overrides":{"react":"^18.0.0"}}}'

		expect(() => {
			run_overrides_check(false)
		}).not.toThrow()
	})
})

describe('overrides-check — snapshot differs from current', () => {
	it('calls process.exit(1) when overrides do not match snapshot', () => {
		fs_mock.state.snapshot_content = REACT_18_SNAPSHOT
		fs_mock.state.package_json = '{"pnpm":{"overrides":{"react":"^19.0.0"}}}'

		expect(() => {
			run_overrides_check(false)
		}).toThrow(PROCESS_EXIT_CALLED)
	})
})

// kit #740: the check read package.json only, so a project whose overrides live in
// pnpm-workspace.yaml — kit and app-kit both do — reported "unchanged" against an empty record.
describe('overrides-check — overrides declared in pnpm-workspace.yaml', () => {
	// The exact false all-clear: kit's own snapshot held `{}` because the reader only ever saw
	// package.json, so a workspace override that was never snapshotted still reported "unchanged".
	it('reports a workspace override missing from an empty snapshot as a change', () => {
		fs_mock.state.snapshot_content = '{}'
		fs_mock.state.package_json = PACKAGE_JSON_WITHOUT_PNPM
		fs_mock.state.workspace_yaml = WORKSPACE_YAML_WITH_SVELTE

		expect(() => {
			run_overrides_check(false)
		}).toThrow(PROCESS_EXIT_CALLED)
	})

	it('detects a removed workspace override even when package.json has no pnpm field', () => {
		fs_mock.state.snapshot_content = SVELTE_SNAPSHOT
		fs_mock.state.package_json = PACKAGE_JSON_WITHOUT_PNPM
		fs_mock.state.workspace_yaml = 'allowBuilds:\n  esbuild: true\n'

		expect(() => {
			run_overrides_check(false)
		}).toThrow(PROCESS_EXIT_CALLED)
	})

	it('passes when the workspace override is intact', () => {
		fs_mock.state.snapshot_content = SVELTE_SNAPSHOT
		fs_mock.state.package_json = PACKAGE_JSON_WITHOUT_PNPM
		fs_mock.state.workspace_yaml = WORKSPACE_YAML_WITH_SVELTE

		expect(() => {
			run_overrides_check(false)
		}).not.toThrow()
	})

	it('names the file the overrides were read from', () => {
		fs_mock.state.snapshot_content = SVELTE_SNAPSHOT
		fs_mock.state.package_json = PACKAGE_JSON_WITHOUT_PNPM
		fs_mock.state.workspace_yaml = WORKSPACE_YAML_WITH_SVELTE
		run_overrides_check(false)

		expect(console.info).toHaveBeenCalledWith(expect.stringContaining('1 from pnpm-workspace.yaml'))
	})
})
