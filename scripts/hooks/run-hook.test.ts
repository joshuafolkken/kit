import { spawnSync } from 'node:child_process'
import {
	chmodSync,
	copyFileSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { hook_command_bootstrap } from '#scripts/init/hook-command-bootstrap-fixture'
import { hook_launch } from '#scripts/init/hook-launch'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const RUN_HOOK_SOURCE = fileURLToPath(new URL('run-hook.sh', import.meta.url))
const REPOSITORY_ROOT = fileURLToPath(new URL('../..', import.meta.url))
const LAUNCHER = 'scripts/hooks/run-hook.sh'
const INSTALLED_PACKAGE = 'node_modules/@joshuafolkken/kit'
const REFUSED = 2
const REAL_HOOK_TIMEOUT_MS = 60_000
const BUNDLE_RAN = 'bundle first second cleared'
const GATE_RAN = 'gate demo-hook demo:hook first second cleared'
const LAUNCH_LOG = 'launches.log'
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
	write_file(path.join(package_root, 'scripts/hooks/hook-bundle-ready.ts'), GATE_STUB)
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

// The whole hook command as settings.json holds it: the root prefix, then the launcher.
function launch_hook_command(overrides: NodeJS.ProcessEnv = {}): LaunchResult {
	const command = hook_launch.hook_launch_command('demo-hook first second')

	return run_launcher(['-c', command], workspace.root, overrides)
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

// joshuafolkken/kit#3946: a hook runs on every tool call, so its launch starts git once — the root
// lookup — and node once, with no `env` or `dirname` process around them.
describe('the hook command launch', () => {
	it('starts git once and node once', () => {
		create_package('.')
		initialize_repository(['init', '-q'])

		const result = launch_hook_command()

		expect(result.stdout).toBe(GATE_RAN)
		expect(result.launches).toEqual({ node: 1, git: 1, env: 0, dirname: 0 })
	})
})

describe('the hook command and git location variables', () => {
	beforeEach(() => {
		create_package('.')
	})

	it('clears them when the checkout resolves without them', () => {
		initialize_repository(['init', '-q'])

		const result = launch_hook_command({ GIT_DIR: '/elsewhere' })

		expect(result.stdout).toBe(GATE_RAN)
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
		REAL_HOOK_TIMEOUT_MS,
	)
})
