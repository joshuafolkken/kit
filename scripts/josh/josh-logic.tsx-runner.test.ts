import { beforeEach, describe, expect, it, vi } from 'vitest'

const execa_sync_mock = vi.hoisted(() => vi.fn())
const resolve_mock = vi.hoisted(() => vi.fn())
const exists_sync_mock = vi.hoisted(() => vi.fn())
const read_file_sync_mock = vi.hoisted(() => vi.fn())

vi.mock('execa', () => ({ execaSync: execa_sync_mock }))
vi.mock('node:fs', () => ({ existsSync: exists_sync_mock, readFileSync: read_file_sync_mock }))
vi.mock('node:module', () => ({ createRequire: () => ({ resolve: resolve_mock }) }))

const MANIFEST_PATH = '/pkg/node_modules/tsx/package.json'
const CLI_ENTRY = '/pkg/node_modules/tsx/dist/cli.mjs'
const KIT_VERSION_JSON = '{"version":"0.0.0"}'
const STRING_BIN_JSON = '{"bin":"./dist/cli.mjs"}'
const RECORD_BIN_JSON = '{"bin":{"tsx":"./dist/cli.mjs"}}'

function is_manifest(file_path: unknown): boolean {
	return String(file_path).endsWith(MANIFEST_PATH)
}

function mock_manifest(manifest_json: string): void {
	read_file_sync_mock.mockImplementation((file_path: unknown) =>
		is_manifest(file_path) ? manifest_json : KIT_VERSION_JSON,
	)
}

mock_manifest(STRING_BIN_JSON)
exists_sync_mock.mockReturnValue(false)
resolve_mock.mockReturnValue(MANIFEST_PATH)

const { resolve_tsx_runner } = await import('./josh-logic')

beforeEach(() => {
	mock_manifest(STRING_BIN_JSON)
	resolve_mock.mockReset().mockReturnValue(MANIFEST_PATH)
	exists_sync_mock
		.mockReset()
		.mockImplementation((file_path: unknown) => String(file_path).endsWith('cli.mjs'))
})

describe('resolve_tsx_runner — programmatic resolution', () => {
	it('runs the resolved tsx CLI entry with the current node binary', () => {
		expect(resolve_tsx_runner()).toStrictEqual({
			executable: process.execPath,
			leading_arguments: [CLI_ENTRY],
		})
	})

	it('supports the record form of the tsx bin field', () => {
		mock_manifest(RECORD_BIN_JSON)

		expect(resolve_tsx_runner().leading_arguments).toStrictEqual([CLI_ENTRY])
	})

	it('never consults the generated bin shim when resolution succeeds', () => {
		resolve_tsx_runner()

		expect(exists_sync_mock).not.toHaveBeenCalledWith(expect.stringContaining('.bin'))
	})
})

describe('resolve_tsx_runner — fallback to the bin shim', () => {
	it('falls back when tsx cannot be resolved from either manifest', () => {
		resolve_mock.mockImplementation(() => {
			throw new Error('Cannot find module')
		})
		exists_sync_mock.mockReturnValue(false)

		expect(resolve_tsx_runner()).toStrictEqual({ executable: 'tsx', leading_arguments: [] })
	})

	// Regression for #668: a stale pnpm shim pointed at a pruned store path. Resolution can
	// still succeed while the CLI file itself is gone, so the entry must be probed on disk.
	it('falls back when the resolved CLI entry no longer exists on disk', () => {
		exists_sync_mock.mockReturnValue(false)

		expect(resolve_tsx_runner()).toStrictEqual({ executable: 'tsx', leading_arguments: [] })
	})

	it('falls back when the tsx manifest declares no bin entry', () => {
		mock_manifest('{}')
		exists_sync_mock.mockReturnValue(false)

		expect(resolve_tsx_runner()).toStrictEqual({ executable: 'tsx', leading_arguments: [] })
	})
})
