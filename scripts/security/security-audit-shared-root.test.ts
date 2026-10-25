import { chmodSync, existsSync, mkdirSync, realpathSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { git_fixture_workspace, type FixtureWorkspace } from '#scripts/git/git-fixture-workspace'
import { stamp_file } from '#scripts/josh/stamp-file'
import { execaSync, type execa } from 'execa'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { security_audit } from './security-audit'
import { security_audit_logic } from './security-audit-logic'
import { security_audit_provision } from './security-audit-provision'

// Only the scanner probe is mocked: the fixture drives real git through `execa`, and what is asserted
// is where git says the primary checkout of a linked work tree is (joshuafolkken/kit#4942).
vi.mock('execa', async (import_original) => {
	const original = await import_original<{ execa: typeof execa }>()

	return { execa: original.execa, execaSync: vi.fn() }
})

const mocked_execa_sync = vi.mocked(execaSync)

type ExecaSyncResult = ReturnType<typeof execaSync>

const LINUX_PLATFORM = 'linux'
const X64_ARCHITECTURE = 'x64'
const ALREADY_PRESENT = 'already available'
const FLOOR_VERSION_OUTPUT = 'osv-scanner version: 2.6.0'
const PAYLOAD = 'a scanner the primary checkout already provisioned'
const EXECUTABLE_MODE = 0o755
const TIMEOUT_MS = 30_000

const fixture: FixtureWorkspace & { primary_root: string; lane_root: string } = {
	workspace: '',
	previous_cwd: '',
	restore_environment: undefined,
	primary_root: '',
	lane_root: '',
}

function fake_sync_result(exit_code: number | undefined, stdout = ''): ExecaSyncResult {
	const result = { exitCode: exit_code, stdout }

	return result as unknown as ExecaSyncResult
}

// No scanner on PATH; any file path spawned answers the floor version.
function mock_managed_scanner_only(): void {
	mocked_execa_sync.mockImplementation((target) =>
		String(target) === security_audit_logic.BINARY_NAME
			? fake_sync_result(undefined)
			: fake_sync_result(0, FLOOR_VERSION_OUTPUT),
	)
}

function managed_path_in(project_root: string): string {
	return security_audit_logic.build_managed_binary_path(project_root, LINUX_PLATFORM)
}

function write_executable(target_path: string): void {
	mkdirSync(path.dirname(target_path), { recursive: true })
	writeFileSync(target_path, PAYLOAD)
	chmodSync(target_path, EXECUTABLE_MODE)
}

function stub_offline_fetch(): ReturnType<typeof vi.fn> {
	const fetch_spy = vi.fn().mockRejectedValue(new Error('offline'))

	vi.stubGlobal('fetch', fetch_spy)

	return fetch_spy
}

// The workspace is resolved through its symlinks, because git names the primary checkout by its real
// path and macOS hands out a temp directory under the `/var` → `/private/var` link.
function open_fixture(): void {
	const opened = git_fixture_workspace.open_workspace('kit-audit-shared-root-')

	fixture.workspace = realpathSync(opened.workspace)
	fixture.previous_cwd = opened.previous_cwd
	fixture.restore_environment = opened.restore_environment
	fixture.primary_root = path.join(fixture.workspace, 'primary')
	fixture.lane_root = path.join(fixture.workspace, 'lane')
}

beforeEach(async () => {
	const { git, MAIN_BRANCH } = git_fixture_workspace

	open_fixture()
	await git(fixture.workspace, ['init', MAIN_BRANCH, 'primary'])
	await git(fixture.primary_root, ['commit', '--allow-empty', '-m', 'base'])
	await git(fixture.primary_root, ['worktree', 'add', '-b', 'lane', fixture.lane_root])
	vi.clearAllMocks()
	mock_managed_scanner_only()
}, TIMEOUT_MS)

afterEach(async () => {
	vi.unstubAllGlobals()
	await git_fixture_workspace.close_workspace(fixture)
})

describe('security_audit.managed_binary_path', () => {
	it('names the primary checkout managed path from a linked work tree', () => {
		expect(security_audit.managed_binary_path(fixture.lane_root, LINUX_PLATFORM)).toBe(
			managed_path_in(fixture.primary_root),
		)
	})

	it('names its own managed path from the primary checkout', () => {
		expect(security_audit.managed_binary_path(fixture.primary_root, LINUX_PLATFORM)).toBe(
			managed_path_in(fixture.primary_root),
		)
	})

	it('names its own managed path in a work tree of a bare repository', async () => {
		const { git } = git_fixture_workspace
		const bare_root = path.join(fixture.workspace, 'bare.git')
		const bare_lane = path.join(fixture.workspace, 'bare-lane')

		await git(fixture.workspace, ['init', '--bare', bare_root])
		await git(bare_root, ['worktree', 'add', '--orphan', '-b', 'bare-lane', bare_lane])

		expect(security_audit.managed_binary_path(bare_lane, LINUX_PLATFORM)).toBe(
			managed_path_in(bare_lane),
		)
	})

	it('names its own managed path outside any repository', () => {
		const outside = path.join(fixture.workspace, 'outside')

		mkdirSync(outside)

		expect(security_audit.managed_binary_path(outside, LINUX_PLATFORM)).toBe(
			managed_path_in(outside),
		)
	})
})

describe('a lane work tree reuses the primary checkout scanner', () => {
	it('does not download when the primary checkout already provisioned one', async () => {
		write_executable(managed_path_in(fixture.primary_root))
		const fetch_spy = stub_offline_fetch()
		const message = await security_audit_provision.report(
			fixture.lane_root,
			LINUX_PLATFORM,
			X64_ARCHITECTURE,
			true,
		)

		expect(message).toContain(ALREADY_PRESENT)
		expect(message).toContain(managed_path_in(fixture.primary_root))
		expect(fetch_spy).not.toHaveBeenCalled()
	})

	it('audits with the primary checkout binary', () => {
		write_executable(managed_path_in(fixture.primary_root))

		expect(security_audit.resolve_scanner(fixture.lane_root, LINUX_PLATFORM)).toStrictEqual({
			path: managed_path_in(fixture.primary_root),
			is_below_floor: false,
		})
	})

	it('records a failed download where every work tree reads it', async () => {
		stub_offline_fetch()
		await security_audit_provision.report(fixture.lane_root, LINUX_PLATFORM, X64_ARCHITECTURE, true)
		const shared_stamp = stamp_file.stamp_path(
			'josh-audit-provision-',
			managed_path_in(fixture.primary_root),
		)

		expect(existsSync(shared_stamp)).toBe(true)
		stamp_file.remove_stamp(shared_stamp)
	})
})
