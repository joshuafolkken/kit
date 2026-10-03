import { createHash } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const execa_sync_mock = vi.hoisted(() => vi.fn())
const exists_mock = vi.hoisted(() => vi.fn())
const read_mock = vi.hoisted(() => vi.fn())
const readdir_mock = vi.hoisted(() => vi.fn())
const write_mock = vi.hoisted(() => vi.fn())

vi.mock('execa', () => ({ execaSync: execa_sync_mock }))
vi.mock('node:fs', () => ({
	existsSync: exists_mock,
	readdirSync: readdir_mock,
	readFileSync: read_mock,
	writeFileSync: write_mock,
}))

const { ci_installer_pin } = await import('./ci-installer-pin')

const OLD_SHA = 'a'.repeat(64)
const WORKFLOW = `env:
  JOSH_PLAYWRIGHT_BROWSERS: chromium
  SAFE_CHAIN_INSTALLER_VERSION: 1.5.20
  SAFE_CHAIN_INSTALLER_SHA256: ${OLD_SHA}

jobs: {}
`
const INSTALLER_BYTES = new TextEncoder().encode('#!/bin/sh\necho install\n')
const INSTALLER_SHA = createHash('sha256').update(INSTALLER_BYTES).digest('hex')
const PATHS = ['a/ci.yml', 'b/ci.yml']
const GITHUB_WORKFLOWS = '.github/workflows'
const GITHUB_ACTIONS = '.github/actions'
const DAST_YML = `${GITHUB_WORKFLOWS}/dast.yml`
const UNPINNED_YML = `${GITHUB_WORKFLOWS}/release.yml`
const UNPINNED_WORKFLOW = 'env:\n  FOO: bar\n'

beforeEach(() => {
	for (const mock of [execa_sync_mock, exists_mock, read_mock, readdir_mock, write_mock]) {
		mock.mockReset()
	}

	exists_mock.mockReturnValue(true)
	read_mock.mockReturnValue(WORKFLOW)
	execa_sync_mock.mockReturnValue({ exitCode: 0, stdout: INSTALLER_BYTES })
})

describe('ci_installer_pin.extract_pinned_version', () => {
	it('reads the release from the workflow env', () => {
		expect(ci_installer_pin.extract_pinned_version(WORKFLOW)).toBe('1.5.20')
	})

	it('returns undefined for a workflow without the pin', () => {
		expect(ci_installer_pin.extract_pinned_version(UNPINNED_WORKFLOW)).toBeUndefined()
	})
})

describe('ci_installer_pin.rewrite_pin', () => {
	it('moves the release and the installer hash together and keeps the surrounding lines', () => {
		const rewritten = ci_installer_pin.rewrite_pin(WORKFLOW, { version: '2.0.0', sha256: 'b' })

		expect(rewritten).toContain('\n  SAFE_CHAIN_INSTALLER_VERSION: 2.0.0\n')
		expect(rewritten).toContain('\n  SAFE_CHAIN_INSTALLER_SHA256: b\n\njobs')
		expect(rewritten).toContain('JOSH_PLAYWRIGHT_BROWSERS: chromium')
	})
})

describe('ci_installer_pin.fetch_installer_sha256', () => {
	it('hashes the versioned release installer', () => {
		expect(ci_installer_pin.fetch_installer_sha256('2.0.0')).toBe(INSTALLER_SHA)
		expect(execa_sync_mock).toHaveBeenCalledWith(
			'curl',
			['--proto', '=https', '-fsSL', ci_installer_pin.installer_url('2.0.0')],
			expect.objectContaining({ encoding: 'buffer', stripFinalNewline: false, reject: false }),
		)
	})

	it('returns undefined when the download fails', () => {
		execa_sync_mock.mockReturnValue({ exitCode: 22, stdout: new Uint8Array() })
		expect(ci_installer_pin.fetch_installer_sha256('2.0.0')).toBeUndefined()
	})
})

describe('ci_installer_pin.list_workflows', () => {
	it('lists the YAML files of every workflow directory that exists', () => {
		exists_mock.mockImplementation((directory: string) => directory === GITHUB_WORKFLOWS)
		readdir_mock.mockReturnValue(['load.yaml', 'dast.yml', 'README.md'])

		expect(ci_installer_pin.list_workflows()).toEqual([DAST_YML, `${GITHUB_WORKFLOWS}/load.yaml`])
		expect(readdir_mock).toHaveBeenCalledOnce()
	})

	it('lists every local composite action file after the workflows', () => {
		const present = new Set([
			GITHUB_ACTIONS,
			`${GITHUB_ACTIONS}/setup-pnpm/action.yml`,
			`${GITHUB_ACTIONS}/other/action.yaml`,
		])

		exists_mock.mockImplementation((candidate: string) => present.has(candidate))
		readdir_mock.mockReturnValue(['setup-pnpm', 'other'])

		expect(ci_installer_pin.list_workflows()).toEqual([
			`${GITHUB_ACTIONS}/other/action.yaml`,
			`${GITHUB_ACTIONS}/setup-pnpm/action.yml`,
		])
	})
})

describe('ci_installer_pin.sync without a path list', () => {
	// joshuafolkken/kit#2830: a workflow another package distributes carried the pin but sat outside
	// a hard-coded list, so `josh latest` moved ci.yml and left it behind.
	it('moves a pinned workflow no list names and leaves an unpinned one alone', () => {
		exists_mock.mockReturnValue(true)
		readdir_mock.mockImplementation((directory: string) =>
			directory === GITHUB_WORKFLOWS ? ['dast.yml', 'release.yml'] : [],
		)
		read_mock.mockImplementation((file_path: string) =>
			file_path === UNPINNED_YML ? UNPINNED_WORKFLOW : WORKFLOW,
		)

		ci_installer_pin.sync('2.0.0')

		expect(write_mock).toHaveBeenCalledOnce()
		expect(write_mock).toHaveBeenCalledWith(DAST_YML, expect.stringContaining('2.0.0'), 'utf8')
	})
})

describe('ci_installer_pin.sync', () => {
	it('writes the new release and its hash to every stale workflow', () => {
		ci_installer_pin.sync('2.0.0', PATHS)

		expect(write_mock).toHaveBeenCalledTimes(PATHS.length)
		expect(write_mock).toHaveBeenCalledWith(
			PATHS[0],
			expect.stringContaining(`SAFE_CHAIN_INSTALLER_SHA256: ${INSTALLER_SHA}`),
			'utf8',
		)
	})

	it('downloads nothing and writes nothing when every pin is already current', () => {
		ci_installer_pin.sync('1.5.20', PATHS)

		expect(execa_sync_mock).not.toHaveBeenCalled()
		expect(write_mock).not.toHaveBeenCalled()
	})

	it('skips a workflow that does not exist', () => {
		exists_mock.mockImplementation((workflow_path: string) => workflow_path === PATHS[1])
		ci_installer_pin.sync('2.0.0', PATHS)

		expect(write_mock).toHaveBeenCalledOnce()
		expect(write_mock).toHaveBeenCalledWith(PATHS[1], expect.any(String), 'utf8')
	})

	it('leaves the pin as is when the installer cannot be downloaded', () => {
		execa_sync_mock.mockReturnValue({ exitCode: 22, stdout: new Uint8Array() })
		const warn_spy = vi.spyOn(console, 'warn').mockReturnValue()

		ci_installer_pin.sync('2.0.0', PATHS)

		expect(write_mock).not.toHaveBeenCalled()
		expect(warn_spy).toHaveBeenCalled()
		warn_spy.mockRestore()
	})
})
