import { execaSync } from 'execa'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { safe_chain_local_version } from './local-version'
import { safe_chain_preinstall } from './preinstall-command'

vi.mock('execa', () => ({ execaSync: vi.fn() }))

const mocked_execa_sync = vi.mocked(execaSync)

type ExecaSyncResult = ReturnType<typeof execaSync>

const STALE_VERSION = '1.2.2'
const NEWER_VERSION = '1.5.29'
const MIN_VERSION = safe_chain_local_version.PROJECT_EXCLUSIONS_MIN_VERSION

function fake_result(stdout: string | undefined, exit_code: number | undefined): ExecaSyncResult {
	const outcome = { stdout, exitCode: exit_code, stderr: '' }

	return outcome as unknown as ExecaSyncResult
}

function answers(version_output: string): void {
	mocked_execa_sync.mockReturnValue(
		fake_result(`Current safe-chain version: ${version_output}\n`, 0),
	)
}

function printed_lines(): Array<string> {
	const info = vi.spyOn(console, 'info').mockImplementation(() => undefined)

	safe_chain_local_version.report_local_version()

	return info.mock.calls.map((call) => String(call[0]))
}

beforeEach(() => {
	vi.restoreAllMocks()
	vi.resetAllMocks()
})

describe('safe_chain_local_version.is_stale', () => {
	it('is stale below the version that reads the repository .aikido', () => {
		expect(safe_chain_local_version.is_stale(STALE_VERSION)).toBe(true)
		expect(safe_chain_local_version.is_stale('1.5.14')).toBe(true)
	})

	it('is not stale at or above that version', () => {
		expect(safe_chain_local_version.is_stale(MIN_VERSION)).toBe(false)
		expect(safe_chain_local_version.is_stale(NEWER_VERSION)).toBe(false)
	})
})

describe('safe_chain_local_version.read_local_version', () => {
	it('reads the version out of the --version line', () => {
		answers(STALE_VERSION)

		expect(safe_chain_local_version.read_local_version()).toBe(STALE_VERSION)
	})

	it('is undefined when no version can be read', () => {
		answers('unknown')

		expect(safe_chain_local_version.read_local_version()).toBeUndefined()
	})

	it('is undefined when safe-chain is not on PATH', () => {
		mocked_execa_sync.mockReturnValue(fake_result(undefined, undefined))

		expect(safe_chain_local_version.read_local_version()).toBeUndefined()
	})
})

describe('safe_chain_local_version.report_local_version', () => {
	it('warns about a stale safe-chain and points at the install guide', () => {
		answers(STALE_VERSION)
		const output = printed_lines().join('\n')

		expect(output).toContain(`safe-chain ${STALE_VERSION}`)
		expect(output).toContain('.aikido')
		expect(output).toContain(safe_chain_preinstall.INSTALL_GUIDE_URL)
	})

	it('stays silent for a safe-chain that reads the .aikido exclusions', () => {
		answers(MIN_VERSION)

		expect(printed_lines()).toStrictEqual([])
	})

	it('stays silent when safe-chain is missing', () => {
		mocked_execa_sync.mockReturnValue(fake_result(undefined, undefined))

		expect(printed_lines()).toStrictEqual([])
	})

	it('stays silent when the version cannot be read', () => {
		answers('unknown')

		expect(printed_lines()).toStrictEqual([])
	})
})
