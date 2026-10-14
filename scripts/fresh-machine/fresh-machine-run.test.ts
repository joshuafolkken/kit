import {
	chmodSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fresh_machine_image } from './fresh-machine-image'
import { fresh_machine_run, type RunRequest } from './fresh-machine-run'
import { fresh_machine_spec } from './fresh-machine-spec'

// The run is exercised against real processes: `docker` and `pnpm` are shell scripts on a PATH of
// their own, so what is asserted is what the two programs were actually handed.

const paths_mock = vi.hoisted(() => ({ root: '' }))

vi.mock('#scripts/init/init-paths', () => ({
	get PROJECT_ROOT(): string {
		return paths_mock.root
	},
}))

const PACKAGE_NAME = '@example/toolkit'
const RUN_NAME = 'toolkit-test-html-init-3'
const TOKEN = 'gho_exampleTokenValue'
const CLAUDE_TOKEN = 'sk-ant-oat01-exampleTokenValue'
const SECRETS = { GH_TOKEN: TOKEN, CLAUDE_CODE_OAUTH_TOKEN: CLAUDE_TOKEN }
const TARBALL = 'toolkit-1.0.0.tgz'
const LATEST_VERSION = '9.9.9'
const PINNED_VERSION = '1.2.3'
const SEED_FILE = 'index.html'
const BUILT_LINE = 'fake docker built the image'
const PACKED_LINE = 'fake pnpm packed the checkout'
const CONTAINER_LINE = 'fake container ran the script'
const RUN_EXIT_CODE = 3
const BUILD_EXIT_CODE = 2
const EXECUTABLE_MODE = 0o700
const SYSTEM_PATH = '/usr/bin:/bin'
const RUN_ARGV = 'run.argv'
const VIEW_ARGV = 'view.argv'
const MODES = 'modes.ls'
const MOUNT_MODES = 'mounts.ls'
const ROOT_MODES = 'root.ls'
const PRIVATE_UMASK = 0o077
const NESTED_SEED_FILE = 'assets/app.js'
// Of an `ls -l` line: the entry's type, then the three permission characters of everyone else.
const OTHERS_START = 7
const OTHERS_END = 10
const READABLE_FILE = '-r--'
const READABLE_DIRECTORY = 'dr-x'
const PRIVATE_DIRECTORY = 'd---'
// Two seed files, the directory of one of them, and the tarball.
const STAGED_ENTRIES = 4
const DOCKER = String.raw`#!/bin/sh
if [ "$1" = "build" ]; then
	cat > "$FAKE_DIR/dockerfile"
	printf '%s\n' '${BUILT_LINE}'
	exit "$FAKE_BUILD_EXIT"
fi
printf '%s\n' "$@" > "$FAKE_DIR/${RUN_ARGV}"
for argument in "$@"; do
	case "$argument" in *:/seed:ro) ls "$${'{'}argument%%:*}" > "$FAKE_DIR/seed.ls" ;; esac
	case "$argument" in *:ro) ls -lR "$${'{'}argument%%:*}" >> "$FAKE_DIR/${MODES}" ;; esac
	case "$argument" in *:ro) ls -ld "$${'{'}argument%%:*}" >> "$FAKE_DIR/${MOUNT_MODES}" ;; esac
	case "$argument" in *:/seed:ro) ls -ld "$${'{'}argument%%/seed:*}" > "$FAKE_DIR/${ROOT_MODES}" ;; esac
done
printf '%s\n' '${CONTAINER_LINE}' "token $GH_TOKEN claude $CLAUDE_CODE_OAUTH_TOKEN"
exit "$FAKE_RUN_EXIT"
`
const PNPM = String.raw`#!/bin/sh
if [ "$1" = "pack" ]; then
	: > "$3/${TARBALL}"
	printf '%s\n' '${PACKED_LINE}'
	exit 0
fi
printf '%s\n' "$@" > "$FAKE_DIR/${VIEW_ARGV}"
printf '%s\n' '${LATEST_VERSION}'
`
const scratch = { bin: '', log: '' }

function executable(name: string, source: string): void {
	const file = path.join(scratch.bin, name)

	writeFileSync(file, source)
	chmodSync(file, EXECUTABLE_MODE)
}

function request(overrides: Partial<RunRequest>): RunRequest {
	return {
		scenario: fresh_machine_spec.define({
			name: 'toolkit-test-html-init',
			files: { [SEED_FILE]: '<h1>Hello</h1>\n' },
			commands: ['pnpm exec josh-app init'],
		}),
		run_name: RUN_NAME,
		log_path: scratch.log,
		package_version: undefined,
		secrets: {},
		is_rebuild: false,
		...overrides,
	}
}

function published(package_version: string | undefined): RunRequest {
	const scenario = fresh_machine_spec.define({
		name: 'toolkit-test-html-start',
		package_source: 'published',
		commands: ['pnpm exec josh-app start'],
	})

	return request({ scenario, package_version })
}

function recorded(name: string): string {
	return readFileSync(path.join(paths_mock.root, name), 'utf8')
}

function has_recorded(name: string): boolean {
	return existsSync(path.join(paths_mock.root, name))
}

function log(): string {
	return readFileSync(scratch.log, 'utf8')
}

function staged_seed(): string {
	const mount = recorded(RUN_ARGV)
		.split('\n')
		.find((line) => line.endsWith(':/seed:ro'))

	return mount?.split(':', 1)[0] ?? ''
}

// What everyone else may do with each entry of a recorded `ls -l` listing.
function others(name: string): Array<string> {
	return recorded(name)
		.split('\n')
		.filter((line) => /^[-d]/u.test(line))
		.map((line) => `${line.charAt(0)}${line.slice(OTHERS_START, OTHERS_END)}`)
}

async function run_with_private_umask(run_request: RunRequest): Promise<void> {
	const previous = process.umask(PRIVATE_UMASK)

	try {
		await fresh_machine_run.run(run_request)
	} finally {
		process.umask(previous)
	}
}

function write_checkout(): void {
	paths_mock.root = mkdtempSync(path.join(os.tmpdir(), 'fresh-machine-run-test-'))
	scratch.bin = path.join(paths_mock.root, 'bin')
	scratch.log = path.join(paths_mock.root, 'run.log')
	mkdirSync(scratch.bin)
	writeFileSync(path.join(paths_mock.root, 'package.json'), JSON.stringify({ name: PACKAGE_NAME }))
	executable('docker', DOCKER)
	executable('pnpm', PNPM)
}

beforeEach(() => {
	write_checkout()
	vi.stubEnv('PATH', `${scratch.bin}:${SYSTEM_PATH}`)
	vi.stubEnv('FAKE_DIR', paths_mock.root)
	vi.stubEnv('FAKE_BUILD_EXIT', '0')
	vi.stubEnv('FAKE_RUN_EXIT', '0')
	vi.spyOn(console, 'info').mockReturnValue()
})

afterEach(() => {
	rmSync(paths_mock.root, { force: true, recursive: true })
	vi.unstubAllEnvs()
	vi.restoreAllMocks()
})

describe('fresh_machine_run.run — a tarball scenario', () => {
	it('puts the build, the pack and the container into one log', async () => {
		await fresh_machine_run.run(request({}))

		const lines = log().split('\n')

		expect(lines).toContain('$ docker build --progress plain --tag josh-fresh-machine:base -')
		expect(lines).toContain(BUILT_LINE)
		expect(lines).toContain(PACKED_LINE)
		expect(lines).toContain(`# package: ${TARBALL}`)
		expect(lines).toContain(CONTAINER_LINE)
	})

	it('hands docker the Dockerfile on stdin', async () => {
		await fresh_machine_run.run(request({}))

		expect(recorded('dockerfile')).toBe(fresh_machine_image.dockerfile(false))
	})

	it('names the run and the packed tarball to the container', async () => {
		await fresh_machine_run.run(request({}))

		const run_arguments = recorded(RUN_ARGV).split('\n')

		expect(run_arguments).toContain(`RUN_NAME=${RUN_NAME}`)
		expect(run_arguments).toContain(`PACKAGE_TARBALL=/pack/${TARBALL}`)
		expect(has_recorded(VIEW_ARGV)).toBe(false)
	})

	it('stages the seed files for the container and removes them afterwards', async () => {
		await fresh_machine_run.run(request({}))

		expect(recorded('seed.ls').trim()).toBe(SEED_FILE)
		expect(existsSync(staged_seed())).toBe(false)
	})

	it('answers with the exit status of the container', async () => {
		vi.stubEnv('FAKE_RUN_EXIT', String(RUN_EXIT_CODE))

		await expect(fresh_machine_run.run(request({}))).resolves.toBe(RUN_EXIT_CODE)
	})
})

describe('fresh_machine_run.run — a host whose umask keeps files private', () => {
	it('stages the seed, its directories and the tarball readable by the container', async () => {
		const { scenario: flat } = request({})
		const scenario = { ...flat, files: { ...flat.files, [NESTED_SEED_FILE]: '\n' } }

		await run_with_private_umask(request({ scenario }))

		const modes = others(MODES)

		expect(modes).toHaveLength(STAGED_ENTRIES)
		expect(new Set(modes)).toStrictEqual(new Set([READABLE_FILE, READABLE_DIRECTORY]))
	})

	it('opens the two mounted directories and keeps the directory above them private', async () => {
		await run_with_private_umask(request({}))

		expect(others(MOUNT_MODES)).toStrictEqual([READABLE_DIRECTORY, READABLE_DIRECTORY])
		expect(others(ROOT_MODES)).toStrictEqual([PRIVATE_DIRECTORY])
	})
})

describe('fresh_machine_run.run — a machine that cannot be built', () => {
	it('stops at a failed build, before packing or running anything', async () => {
		vi.stubEnv('FAKE_BUILD_EXIT', String(BUILD_EXIT_CODE))

		await expect(fresh_machine_run.run(request({}))).resolves.toBe(BUILD_EXIT_CODE)
		expect(has_recorded(RUN_ARGV)).toBe(false)
		expect(log()).not.toContain(PACKED_LINE)
	})

	it('fails with the reason in the log when docker is not installed', async () => {
		rmSync(path.join(scratch.bin, 'docker'))
		vi.stubEnv('PATH', scratch.bin)

		await expect(fresh_machine_run.run(request({}))).resolves.toBe(1)
		expect(log()).toContain('ENOENT')
	})
})

describe('fresh_machine_run.run — the secrets', () => {
	it('reach the container through the environment, named in the arguments only', async () => {
		await fresh_machine_run.run(request({ secrets: SECRETS }))

		const run_argv = recorded(RUN_ARGV)

		expect(run_argv).not.toContain(TOKEN)
		expect(run_argv).not.toContain(CLAUDE_TOKEN)
		expect(run_argv.split('\n')).toContain('CLAUDE_CODE_OAUTH_TOKEN')
		expect(log()).toContain('token [REDACTED] claude [REDACTED]')
	})

	it('are in neither the log nor the console', async () => {
		await fresh_machine_run.run(request({ secrets: SECRETS }))

		const printed = vi.mocked(console.info).mock.calls.flat().join('\n')

		expect(log()).not.toContain(TOKEN)
		expect(log()).not.toContain(CLAUDE_TOKEN)
		expect(printed).toContain(CONTAINER_LINE)
		expect(printed).not.toContain(CLAUDE_TOKEN)
	})
})

describe('fresh_machine_run.run — a published scenario', () => {
	it('asks the registry for the latest version of the package of this checkout', async () => {
		await fresh_machine_run.run(published(undefined))

		expect(recorded(VIEW_ARGV).split('\n')).toStrictEqual(['view', PACKAGE_NAME, 'version', ''])
		expect(recorded(RUN_ARGV).split('\n')).toContain(`PACKAGE_VERSION=${LATEST_VERSION}`)
		expect(log()).toContain(`# package: ${LATEST_VERSION}`)
	})

	it('installs the version it was given without asking the registry', async () => {
		await fresh_machine_run.run(published(PINNED_VERSION))

		expect(has_recorded(VIEW_ARGV)).toBe(false)
		expect(recorded(RUN_ARGV).split('\n')).toContain(`PACKAGE_VERSION=${PINNED_VERSION}`)
		expect(log()).not.toContain(PACKED_LINE)
	})
})
