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
import { GIT_LOCATION_VARIABLES } from '#scripts/git/git-location-environment'
import { hook_command_bootstrap } from '#scripts/init/hook-command-bootstrap-fixture'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const RUN_HOOK_SOURCE = fileURLToPath(new URL('run-hook.sh', import.meta.url))
const REPOSITORY_ROOT = fileURLToPath(new URL('../..', import.meta.url))
const LAUNCHER = 'scripts/hooks/run-hook.sh'
const INSTALLED_PACKAGE = 'node_modules/@joshuafolkken/kit'
const REFUSED = 2
const REAL_HOOK_TIMEOUT_MS = 60_000
const BUNDLE_RAN = 'bundle first second cleared'
const GATE_RAN = 'gate demo-hook demo:hook first second cleared'
const NODE_LOG = 'node-launches.log'

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

// A `node` first on PATH that logs each launch and runs the real one, so a test can count launches.
function counting_node_path(): string {
	const bin_directory = path.join(workspace.root, 'bin')
	const log_path = path.join(workspace.root, NODE_LOG)

	write_file(
		'bin/node',
		`#!/bin/sh\necho launch >> "${log_path}"\nexec "${process.execPath}" "$@"\n`,
	)
	chmodSync(path.join(bin_directory, 'node'), 0o755)

	return `${bin_directory}${path.delimiter}${process.env['PATH'] ?? ''}`
}

function count_node_launches(): number {
	const log_path = path.join(workspace.root, NODE_LOG)
	if (!existsSync(log_path)) return 0

	return readFileSync(log_path, 'utf8').trim().split('\n').length
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
		env: { ...base_environment, PATH: counting_node_path(), ...overrides },
	})

	return { status, stdout, node_launches: count_node_launches() }
}

function launch(launcher: string, overrides: NodeJS.ProcessEnv = {}): LaunchResult {
	return run_launcher([launcher, 'demo-hook', 'first', 'second'], workspace.root, overrides)
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

		expect(result).toEqual({ status: 0, stdout: GATE_RAN, node_launches: 1 })
	})

	it('passes a refusal through without launching anything else', () => {
		const result = launch(LAUNCHER, { STUB_EXIT: String(REFUSED) })

		expect(result).toEqual({ status: REFUSED, stdout: GATE_RAN, node_launches: 1 })
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

		expect(result).toEqual({ status: REFUSED, stdout: BUNDLE_RAN, node_launches: 1 })
	})
})

describe('run-hook.sh git location variables', () => {
	beforeEach(() => {
		create_package('.')
	})

	it('clears them when the checkout resolves without them', () => {
		initialize_repository(['init', '-q'])

		const result = launch(LAUNCHER, { GIT_DIR: '/elsewhere' })

		expect(result.stdout).toBe(GATE_RAN)
	})

	it('keeps them when the git metadata lives outside the work tree', () => {
		const metadata_root = path.join(workspace.root, 'metadata')

		initialize_repository(['init', '--bare', '-q', metadata_root])

		const result = launch(LAUNCHER, { GIT_DIR: metadata_root, GIT_WORK_TREE: workspace.root })

		expect(result.stdout).toBe(`gate demo-hook demo:hook first second ${metadata_root}`)
	})

	it('lists the same names as GIT_LOCATION_VARIABLES', () => {
		const script = readFileSync(RUN_HOOK_SOURCE, 'utf8')
		const listed = /^location_variables='(?<names>[^']*)'$/mu.exec(script)?.groups?.['names']

		expect(listed?.split(' ')).toEqual([...GIT_LOCATION_VARIABLES])
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
