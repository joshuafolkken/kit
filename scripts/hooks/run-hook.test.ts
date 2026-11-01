import { spawnSync } from 'node:child_process'
import {
	chmodSync,
	copyFileSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	rmSync,
	writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { GIT_LOCATION_VARIABLES } from '#scripts/git/git-location-environment'
import { hook_command_bootstrap } from '#scripts/init/hook-command-bootstrap-fixture'
import { hook_launch } from '#scripts/init/hook-launch'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const RUN_HOOK_SOURCE = fileURLToPath(new URL('run-hook.sh', import.meta.url))
const REPOSITORY_ROOT = fileURLToPath(new URL('../..', import.meta.url))
const LAUNCHER = 'scripts/hooks/run-hook.sh'
const GATE = 'tools/hooks/hook-bundle-ready.ts'
const INSTALLED_PACKAGE = 'node_modules/@joshuafolkken/kit'
const REFUSED = 2
// A whole launch starts real git and node processes, which the full suite's load can slow past the
// project's default timeout.
const LAUNCH_TIMEOUT_MS = 60_000
const BUNDLE_RAN = 'bundle first second cleared'
const GATE_RAN = 'gate demo-hook demo:hook first second cleared'
const LAUNCH_LOG = 'launches.log'
// A git location variable pointing at no repository, as one inherited from another checkout's hook does.
const FOREIGN_GIT_DIR = '/elsewhere'
// Every program a hook launch could start through PATH, each logged by name when it starts.
const COUNTED_PROGRAMS = ['node', 'git', 'env', 'dirname'] as const

// Each stub reports its name, its arguments and whether the git location reached it, then exits with
// STUB_EXIT. In kit's checkout the gate is the whole launch: it runs the bundle or the fallback itself.
function stub_script(name: string): string {
	return [
		"const git_dir = process.env.GIT_DIR ?? 'cleared'",
		`process.stdout.write(\`${name} \${process.argv.slice(2).join(' ')} \${git_dir}\`)`,
		'process.exit(Number(process.env.STUB_EXIT ?? 0))',
	].join('\n')
}

const GATE_STUB = stub_script('gate')
const BUNDLE_STUB = stub_script('bundle')
const COMPILE_CACHE_NAME = 'kit-hook-compile'
const COMPILE_CACHE_STUB = "process.stdout.write(process.env.NODE_COMPILE_CACHE ?? '')\n"
const DISPATCHER_STUB = "process.stdout.write(`dispatcher ${process.argv.slice(2).join(' ')}`)\n"

interface LaunchResult {
	status: number | null
	stdout: string
	node_launches: number
	launches: Record<string, number>
}

const workspace = { root: '' }

function write_file(relative_path: string, content: string): void {
	const file_path = path.join(workspace.root, relative_path)

	mkdirSync(path.dirname(file_path), { recursive: true })
	writeFileSync(file_path, content)
}

// The launcher, its gate and a bundle under `package_root`, laid out as kit's checkout or as the
// installed package; `has_bundles: false` leaves `dist/hooks` out.
function create_package(package_root: string, has_bundles = true): void {
	const launcher_path = path.join(workspace.root, package_root, LAUNCHER)

	mkdirSync(path.dirname(launcher_path), { recursive: true })
	copyFileSync(RUN_HOOK_SOURCE, launcher_path)
	write_file(path.join(package_root, GATE), GATE_STUB)
	write_file(path.join(package_root, 'dist/josh.js'), DISPATCHER_STUB)
	if (has_bundles) write_file(path.join(package_root, 'dist/hooks/demo-hook.js'), BUNDLE_STUB)
}

// Each counted program first on PATH logs its launch by name and runs the real one off the original
// PATH, so a test can count launches.
function counting_path(): string {
	const bin_directory = path.join(workspace.root, 'bin')
	const log_path = path.join(workspace.root, LAUNCH_LOG)
	const original_path = process.env['PATH'] ?? ''

	for (const program of COUNTED_PROGRAMS) {
		write_file(
			`bin/${program}`,
			`#!/bin/sh\necho ${program} >> "${log_path}"\nPATH="${original_path}" exec ${program} "$@"\n`,
		)
		chmodSync(path.join(bin_directory, program), 0o755)
	}

	return `${bin_directory}${path.delimiter}${original_path}`
}

function count_launches(): Record<string, number> {
	const log_path = path.join(workspace.root, LAUNCH_LOG)
	const logged = existsSync(log_path) ? readFileSync(log_path, 'utf8').trim().split('\n') : []

	return Object.fromEntries(
		COUNTED_PROGRAMS.map((program) => [program, logged.filter((name) => name === program).length]),
	)
}

function run_launcher(
	command: ReadonlyArray<string>,
	cwd: string,
	overrides: NodeJS.ProcessEnv,
): LaunchResult {
	const base_environment = hook_command_bootstrap.fresh_git_environment()
	const { status, stdout } = spawnSync('sh', command, {
		cwd,
		encoding: 'utf8',
		env: { ...base_environment, PATH: counting_path(), ...overrides },
	})
	const launches = count_launches()

	return { status, stdout, node_launches: launches['node'] ?? 0, launches }
}

function launch(launcher: string, overrides: NodeJS.ProcessEnv = {}): LaunchResult {
	return run_launcher([launcher, 'demo-hook', 'first', 'second'], workspace.root, overrides)
}

// The whole hook command as settings.json holds it: the root prefix, then the launcher — launched as
// Claude Code launches it, naming the root, unless the overrides take that away.
function launch_hook_command(overrides: NodeJS.ProcessEnv = {}): LaunchResult {
	const command = hook_launch.hook_launch_command('demo-hook first second')
	const named_root = { [hook_command_bootstrap.PROJECT_DIRECTORY_VARIABLE]: workspace.root }

	return run_launcher(['-c', command], workspace.root, { ...named_root, ...overrides })
}

function initialize_repository(git_arguments: ReadonlyArray<string>): void {
	hook_command_bootstrap.initialize_repository(
		git_arguments,
		workspace.root,
		hook_command_bootstrap.fresh_git_environment(),
	)
}

beforeEach(() => {
	workspace.root = mkdtempSync(path.join(tmpdir(), 'kit-run-hook-'))
})

afterEach(() => {
	rmSync(workspace.root, { recursive: true, force: true })
})

describe('run-hook.sh in kit checkout', () => {
	beforeEach(() => {
		create_package('.')
	})

	it('hands the hook, its josh command and its arguments to the gate in one node launch', () => {
		const result = launch(LAUNCHER)

		expect(result).toMatchObject({ status: 0, stdout: GATE_RAN, node_launches: 1 })
	})

	it('passes a refusal through without launching anything else', () => {
		const result = launch(LAUNCHER, { STUB_EXIT: String(REFUSED) })

		expect(result).toMatchObject({ status: REFUSED, stdout: GATE_RAN, node_launches: 1 })
	})

	it('hands the gate a compile cache under the checkout node_modules/.cache', () => {
		write_file(GATE, COMPILE_CACHE_STUB)
		mkdirSync(path.join(workspace.root, 'node_modules'))

		const cache_directory = launch(LAUNCHER).stdout

		expect(path.basename(cache_directory)).toBe(COMPILE_CACHE_NAME)
		expect(realpathSync(path.resolve(cache_directory, '..', '..'))).toBe(
			realpathSync(path.join(workspace.root, 'node_modules')),
		)
	})
})

describe('run-hook.sh in installed package', () => {
	const installed_launcher = `./${INSTALLED_PACKAGE}/${LAUNCHER}`

	it('runs the bundle without consulting the gate', () => {
		create_package(INSTALLED_PACKAGE)

		const result = launch(installed_launcher)

		expect(result.stdout).toBe(BUNDLE_RAN)
	})

	it('runs the dispatcher when the package ships no bundles', () => {
		create_package(INSTALLED_PACKAGE, false)

		const result = launch(installed_launcher)

		expect(result.stdout).toBe('dispatcher demo:hook first second')
	})

	it('passes a refusal through without running the dispatcher', () => {
		create_package(INSTALLED_PACKAGE)

		const result = launch(installed_launcher, { STUB_EXIT: String(REFUSED) })

		expect(result).toMatchObject({ status: REFUSED, stdout: BUNDLE_RAN, node_launches: 1 })
	})
})

// joshuafolkken/kit#3946: a hook runs on every tool call, so its launch starts node once, with no
// `env` or `dirname` process around it. git starts only to find a root Claude Code did not name, or
// to decide on a git location variable that is set (joshuafolkken/kit#4187).
describe('the hook command launch', () => {
	beforeEach(() => {
		create_package('.')
		initialize_repository(['init', '-q'])
	})

	it.each([
		['the root is named', {}, 0],
		['Codex names no root', { [hook_command_bootstrap.PROJECT_DIRECTORY_VARIABLE]: undefined }, 1],
		['a git location variable is set', { GIT_DIR: FOREIGN_GIT_DIR }, 1],
	])(
		'starts node once and git as often as needed when %s',
		(_case, overrides: NodeJS.ProcessEnv, git_launches) => {
			const result = launch_hook_command(overrides)

			expect(result.stdout).toBe(GATE_RAN)
			expect(result.launches).toEqual({ node: 1, git: git_launches, env: 0, dirname: 0 })
		},
		LAUNCH_TIMEOUT_MS,
	)
})

describe('the hook command and git location variables', () => {
	beforeEach(() => {
		create_package('.')
	})

	it('clears them when the checkout resolves without them', () => {
		initialize_repository(['init', '-q'])

		const result = launch_hook_command({ GIT_DIR: FOREIGN_GIT_DIR })

		expect(result.stdout).toBe(GATE_RAN)
	})

	it('clears them for a launch from a git hook, which names no root', () => {
		initialize_repository(['init', '-q'])

		const result = launch_hook_command({
			[hook_command_bootstrap.PROJECT_DIRECTORY_VARIABLE]: undefined,
			GIT_DIR: '.git',
		})

		expect(result.stdout).toBe(GATE_RAN)
	})

	it('names in run-hook.sh every variable git-location-environment.ts lists', () => {
		const launcher = readFileSync(RUN_HOOK_SOURCE, 'utf8')

		expect(launcher).toContain(`location_variables='${GIT_LOCATION_VARIABLES.join(' ')}'`)
		expect(launcher).toContain(`"$${GIT_LOCATION_VARIABLES.join('$')}"`)
	})

	it('keeps them when the git metadata lives outside the work tree', () => {
		const metadata_root = path.join(workspace.root, 'metadata')

		initialize_repository(['init', '--bare', '-q', metadata_root])

		const result = launch_hook_command({
			GIT_DIR: metadata_root,
			GIT_WORK_TREE: workspace.root,
		})

		expect(result.stdout).toBe(`gate demo-hook demo:hook first second ${metadata_root}`)
	})
})

describe('run-hook.sh with a real hook', () => {
	it(
		'launches session-lang from the repository root with one node launch',
		() => {
			const result = run_launcher([LAUNCHER, 'session-lang'], REPOSITORY_ROOT, {
				JOSH_SESSION_LANG: 'en',
			})

			expect(result.stdout).toContain('JOSH_SESSION_LANG): en')
			expect(result.node_launches).toBe(1)
		},
		LAUNCH_TIMEOUT_MS,
	)
})
