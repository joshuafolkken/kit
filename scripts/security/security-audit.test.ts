import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { COMMAND_MAP } from '#scripts/josh/josh-logic'
import { execaSync } from 'execa'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { security_audit } from './security-audit'
import { security_audit_logic } from './security-audit-logic'

vi.mock('execa', () => ({ execaSync: vi.fn() }))

const mocked_execa_sync = vi.mocked(execaSync)

type ExecaSyncResult = ReturnType<typeof execaSync>

function fake_sync_result(exit_code: number | undefined, stdout = ''): ExecaSyncResult {
	const result = { exitCode: exit_code, stdout }

	return result as unknown as ExecaSyncResult
}

const FLOOR_VERSION_OUTPUT = 'osv-scanner version: 2.6.0'
const BELOW_FLOOR_VERSION_OUTPUT = 'osv-scanner version: 2.3.5'

beforeEach(() => {
	vi.clearAllMocks()
})

const OSV_SCANNER = 'osv-scanner'
const MISSING_BINARY = 'missing-bin'
const PNPM_LOCKFILE = 'pnpm-lock.yaml'
const MANAGED_SCANNER_PATH = '/managed/osv-scanner'
const EXECUTABLE_MODE = 0o755
const READABLE_MODE = 0o644
const RETIRED_AUDIT = 'pnpm audit'
const RETIRED_AUDIT_RUN = `run: ${RETIRED_AUDIT}`
const RETIRED_AUDIT_FRAGMENT = `${RETIRED_AUDIT} `

function load_file(relative_path: string): string {
	return readFileSync(path.resolve(process.cwd(), relative_path), 'utf8')
}

describe('security_audit.is_binary_available', () => {
	it('returns true when the binary spawns (exitCode is a number)', () => {
		mocked_execa_sync.mockReturnValue(fake_sync_result(0))

		expect(security_audit.is_binary_available(OSV_SCANNER)).toBe(true)
	})

	it('returns true even when --version exits non-zero (binary still exists)', () => {
		mocked_execa_sync.mockReturnValue(fake_sync_result(1))

		expect(security_audit.is_binary_available(OSV_SCANNER)).toBe(true)
	})

	it('returns false when the binary cannot be spawned (exitCode undefined)', () => {
		mocked_execa_sync.mockReturnValue(fake_sync_result(undefined))

		expect(security_audit.is_binary_available(MISSING_BINARY)).toBe(false)
	})
})

describe('security_audit.run_scanner', () => {
	it('returns the scanner exit code', () => {
		mocked_execa_sync.mockReturnValue(fake_sync_result(0))

		expect(security_audit.run_scanner(OSV_SCANNER)).toBe(0)
	})

	it('falls back to the failure code when exitCode is undefined', () => {
		mocked_execa_sync.mockReturnValue(fake_sync_result(undefined))

		expect(security_audit.run_scanner(OSV_SCANNER)).toBe(1)
	})

	it('spawns the path it was handed rather than the bare binary name', () => {
		mocked_execa_sync.mockReturnValue(fake_sync_result(0))
		security_audit.run_scanner(MANAGED_SCANNER_PATH)

		expect(mocked_execa_sync).toHaveBeenCalledWith(
			MANAGED_SCANNER_PATH,
			[`--lockfile=${PNPM_LOCKFILE}`],
			expect.anything(),
		)
	})
})

function fresh_scratch(): string {
	return mkdtempSync(path.join(tmpdir(), 'kit-audit-resolve-'))
}

function write_managed(scratch: string): string {
	const managed_path = security_audit_logic.build_managed_binary_path(scratch, 'linux')

	mkdirSync(path.dirname(managed_path), { recursive: true })
	writeFileSync(managed_path, 'stub')
	chmodSync(managed_path, EXECUTABLE_MODE)

	return managed_path
}

// The first arg is the binary name or path being spawned, so a mock can answer PATH and the managed
// copy differently — the whole point of the floor is that the two are no longer interchangeable.
function mock_versions(by_target: Record<string, ExecaSyncResult>): void {
	mocked_execa_sync.mockImplementation(
		(target) => by_target[String(target)] ?? fake_sync_result(undefined),
	)
}

// joshuafolkken/kit#2200: PATH is preferred only when its scanner meets the floor. A below-floor PATH
// build reads a fraction of the lockfile and calls it clean, so a floor-meeting provisioned copy is
// preferred over it — reversing joshuafolkken/kit#1563's unconditional PATH preference.
describe('security_audit.resolve_scanner', () => {
	it('prefers the PATH binary when it meets the floor', () => {
		const scratch = fresh_scratch()

		mock_versions({ [OSV_SCANNER]: fake_sync_result(0, FLOOR_VERSION_OUTPUT) })

		expect(security_audit.resolve_scanner(scratch, 'linux')).toEqual({
			path: OSV_SCANNER,
			is_below_floor: false,
		})
	})

	it('returns undefined when neither PATH nor the provisioned directory has one', () => {
		mocked_execa_sync.mockReturnValue(fake_sync_result(undefined))

		expect(security_audit.resolve_scanner(fresh_scratch(), 'linux')).toBeUndefined()
	})

	it('falls back to the provisioned copy when PATH has none', () => {
		const scratch = fresh_scratch()
		const managed_path = write_managed(scratch)

		mock_versions({ [managed_path]: fake_sync_result(0, FLOOR_VERSION_OUTPUT) })

		expect(security_audit.resolve_scanner(scratch, 'linux')).toEqual({
			path: managed_path,
			is_below_floor: false,
		})
	})
})

describe('security_audit.resolve_scanner — floor preference', () => {
	it('prefers a floor-meeting provisioned copy over a below-floor PATH binary', () => {
		const scratch = fresh_scratch()
		const managed_path = write_managed(scratch)

		mock_versions({
			[OSV_SCANNER]: fake_sync_result(0, BELOW_FLOOR_VERSION_OUTPUT),
			[managed_path]: fake_sync_result(0, FLOOR_VERSION_OUTPUT),
		})

		expect(security_audit.resolve_scanner(scratch, 'linux')).toEqual({
			path: managed_path,
			is_below_floor: false,
		})
	})

	it('returns a below-floor PATH binary flagged when nothing else is available', () => {
		mocked_execa_sync.mockReturnValue(fake_sync_result(0, BELOW_FLOOR_VERSION_OUTPUT))

		expect(security_audit.resolve_scanner(fresh_scratch(), 'linux')).toEqual({
			path: OSV_SCANNER,
			is_below_floor: true,
		})
	})
})

describe('security_audit.meets_floor', () => {
	it('is true for a binary reporting a version at or above the floor', () => {
		mocked_execa_sync.mockReturnValue(fake_sync_result(0, FLOOR_VERSION_OUTPUT))

		expect(security_audit.meets_floor(OSV_SCANNER)).toBe(true)
	})

	it('is false for a binary reporting a version below the floor', () => {
		mocked_execa_sync.mockReturnValue(fake_sync_result(0, BELOW_FLOOR_VERSION_OUTPUT))

		expect(security_audit.meets_floor(OSV_SCANNER)).toBe(false)
	})

	it('is false when the binary cannot be spawned', () => {
		mocked_execa_sync.mockReturnValue(fake_sync_result(undefined))

		expect(security_audit.meets_floor(MISSING_BINARY)).toBe(false)
	})
})

// Existence is not enough: an interrupted install leaves a zero-byte file, and a `chmod` refused by
// a restrictive mount leaves a non-executable one. Spawning either fails with EACCES or ENOEXEC —
// an error naming neither the scanner nor how to get one — so neither counts as a provisioned copy.
describe('security_audit.is_executable_file', () => {
	const scratch = mkdtempSync(path.join(tmpdir(), 'kit-audit-exec-'))

	afterAll(() => {
		rmSync(scratch, { recursive: true, force: true })
	})

	function write_candidate(name: string, content: string, mode: number): string {
		const candidate_path = path.join(scratch, name)

		writeFileSync(candidate_path, content)
		chmodSync(candidate_path, mode)

		return candidate_path
	}

	it('accepts a non-empty file with the execute bit set', () => {
		expect(security_audit.is_executable_file(write_candidate('ok', 'stub', EXECUTABLE_MODE))).toBe(
			true,
		)
	})

	it('rejects a zero-byte leftover even with the execute bit set', () => {
		expect(security_audit.is_executable_file(write_candidate('empty', '', EXECUTABLE_MODE))).toBe(
			false,
		)
	})

	it('rejects a file whose execute bit never landed', () => {
		expect(security_audit.is_executable_file(write_candidate('plain', 'stub', READABLE_MODE))).toBe(
			false,
		)
	})

	it('rejects a path with nothing at it', () => {
		expect(security_audit.is_executable_file(path.join(scratch, 'absent'))).toBe(false)
	})

	// A traversable directory satisfies both other clauses — X_OK succeeds and its reported size is
	// never zero — so it would pass as a provisioned scanner and be spawned.
	it('rejects a directory sitting where the binary should be', () => {
		const directory_path = path.join(scratch, 'directory')

		mkdirSync(directory_path, { recursive: true })

		expect(security_audit.is_executable_file(directory_path)).toBe(false)
	})
})

describe('security_audit_logic.build_managed_binary_path', () => {
	// Spelled out here rather than read from the module: this is the assertion that the provisioned
	// directory sits inside `node_modules`, which is the whole reason no `.gitignore` entry is
	// distributed for it — a test that asked the module for the segments could not fail on a move.
	const managed_directory = ['/repo', 'node_modules', '.cache', 'josh-tools']

	it('places the scanner under the node_modules cache the project already ignores', () => {
		expect(security_audit_logic.build_managed_binary_path('/repo', 'darwin')).toBe(
			path.join(...managed_directory, OSV_SCANNER),
		)
	})

	it('adds the .exe suffix on Windows so the written file is executable there', () => {
		expect(security_audit_logic.build_managed_binary_path('/repo', 'win32')).toBe(
			path.join(...managed_directory, `${OSV_SCANNER}.exe`),
		)
	})
})

describe('security_audit_logic constants', () => {
	it('targets the osv-scanner binary', () => {
		expect(security_audit_logic.BINARY_NAME).toBe(OSV_SCANNER)
	})

	it('targets the pnpm lockfile at repo root', () => {
		expect(security_audit_logic.LOCKFILE_PATH).toBe(PNPM_LOCKFILE)
	})
})

describe('security_audit_logic.build_scanner_arguments', () => {
	it('returns --lockfile with the given path', () => {
		expect(security_audit_logic.build_scanner_arguments(PNPM_LOCKFILE)).toEqual([
			`--lockfile=${PNPM_LOCKFILE}`,
		])
	})

	it('preserves custom lockfile paths unchanged', () => {
		expect(security_audit_logic.build_scanner_arguments('app/pnpm-lock.yaml')).toEqual([
			'--lockfile=app/pnpm-lock.yaml',
		])
	})
})

describe('security_audit_logic.format_missing_binary_error', () => {
	const message = security_audit_logic.format_missing_binary_error(OSV_SCANNER)

	it('names the missing binary', () => {
		expect(message).toContain(`${OSV_SCANNER} is not installed`)
	})

	it('includes the brew install instruction', () => {
		expect(message).toContain('brew install osv-scanner')
	})

	it('includes the go install instruction', () => {
		expect(message).toContain('go install github.com/google/osv-scanner')
	})

	it('includes the Docker fallback', () => {
		expect(message).toContain('docker run')
	})

	it('links to the osv-scanner docs', () => {
		expect(message).toContain('https://google.github.io/osv-scanner/')
	})
})

describe('josh latest command audit wiring', () => {
	const manifest = JSON.parse(load_file('package.json')) as { scripts?: Record<string, string> }
	const latest_command = (COMMAND_MAP['latest']?.shell ?? []).join(' ')

	it('does not register audit:security or latest as standalone package.json scripts', () => {
		expect(manifest.scripts?.['audit:security']).toBeUndefined()
		expect(manifest.scripts?.['latest']).toBeUndefined()
	})

	it('delegates security audit to josh audit in the COMMAND_MAP latest shell', () => {
		expect(latest_command).toContain('josh audit')
	})

	it('invokes the audit via pnpm josh so it does not depend on a global josh install', () => {
		// A bare `josh audit` fails with "command not found" when the global CLI
		// is not installed (fresh checkout / CI); the chain must use `pnpm josh`.
		expect(latest_command).toContain('pnpm josh audit')
		expect(latest_command).not.toMatch(/&&\s*josh audit/u)
	})

	it('no longer calls the retired pnpm audit command', () => {
		expect(latest_command.trimEnd().endsWith(RETIRED_AUDIT)).toBe(false)
		expect(latest_command).not.toContain(RETIRED_AUDIT_FRAGMENT)
	})
})

describe('lefthook/base.yml pre-commit audit wiring', () => {
	const content = load_file('lefthook/base.yml')
	const lines = content.split('\n').map((line) => line.trim())

	it('runs security audit via pnpm josh on pre-commit', () => {
		expect(content).toContain('run: pnpm josh audit')
	})

	it('does not call the retired pnpm audit command from the pre-commit hook', () => {
		expect(lines).not.toContain(RETIRED_AUDIT_RUN)
	})
})

describe('.github/workflows/ci.yml audit wiring', () => {
	const content = load_file('.github/workflows/ci.yml')
	const lines = content.split('\n').map((line) => line.trim())

	it('runs osv-scanner against the pnpm lockfile via the official GitHub Action', () => {
		expect(content).toContain('uses: google/osv-scanner-action/osv-scanner-action')
		expect(content).toContain(`scan-args: --lockfile=${PNPM_LOCKFILE}`)
	})

	it('does not call the retired pnpm audit command from CI', () => {
		expect(lines).not.toContain('run: pnpm audit --audit-level low')
		expect(lines).not.toContain(RETIRED_AUDIT_RUN)
	})
})
