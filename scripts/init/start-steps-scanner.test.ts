import path from 'node:path'
import { security_audit } from '#scripts/security/security-audit'
import { security_audit_provision } from '#scripts/security/security-audit-provision'
import { execaSync } from 'execa'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { start_steps, type StepContext } from './start-steps'

vi.mock(import('execa'), async (import_original) => ({
	...(await import_original()),
	execaSync: vi.fn(),
}))
vi.mock('./init', () => ({ main: vi.fn() }))
vi.mock('#scripts/repo/repository-labels', () => ({
	repository_labels: { ensure_labels: vi.fn() },
}))
vi.mock('./start-setup-pr', () => ({ start_setup_pr: { open: vi.fn(), changed_paths: vi.fn() } }))
vi.mock('#scripts/security/security-audit', () => ({
	security_audit: { resolve_scanner: vi.fn() },
}))
vi.mock('#scripts/security/security-audit-provision', () => ({
	security_audit_provision: { report: vi.fn() },
}))

const mocked_execa = vi.mocked(execaSync)
const ROOT = path.join(path.sep, 'work', 'my-site')
const CONTEXT: StepContext = {
	root: ROOT,
	profile: 'full',
	visibility: 'private',
	init_command: undefined,
	push_preflight_command: undefined,
}
const SCANNER = { path: 'osv-scanner', is_below_floor: false }
const DOWNLOAD_FAILURE = 'osv-scanner could not be downloaded: fetch failed'
const COMMAND_RESULT: unknown = { exitCode: 0, stdout: '' }

function spawned(): ReadonlyArray<string> {
	return mocked_execa.mock.calls.map((call) => path.basename(String(call[0])))
}

beforeEach(() => {
	mocked_execa.mockReset()
	mocked_execa.mockReturnValue(COMMAND_RESULT as ReturnType<typeof execaSync>)
	vi.mocked(security_audit.resolve_scanner).mockReset().mockReturnValue(SCANNER)
	vi.mocked(security_audit_provision.report).mockReset().mockResolvedValue('installed')
	vi.spyOn(console, 'info').mockImplementation(() => undefined)
})

describe('the scanner the pre-push audit needs (#3755)', () => {
	it('is fetched, forced, before the first step of a full-profile plan that pushes', async () => {
		vi.mocked(security_audit_provision.report).mockImplementation(async () => {
			expect(mocked_execa).not.toHaveBeenCalled()

			return 'installed'
		})

		await start_steps.run_steps(['git_init', 'repository'], CONTEXT)

		expect(security_audit_provision.report).toHaveBeenCalledWith(
			ROOT,
			process.platform,
			process.arch,
			true,
		)
		expect(spawned()).toContain('gh')
	})

	it('is fetched ahead of the setup pull request too', async () => {
		await start_steps.run_steps(['labels', 'setup_pr'], CONTEXT)

		expect(security_audit_provision.report).toHaveBeenCalledTimes(1)
	})

	it('stops the run before its first step when no scanner can be found afterwards', async () => {
		vi.mocked(security_audit_provision.report).mockResolvedValue(DOWNLOAD_FAILURE)
		vi.mocked(security_audit.resolve_scanner).mockReturnValue(undefined)

		await expect(start_steps.run_steps(['git_init', 'repository'], CONTEXT)).rejects.toThrow(
			/before its first step: osv-scanner[\s\S]*Nothing was changed\.[\s\S]*fetch failed/u,
		)
		expect(mocked_execa).not.toHaveBeenCalled()
	})
})

describe('the fetch of the scanner (#3755)', () => {
	it('is announced before it starts, so a slow download does not read as a hang', async () => {
		vi.mocked(security_audit_provision.report).mockImplementation(async () => {
			expect(console.info).toHaveBeenCalledWith(expect.stringMatching(/pre-push audit needs/u))

			return 'installed'
		})

		await start_steps.run_steps(['git_init', 'repository'], CONTEXT)

		expect(security_audit_provision.report).toHaveBeenCalledTimes(1)
	})

	it('does not stop the run when it fails but a scanner is still found', async () => {
		vi.mocked(security_audit_provision.report).mockResolvedValue(DOWNLOAD_FAILURE)

		await start_steps.run_steps(['git_init', 'repository'], CONTEXT)

		expect(spawned()).toContain('gh')
	})
})

describe('the scanner of a run whose pushes the audit does not guard (#3755)', () => {
	it('is not fetched when the plan does not push', async () => {
		await start_steps.run_steps(['initialize', 'labels'], CONTEXT)

		expect(security_audit_provision.report).not.toHaveBeenCalled()
	})

	it('is not fetched for the basic profile, which installs no pre-push hook', async () => {
		await start_steps.run_steps(['git_init', 'repository'], { ...CONTEXT, profile: 'basic' })

		expect(security_audit_provision.report).not.toHaveBeenCalled()
		expect(security_audit.resolve_scanner).not.toHaveBeenCalled()
	})
})
