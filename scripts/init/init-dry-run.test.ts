import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execaSync } from 'execa'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { init_dry_run, type DryRunRequest } from './init-dry-run'

vi.mock('execa', () => ({ execaSync: vi.fn() }))

const mocked_execa_sync = vi.mocked(execaSync)
const PACKAGE_JSON = 'package.json'
const ORIGINAL_MANIFEST = '{"name":"example"}\n'
const GENERATED_FILE = 'AGENTS.md'
const NODE_MODULES = 'node_modules'
const INIT_OUTPUT = 'init output'
const PROFILE_FLAG = '--profile'
const NO_INSTALL_FLAG = '--no-install'
const OPTIONS_SCHEMA = z.object({ cwd: z.string() })
const ARGS_SCHEMA = z.array(z.string())

// What the stand-in setup saw of the scratch copy while it ran.
const state = {
	root: '',
	scratch: '',
	has_git: false,
	has_node_modules: false,
	entries: new Array<string>(),
}

function result_of(exit_code: number): ReturnType<typeof execaSync> {
	const result = { exitCode: exit_code, all: INIT_OUTPUT, stdout: '', stderr: '' }

	return result as unknown as ReturnType<typeof execaSync>
}

function record_scratch(scratch: string): void {
	state.scratch = scratch
	state.has_git = existsSync(path.join(scratch, '.git'))
	state.has_node_modules = existsSync(path.join(scratch, NODE_MODULES))
	state.entries = readdirSync(scratch)
}

// Stands in for the real `josh init`: it adds a file and a script, and records where it ran.
function fake_setup(cwd: string, exit_code: number): ReturnType<typeof execaSync> {
	const manifest = { name: 'example', scripts: { test: 'vitest' } }

	record_scratch(cwd)
	writeFileSync(path.join(cwd, GENERATED_FILE), '# agents\n')
	writeFileSync(path.join(cwd, PACKAGE_JSON), `${JSON.stringify(manifest, undefined, '\t')}\n`)

	return result_of(exit_code)
}

// git runs through execa too: `git init` leaves the directory a real one would, the rest succeeds.
function fake_git(cwd: string, args: ReadonlyArray<string>): ReturnType<typeof execaSync> {
	if (args[0] === 'init') mkdirSync(path.join(cwd, '.git'))

	return result_of(0)
}

function fake_init(exit_code = 0): void {
	mocked_execa_sync.mockImplementation((...call: Array<unknown>) => {
		const args = ARGS_SCHEMA.parse(call[1])
		const { cwd } = OPTIONS_SCHEMA.parse(call[2])

		return args.includes(NO_INSTALL_FLAG) ? fake_setup(cwd, exit_code) : fake_git(cwd, args)
	})
}

function request(overrides: Partial<DryRunRequest> = {}): DryRunRequest {
	return { root: state.root, profile: 'basic', has_git: false, is_install: false, ...overrides }
}

beforeEach(() => {
	state.root = mkdtempSync(path.join(os.tmpdir(), 'init-dry-run-test-'))
	writeFileSync(path.join(state.root, PACKAGE_JSON), ORIGINAL_MANIFEST)
	mkdirSync(path.join(state.root, NODE_MODULES))
	writeFileSync(path.join(state.root, NODE_MODULES, 'big.js'), 'module.exports = 1\n')
	mocked_execa_sync.mockReset()
})

afterEach(() => {
	rmSync(state.root, { recursive: true, force: true })
})

describe('init_dry_run.split_dry_run_flag', () => {
	it('peels --dry-run off and keeps the other arguments in order', () => {
		expect(init_dry_run.split_dry_run_flag([PROFILE_FLAG, 'full', '--dry-run'])).toStrictEqual({
			is_dry_run: true,
			rest: [PROFILE_FLAG, 'full'],
		})
	})

	it('answers false when the flag is absent', () => {
		expect(init_dry_run.split_dry_run_flag([NO_INSTALL_FLAG]).is_dry_run).toBe(false)
	})
})

describe('init_dry_run.plan_report (#3830)', () => {
	it('reports what the setup wrote in a scratch copy and leaves the project as it was', () => {
		fake_init()
		const report = init_dry_run.plan_report(request())

		expect(report).toContain(`create    ${GENERATED_FILE}`)
		expect(report).toContain(`merge     ${PACKAGE_JSON}`)
		expect(report).toContain('+ scripts.test "vitest"')
		expect(report).toContain(`skip the install and the format (${NO_INSTALL_FLAG})`)
		expect(readFileSync(path.join(state.root, PACKAGE_JSON), 'utf8')).toBe(ORIGINAL_MANIFEST)
		expect(existsSync(path.join(state.root, GENERATED_FILE))).toBe(false)
	})

	it('runs the setup outside the project, without its ignored directories, and removes the copy', () => {
		fake_init()
		init_dry_run.plan_report(request())

		expect(state.scratch).not.toBe(state.root)
		expect(state.has_node_modules).toBe(false)
		expect(existsSync(state.scratch)).toBe(false)
		expect(mocked_execa_sync.mock.calls[0]?.[1]).toEqual(
			expect.arrayContaining([NO_INSTALL_FLAG, PROFILE_FLAG, 'basic']),
		)
	})

	it('gives the scratch copy a repository only when the setup would meet one', () => {
		fake_init()
		init_dry_run.plan_report(request())
		expect(state.has_git).toBe(false)

		init_dry_run.plan_report(request({ has_git: true }))
		expect(state.has_git).toBe(true)
	})
})

describe('init_dry_run.plan_report, the project directory (#3830)', () => {
	it('copies a project whose own directory is named like an ignored one', () => {
		const root = path.join(state.root, 'build')

		mkdirSync(root)
		writeFileSync(path.join(root, PACKAGE_JSON), ORIGINAL_MANIFEST)
		fake_init()

		expect(init_dry_run.plan_report(request({ root }))).toContain(`merge     ${PACKAGE_JSON}`)
	})
})

describe('init_dry_run.plan_report, links (#3830)', () => {
	it('copies a link to a file as the file, so the setup cannot write through it', () => {
		const target = path.join(state.root, NODE_MODULES, 'agents-target.md')

		writeFileSync(target, '# shared\n')
		symlinkSync(target, path.join(state.root, GENERATED_FILE))
		fake_init()
		init_dry_run.plan_report(request())

		expect(readFileSync(target, 'utf8')).toBe('# shared\n')
	})

	it('leaves out a dangling link and a link to a directory, and keeps a file named like one', () => {
		symlinkSync(path.join(state.root, 'missing.md'), path.join(state.root, 'gone.md'))
		symlinkSync(state.root, path.join(state.root, 'self'))
		writeFileSync(path.join(state.root, 'build'), '#!/bin/sh\n')
		fake_init()
		init_dry_run.plan_report(request())

		expect(state.entries).not.toContain('gone.md')
		expect(state.entries).not.toContain('self')
		expect(state.entries).toContain('build')
	})
})

describe('init_dry_run.plan_report, file contents (#3830)', () => {
	it('compares a changed file by its content and leaves an unchanged file out', () => {
		writeFileSync(path.join(state.root, 'README.md'), '# example\n')
		fake_init()
		const report = init_dry_run.plan_report(request())

		expect(report).toContain(`merge     ${PACKAGE_JSON}`)
		expect(report).not.toContain('- name')
		expect(report).not.toContain('README.md')
	})
})

describe('init_dry_run.plan_report, install and failure (#3830)', () => {
	it('names the install and the format when the run installs', () => {
		fake_init()

		expect(init_dry_run.plan_report(request({ is_install: true }))).toContain('run pnpm install')
	})

	it('throws with the output when the simulated setup fails, still removing the copy', () => {
		fake_init(1)

		expect(() => init_dry_run.plan_report(request())).toThrow(INIT_OUTPUT)
		expect(existsSync(state.scratch)).toBe(false)
	})
})
