import {
	accessSync,
	chmodSync,
	constants,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	rmSync,
	writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { stamp_file } from '#scripts/josh/stamp-file'
import { execaSync } from 'execa'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { security_audit_logic } from './security-audit-logic'
import { security_audit_provision } from './security-audit-provision'
import type { ScannerAsset } from './security-audit-provision-logic'

vi.mock('execa', () => ({ execaSync: vi.fn() }))

const mocked_execa_sync = vi.mocked(execaSync)

type ExecaSyncResult = ReturnType<typeof execaSync>

const LINUX_PLATFORM = 'linux'
const X64_ARCHITECTURE = 'x64'
const PAYLOAD = 'not really a scanner, but it hashes like one'
const ASSET_NAME = 'osv-scanner_linux_amd64'
const ASSET_URL = `https://example.test/${ASSET_NAME}`
const ALREADY_PRESENT = 'already available'
const WRONG_CHECKSUM = 'deadbeef'
const EXECUTABLE_MODE = 0o755

const scratch = mkdtempSync(path.join(tmpdir(), 'kit-audit-provision-'))

function fake_sync_result(exit_code: number | undefined): ExecaSyncResult {
	const result = { exitCode: exit_code }

	return result as unknown as ExecaSyncResult
}

function sha256_of(content: string): string {
	return stamp_file.digest(Buffer.from(content))
}

function asset_with(sha256: string): ScannerAsset {
	return { name: ASSET_NAME, sha256, url: ASSET_URL }
}

// `Buffer.from(string)` allocates out of a shared pool, so handing back its `.buffer` would hand
// back the whole pool. Slicing at the view's own bounds is what makes the stub return the bytes.
function to_array_buffer(body: string): ArrayBuffer {
	const bytes = Buffer.from(body)

	return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
}

function stub_response(is_ok: boolean, body: string): void {
	const response = {
		ok: is_ok,
		arrayBuffer: async (): Promise<ArrayBuffer> => to_array_buffer(body),
	}

	vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response))
}

function target_in(directory_name: string): string {
	return path.join(scratch, directory_name, security_audit_logic.BINARY_NAME)
}

function write_executable(target_path: string, content: string): void {
	mkdirSync(path.dirname(target_path), { recursive: true })
	writeFileSync(target_path, content)
	chmodSync(target_path, EXECUTABLE_MODE)
}

async function provision_with(target_path: string, sha256: string): Promise<string> {
	const outcome = await security_audit_provision.provision(target_path, asset_with(sha256))

	return outcome.message
}

function managed_path_in(project_root: string): string {
	return security_audit_logic.build_managed_binary_path(project_root, LINUX_PLATFORM)
}

// `--force` throughout, so no test is answered by a backoff record another test wrote.
async function report_in(
	project_root: string,
	platform: string,
	architecture: string,
): Promise<string> {
	return await security_audit_provision.report(project_root, platform, architecture, true)
}

function arm_offline_fetch(): ReturnType<typeof vi.fn> {
	const fetch_spy = vi.fn().mockRejectedValue(new Error('offline'))

	mocked_execa_sync.mockReturnValue(fake_sync_result(undefined))
	vi.stubGlobal('fetch', fetch_spy)

	return fetch_spy
}

// One failed attempt, which writes the backoff record, then one that installs — the sequence the
// record has to survive the first of and not the second.
async function fail_then_succeed(target_path: string): Promise<void> {
	const asset = asset_with(sha256_of(PAYLOAD))

	arm_offline_fetch()
	await security_audit_provision.attempt(target_path, asset)
	stub_response(true, PAYLOAD)
	await security_audit_provision.attempt(target_path, asset)
}

beforeEach(() => {
	vi.clearAllMocks()
})

afterEach(() => {
	vi.unstubAllGlobals()
})

afterAll(() => {
	rmSync(scratch, { recursive: true, force: true })
})

describe('security_audit_provision.provision — a download that verifies', () => {
	it('installs the binary when the download matches the pinned checksum', async () => {
		const target_path = target_in('installs')

		stub_response(true, PAYLOAD)

		expect(await provision_with(target_path, sha256_of(PAYLOAD))).toContain(target_path)
		expect(existsSync(target_path)).toBe(true)
	})

	// The pre-push audit spawns whatever it finds at this path, so a file written without the bit set
	// would fail as a permission error rather than as the missing binary the message describes.
	it('makes the installed binary executable', async () => {
		const target_path = target_in('executable')

		stub_response(true, PAYLOAD)
		await provision_with(target_path, sha256_of(PAYLOAD))

		expect(() => {
			accessSync(target_path, constants.X_OK)
		}).not.toThrow()
	})

	// The staging file is renamed onto the target, so none of it may survive the install — and the
	// name itself is pinned by `build_staging_path`'s own tests rather than by its absence here.
	it('leaves no staging file beside the installed binary', async () => {
		const target_path = target_in('staging-name')

		stub_response(true, PAYLOAD)
		await provision_with(target_path, sha256_of(PAYLOAD))

		expect(readdirSync(path.dirname(target_path))).toEqual([security_audit_logic.BINARY_NAME])
	})
})

describe('security_audit_provision.provision — a download that does not', () => {
	it('installs nothing when the checksum does not match', async () => {
		const target_path = target_in('mismatch')

		stub_response(true, PAYLOAD)

		expect(await provision_with(target_path, WRONG_CHECKSUM)).toContain('Checksum mismatch')
		expect(existsSync(target_path)).toBe(false)
	})

	it('reports both digests so the mismatch can be compared with the published sums', async () => {
		stub_response(true, PAYLOAD)
		const message = await provision_with(target_in('mismatch-digests'), WRONG_CHECKSUM)

		expect(message).toContain(sha256_of(PAYLOAD))
	})

	it('names the HTTP status when the response is not OK', async () => {
		const target_path = target_in('not-ok')

		stub_response(false, '')
		const message = await provision_with(target_path, sha256_of(''))

		expect(message).toContain(ASSET_URL)
		expect(existsSync(target_path)).toBe(false)
	})
})

describe('security_audit_provision.report', () => {
	it('does nothing when the scanner is already on PATH', async () => {
		mocked_execa_sync.mockReturnValue(fake_sync_result(0))
		const fetch_spy = vi.fn()

		vi.stubGlobal('fetch', fetch_spy)
		const message = await report_in(scratch, LINUX_PLATFORM, X64_ARCHITECTURE)

		expect(message).toContain(ALREADY_PRESENT)
		expect(fetch_spy).not.toHaveBeenCalled()
	})

	it('does nothing when a previous session already provisioned one', async () => {
		const project_root = path.join(scratch, 'already-provisioned')

		mocked_execa_sync.mockReturnValue(fake_sync_result(undefined))
		write_executable(managed_path_in(project_root), PAYLOAD)
		const fetch_spy = vi.fn()

		vi.stubGlobal('fetch', fetch_spy)

		expect(await report_in(project_root, LINUX_PLATFORM, X64_ARCHITECTURE)).toContain(
			ALREADY_PRESENT,
		)
		expect(fetch_spy).not.toHaveBeenCalled()
	})

	// An interrupted install leaves exactly this, and read as a provisioned scanner it makes the audit
	// fail with ENOEXEC for ever while the provisioner reports there is nothing left to do.
	it('does not mistake an empty leftover file for a provisioned scanner', async () => {
		const project_root = path.join(scratch, 'empty-leftover')
		const managed_path = managed_path_in(project_root)

		mocked_execa_sync.mockReturnValue(fake_sync_result(undefined))
		mkdirSync(path.dirname(managed_path), { recursive: true })
		writeFileSync(managed_path, '')
		stub_response(true, PAYLOAD)

		expect(await report_in(project_root, LINUX_PLATFORM, X64_ARCHITECTURE)).not.toContain(
			ALREADY_PRESENT,
		)
	})
})

describe('security_audit_provision.attempt — recovery after a failure', () => {
	// `pnpm install` wipes `node_modules/.cache`, and this design accepts that as costing one
	// re-fetch. A record left behind by a failure that has since been resolved would answer that
	// re-fetch with "run --force" for as long as the backoff runs, which is not one re-fetch.
	it('stops backing off once a provision has succeeded', async () => {
		const project_root = path.join(scratch, 'recovered')
		const target_path = managed_path_in(project_root)

		await fail_then_succeed(target_path)
		rmSync(target_path)
		const fetch_spy = arm_offline_fetch()

		await security_audit_provision.report(project_root, LINUX_PLATFORM, X64_ARCHITECTURE, false)

		expect(fetch_spy).toHaveBeenCalled()
	})
})

describe('security_audit_provision.report — no build to fetch', () => {
	it('reports the host instead of guessing a URL when no build is published for it', async () => {
		mocked_execa_sync.mockReturnValue(fake_sync_result(undefined))
		const message = await report_in(path.join(scratch, 'unsupported'), 'freebsd', X64_ARCHITECTURE)

		expect(message).toContain('freebsd/x64')
	})
})

// The whole point of the SessionStart wiring: a session must begin even where the fetch cannot.
describe('security_audit_provision.report — a fetch that cannot happen at all', () => {
	const project_root = path.join(scratch, 'offline')

	it('reports the reason instead of throwing when the request rejects', async () => {
		mocked_execa_sync.mockReturnValue(fake_sync_result(undefined))
		vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('getaddrinfo ENOTFOUND')))
		const message = await report_in(project_root, LINUX_PLATFORM, X64_ARCHITECTURE)

		expect(message).toContain('Could not fetch osv-scanner from')
		expect(message).toContain('ENOTFOUND')
	})

	// Without the record the previous failure is repeated at every startup, resume, clear and compact,
	// each one paying the whole download timeout before the same message is printed again.
	it('does not retry at session start after a failure it just recorded', async () => {
		mocked_execa_sync.mockReturnValue(fake_sync_result(undefined))
		const fetch_spy = vi.fn()

		vi.stubGlobal('fetch', fetch_spy)
		const message = await security_audit_provision.report(
			project_root,
			LINUX_PLATFORM,
			X64_ARCHITECTURE,
			false,
		)

		expect(message).toContain('--force')
		expect(fetch_spy).not.toHaveBeenCalled()
	})
})
