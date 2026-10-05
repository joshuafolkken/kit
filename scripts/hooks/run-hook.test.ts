import { spawnSync } from 'node:child_process'
import {
	chmodSync,
	copyFileSync,
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
const FAILED = 1
const REAL_HOOK_TIMEOUT_MS = 60_000
const BUNDLE_RAN = 'bundle first second cleared'

// The stub gate exits with STUB_GATE; the stub bundle reports its arguments and whether the git
// location reached it, then exits with STUB_EXIT.
const GATE_STUB = 'process.exit(Number(process.env.STUB_GATE ?? 0))\n'
const BUNDLE_STUB = [
	"const git_dir = process.env.GIT_DIR ?? 'cleared'",
	"process.stdout.write(`bundle ${process.argv.slice(2).join(' ')} ${git_dir}`)",
	'process.exit(Number(process.env.STUB_EXIT ?? 0))',
].join('\n')
const DISPATCHER_STUB = "process.stdout.write(`dispatcher ${process.argv.slice(2).join(' ')}`)\n"
const PNPM_STUB = '#!/bin/sh\necho "pnpm $*"\n'

interface LaunchResult {
	status: number | null
	stdout: string
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

function stub_pnpm(): string {
	const bin_directory = path.join(workspace.root, 'bin')

	write_file('bin/pnpm', PNPM_STUB)
	chmodSync(path.join(bin_directory, 'pnpm'), 0o755)

	return bin_directory
}

function launch(launcher: string, overrides: NodeJS.ProcessEnv = {}): LaunchResult {
	const base_environment = hook_command_bootstrap.fresh_git_environment()
	const search_path = `${stub_pnpm()}${path.delimiter}${process.env['PATH'] ?? ''}`
	const { status, stdout } = spawnSync('sh', [launcher, 'demo-hook', 'first', 'second'], {
		cwd: workspace.root,
		encoding: 'utf8',
		env: { ...base_environment, PATH: search_path, ...overrides },
	})

	return { status, stdout }
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

	it('runs the bundle with the hook arguments when the gate passes', () => {
		const result = launch(LAUNCHER)

		expect(result).toEqual({ status: 0, stdout: BUNDLE_RAN })
	})

	it('falls back to the josh command when the gate fails', () => {
		const result = launch(LAUNCHER, { STUB_GATE: String(FAILED) })

		expect(result.stdout.trim()).toBe('pnpm josh demo:hook first second')
	})

	it('passes a refusal through without running the fallback', () => {
		const result = launch(LAUNCHER, { STUB_EXIT: String(REFUSED) })

		expect(result).toEqual({ status: REFUSED, stdout: BUNDLE_RAN })
	})
})

describe('run-hook.sh in installed package', () => {
	const installed_launcher = `./${INSTALLED_PACKAGE}/${LAUNCHER}`

	it('runs the bundle without consulting the gate', () => {
		create_package(INSTALLED_PACKAGE)

		const result = launch(installed_launcher, { STUB_GATE: String(FAILED) })

		expect(result.stdout).toBe(BUNDLE_RAN)
	})

	it('runs the dispatcher when the package ships no bundles', () => {
		create_package(INSTALLED_PACKAGE, false)

		const result = launch(installed_launcher)

		expect(result.stdout).toBe('dispatcher demo:hook first second')
	})
})

describe('run-hook.sh git location variables', () => {
	beforeEach(() => {
		create_package('.')
	})

	it('clears them when the checkout resolves without them', () => {
		initialize_repository(['init', '-q'])

		const result = launch(LAUNCHER, { GIT_DIR: '/elsewhere' })

		expect(result.stdout).toBe(BUNDLE_RAN)
	})

	it('keeps them when the git metadata lives outside the work tree', () => {
		const metadata_root = path.join(workspace.root, 'metadata')

		initialize_repository(['init', '--bare', '-q', metadata_root])

		const result = launch(LAUNCHER, { GIT_DIR: metadata_root, GIT_WORK_TREE: workspace.root })

		expect(result.stdout).toBe(`bundle first second ${metadata_root}`)
	})

	it('lists the same names as GIT_LOCATION_VARIABLES', () => {
		const script = readFileSync(RUN_HOOK_SOURCE, 'utf8')
		const listed = /^location_variables='(?<names>[^']*)'$/mu.exec(script)?.groups?.['names']

		expect(listed?.split(' ')).toEqual([...GIT_LOCATION_VARIABLES])
	})
})

describe('run-hook.sh with a real hook', () => {
	it(
		'launches session-lang from the repository root',
		() => {
			const { stdout } = spawnSync('sh', [LAUNCHER, 'session-lang'], {
				cwd: REPOSITORY_ROOT,
				encoding: 'utf8',
				env: { ...hook_command_bootstrap.fresh_git_environment(), JOSH_SESSION_LANG: 'en' },
			})

			expect(stdout).toContain('JOSH_SESSION_LANG): en')
		},
		REAL_HOOK_TIMEOUT_MS,
	)
})
