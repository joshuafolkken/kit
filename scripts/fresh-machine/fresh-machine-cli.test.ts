import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { claude_token } from '#scripts/auth/claude-token'
import { gh_cli_token } from '#scripts/gh/gh-cli-token'
import { git_gh_exec } from '#scripts/gh/git-gh-exec'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fresh_machine_cli } from './fresh-machine-cli'
import { fresh_machine_run, type RunRequest } from './fresh-machine-run'

const paths_mock = vi.hoisted(() => ({ root: '' }))

vi.mock('#scripts/init/init-paths', () => ({
	get PROJECT_ROOT(): string {
		return paths_mock.root
	},
}))
vi.mock('#scripts/gh/gh-cli-token', () => ({ gh_cli_token: { get: vi.fn() } }))
vi.mock('#scripts/auth/claude-token', () => ({
	claude_token: {
		read: vi.fn(),
		VARIABLE: 'CLAUDE_CODE_OAUTH_TOKEN',
		SETUP_HINT: 'Run `pnpm josh auth:setup` to save one.',
	},
}))
vi.mock('#scripts/gh/git-gh-exec', () => ({ git_gh_exec: { exec_gh_api_sync: vi.fn() } }))
vi.mock('./fresh-machine-run', () => ({ fresh_machine_run: { run: vi.fn() } }))

const INIT_PATTERN = 'kit-test-html-init'
const START_PATTERN = 'kit-test-html-start'
const TOKEN = 'gho_exampleTokenValue'
const CLAUDE_TOKEN = 'sk-ant-oat01-exampleTokenValue'
const LOG_DIRECTORY = 'logs'
const SPEC_FILE = 'scenario.json'
const SPEC_FLAG = '--spec'
const SPEC_NAME = 'app-kit-test-html-init'
const SPEC_COMMAND = 'pnpm exec josh-app init'
const RUN_EXIT_CODE = 3
const KIT = '@joshuafolkken/kit'
const TOOLKIT = '@example/toolkit'

function request(): RunRequest | undefined {
	return vi.mocked(fresh_machine_run.run).mock.calls[0]?.[0]
}

function printed(stream: typeof console.info): string {
	return vi.mocked(stream).mock.calls.flat().join('\n')
}

function write_spec(spec: Record<string, unknown>): void {
	writeFileSync(path.join(paths_mock.root, SPEC_FILE), JSON.stringify(spec))
}

function write_manifest(name: string): void {
	writeFileSync(path.join(paths_mock.root, 'package.json'), JSON.stringify({ name }))
}

beforeEach(() => {
	paths_mock.root = mkdtempSync(path.join(os.tmpdir(), 'fresh-machine-cli-test-'))
	write_manifest(KIT)
	vi.mocked(fresh_machine_run.run).mockResolvedValue(0)
	vi.mocked(gh_cli_token.get).mockReturnValue(TOKEN)
	vi.mocked(claude_token.read).mockReturnValue(CLAUDE_TOKEN)
	vi.mocked(git_gh_exec.exec_gh_api_sync).mockReturnValue('')
	vi.spyOn(console, 'info').mockReturnValue()
	vi.spyOn(console, 'error').mockReturnValue()
})

afterEach(() => {
	rmSync(paths_mock.root, { force: true, recursive: true })
	vi.resetAllMocks()
	vi.restoreAllMocks()
})

describe('fresh_machine_cli.run — choosing the scenario', () => {
	it('lists the six patterns of kit and runs nothing', async () => {
		await expect(fresh_machine_cli.run(['--list'])).resolves.toBe(0)

		expect(printed(console.info).split('\n')).toStrictEqual([
			'kit-test-lua-init',
			'kit-test-lua-start',
			INIT_PATTERN,
			START_PATTERN,
			'kit-test-svelte-init',
			'kit-test-svelte-start',
		])
		expect(fresh_machine_run.run).not.toHaveBeenCalled()
	})

	it.each([[['kit-test-unknown']], [[]]])('refuses %j with the usage', async (argv) => {
		await expect(fresh_machine_cli.run(argv)).resolves.toBe(1)

		expect(printed(console.error)).toContain('Usage: josh fresh:run')
		expect(printed(console.error)).toContain(INIT_PATTERN)
		expect(fresh_machine_run.run).not.toHaveBeenCalled()
	})

	it('answers with the exit status of the run', async () => {
		vi.mocked(fresh_machine_run.run).mockResolvedValue(RUN_EXIT_CODE)

		await expect(fresh_machine_cli.run([INIT_PATTERN])).resolves.toBe(RUN_EXIT_CODE)
		expect(printed(console.info)).toContain(request()?.log_path)
	})
})

describe('fresh_machine_cli.run — the GitHub token', () => {
	it('never reads a token for a pattern without GitHub', async () => {
		await fresh_machine_cli.run([INIT_PATTERN])

		expect(gh_cli_token.get).not.toHaveBeenCalled()
		expect(request()?.secrets).toStrictEqual({})
	})

	it('passes the token of this machine to a GitHub pattern', async () => {
		await fresh_machine_cli.run([START_PATTERN, '--package-version', '1.2.3'])

		expect(request()).toMatchObject({ secrets: { GH_TOKEN: TOKEN }, package_version: '1.2.3' })
	})

	it('refuses a GitHub pattern when gh has no token, before anything runs', async () => {
		vi.mocked(gh_cli_token.get).mockReturnValue(undefined)

		await expect(fresh_machine_cli.run([START_PATTERN])).resolves.toBe(1)
		expect(printed(console.error)).toContain('gh auth login')
		expect(fresh_machine_run.run).not.toHaveBeenCalled()
	})
})

describe('fresh_machine_cli.run — the Claude Code token', () => {
	const claude_spec = { name: SPEC_NAME, requires_claude: true, commands: [SPEC_COMMAND] }

	it('never reads a token for a scenario without Claude Code', async () => {
		await fresh_machine_cli.run([INIT_PATTERN])

		expect(claude_token.read).not.toHaveBeenCalled()
	})

	it('passes the token the host holds to a Claude Code scenario', async () => {
		write_spec(claude_spec)

		await expect(fresh_machine_cli.run([SPEC_FLAG, SPEC_FILE])).resolves.toBe(0)
		expect(request()?.secrets).toStrictEqual({ CLAUDE_CODE_OAUTH_TOKEN: CLAUDE_TOKEN })
	})

	it('passes both tokens to a scenario that uses GitHub and Claude Code', async () => {
		write_spec({ ...claude_spec, requires_github: true })

		await fresh_machine_cli.run([SPEC_FLAG, SPEC_FILE])

		expect(Object.keys(request()?.secrets ?? {})).toStrictEqual([
			'GH_TOKEN',
			'CLAUDE_CODE_OAUTH_TOKEN',
		])
	})

	it('stops before Docker and names auth:setup when the host holds no token', async () => {
		vi.mocked(claude_token.read).mockReturnValue(undefined)
		write_spec(claude_spec)

		await expect(fresh_machine_cli.run([SPEC_FLAG, SPEC_FILE])).resolves.toBe(1)
		expect(printed(console.error)).toContain('pnpm josh auth:setup')
		expect(fresh_machine_run.run).not.toHaveBeenCalled()
	})
})

describe('fresh_machine_cli.run — the log', () => {
	it('numbers the first run 1 under the default directory', async () => {
		await fresh_machine_cli.run([INIT_PATTERN])

		expect(request()).toMatchObject({
			run_name: `${INIT_PATTERN}-1`,
			log_path: path.join(paths_mock.root, '.claude/tmp/fresh-machine', `${INIT_PATTERN}-1.log`),
			is_rebuild: false,
		})
	})

	it('numbers a rerun past the logs already in --log-dir', async () => {
		mkdirSync(path.join(paths_mock.root, LOG_DIRECTORY))
		writeFileSync(path.join(paths_mock.root, LOG_DIRECTORY, `${INIT_PATTERN}-4.log`), '')

		await fresh_machine_cli.run([INIT_PATTERN, '--log-dir', LOG_DIRECTORY, '--rebuild'])

		expect(request()).toMatchObject({
			run_name: `${INIT_PATTERN}-5`,
			log_path: path.join(paths_mock.root, LOG_DIRECTORY, `${INIT_PATTERN}-5.log`),
			is_rebuild: true,
		})
	})
})

describe('fresh_machine_cli.run — the name of a GitHub run', () => {
	it('is numbered past a repository of the account that has no log in this checkout', async () => {
		vi.mocked(git_gh_exec.exec_gh_api_sync).mockReturnValue(`kit\n${START_PATTERN}-2\n`)

		await fresh_machine_cli.run([START_PATTERN])

		expect(request()?.run_name).toBe(`${START_PATTERN}-3`)
		expect(git_gh_exec.exec_gh_api_sync).toHaveBeenCalledWith(
			expect.objectContaining({ should_paginate: true }),
		)
	})

	it('asks GitHub nothing for a pattern without GitHub', async () => {
		await fresh_machine_cli.run([INIT_PATTERN])

		expect(git_gh_exec.exec_gh_api_sync).not.toHaveBeenCalled()
	})
})

describe('fresh_machine_cli.run — a checkout that is not kit', () => {
	it('refuses a named pattern, which would install kit beside the package it packed', async () => {
		write_manifest(TOOLKIT)

		await expect(fresh_machine_cli.run([INIT_PATTERN])).rejects.toThrow(/--spec/u)
		expect(fresh_machine_run.run).not.toHaveBeenCalled()
	})

	it('runs the scenario of a spec file', async () => {
		write_manifest(TOOLKIT)
		write_spec({ name: SPEC_NAME, commands: [SPEC_COMMAND] })

		await expect(fresh_machine_cli.run([SPEC_FLAG, SPEC_FILE])).resolves.toBe(0)
		expect(request()?.run_name).toBe(`${SPEC_NAME}-1`)
	})
})

describe('fresh_machine_cli.run — a spec file', () => {
	it('runs the scenario a toolkit wrote, read from its own checkout', async () => {
		write_spec({ name: SPEC_NAME, commands: [SPEC_COMMAND] })

		await expect(fresh_machine_cli.run([SPEC_FLAG, SPEC_FILE])).resolves.toBe(0)
		expect(request()?.scenario).toMatchObject({ name: SPEC_NAME, commands: [SPEC_COMMAND] })
		expect(request()?.run_name).toBe(`${SPEC_NAME}-1`)
	})

	it('names the wrong fields of an invalid spec and runs nothing', async () => {
		write_spec({ name: SPEC_NAME, commands: [] })

		await expect(fresh_machine_cli.run([SPEC_FLAG, SPEC_FILE])).rejects.toThrow(
			/Invalid scenario spec — commands/u,
		)
		expect(fresh_machine_run.run).not.toHaveBeenCalled()
	})
})
