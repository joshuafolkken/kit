import { beforeEach, describe, expect, it, vi } from 'vitest'

const DEFAULT_PACKAGE_JSON = '{"pnpm":{"overrides":{}}}'
const REACT_18_SNAPSHOT = '{"react":"^18.0.0"}'
const PROCESS_EXIT_CALLED = 'process.exit called'

const fs_mock = vi.hoisted(() => {
	const state: {
		package_json: string
		snapshot_content?: string
		snapshot_save_error?: Error
	} = {
		package_json: '',
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
