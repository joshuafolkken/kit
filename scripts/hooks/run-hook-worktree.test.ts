import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync, realpathSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { claude_plugin_config } from '#scripts/init/claude-plugin-config'
import { hook_command_bootstrap } from '#scripts/init/hook-command-bootstrap-fixture'
import { hook_launch } from '#scripts/init/hook-launch'
import { temporary_directory } from '#tools/test/temporary-directory'
import { write_file } from '#tools/test/write-file'
import { beforeEach, describe, expect, it } from 'vitest'

const make_directory = temporary_directory()
const RUN_HOOK_SOURCE = fileURLToPath(new URL('run-hook.sh', import.meta.url))
const WORKTREE = '.claude/worktrees/agent-demo'
// Each stub prints the directory the hook runs in, which is all these tests ask about.
const CWD_STUB = 'process.stdout.write(process.cwd())\n'
const KIT_GATE = 'tools/hooks/hook-bundle-ready.ts'
const KIT_COMMAND = hook_launch.hook_launch_command('demo-hook')
const INSTALLED_BUNDLE = 'dist/hooks/demo-hook.js'

const workspace = { root: '' }

// The launcher with a stub where it hands the hook over: the gate in kit's checkout, the bundle in an
// installed package.
function create_package(package_root: string, hand_over: string): void {
	const launcher_path = path.join(workspace.root, package_root, hook_launch.RUN_HOOK_SCRIPT)

	mkdirSync(path.dirname(launcher_path), { recursive: true })
	copyFileSync(RUN_HOOK_SOURCE, launcher_path)
	write_file(workspace.root, path.join(package_root, hand_over), CWD_STUB)
}

// Launched as Claude Code launches a hook inside one of its worktrees: from where the session stands,
// with `CLAUDE_PROJECT_DIR` still naming the main checkout unless `is_root_named` is false.
function hook_directory(command: string, launch_directory: string, is_root_named = true): string {
	const cwd = path.join(workspace.root, launch_directory)
	const named_root = { [hook_command_bootstrap.PROJECT_DIRECTORY_VARIABLE]: workspace.root }

	mkdirSync(cwd, { recursive: true })

	const { stdout } = spawnSync('sh', ['-c', command], {
		cwd,
		encoding: 'utf8',
		env: {
			...hook_command_bootstrap.fresh_git_environment(),
			...(is_root_named && named_root),
			PWD: cwd,
		},
	})

	return stdout
}

beforeEach(() => {
	const temporary_root = make_directory('kit-run-hook-worktree-')

	workspace.root = realpathSync(temporary_root)
})

const LAUNCHES: ReadonlyArray<readonly [string, string, string]> = [
	['the worktree root', WORKTREE, WORKTREE],
	['a worktree subdirectory', `${WORKTREE}/src`, WORKTREE],
	['a project subdirectory', 'src', ''],
	['the project root', '', ''],
]

// joshuafolkken/kit#4617: inside `EnterWorktree` or an `isolation: "worktree"` subagent the hook runs in
// that worktree, with its code still taken from the main checkout.
describe('a hook launched inside a Claude Code worktree', () => {
	it.each(LAUNCHES)('runs in kit checkout from %s', (_case, launch_directory, expected) => {
		create_package('.', KIT_GATE)

		expect(hook_directory(KIT_COMMAND, launch_directory)).toBe(path.join(workspace.root, expected))
	})

	// A consumer's settings file keeps the command from before joshuafolkken/kit#6033 until its next
	// sync: it moves to the root itself and names the launcher relative to it.
	it('runs in the project root under the command an unsynced settings file carries', () => {
		create_package('.', KIT_GATE)

		const unsynced_command = `cd "$CLAUDE_PROJECT_DIR" && sh ${hook_launch.RUN_HOOK_SCRIPT} demo-hook`

		expect(hook_directory(unsynced_command, 'src')).toBe(workspace.root)
	})

	// The launcher finds the root from its own path, so no `CLAUDE_PROJECT_DIR` is needed to reach it.
	it('runs in the project root from a subdirectory with no root named', () => {
		create_package('.', KIT_GATE)

		const absolute_command = `sh "${path.join(workspace.root, hook_launch.RUN_HOOK_SCRIPT)}" demo-hook`

		expect(hook_directory(absolute_command, 'src', false)).toBe(workspace.root)
	})

	it.each(LAUNCHES)('runs in an installed package from %s', (_case, launch_directory, expected) => {
		create_package(claude_plugin_config.MARKETPLACE_PATH, INSTALLED_BUNDLE)
		write_file(
			workspace.root,
			path.join(claude_plugin_config.MARKETPLACE_PATH, 'package.json'),
			'{}\n',
		)

		expect(
			hook_directory(hook_command_bootstrap.consumer_command(KIT_COMMAND), launch_directory),
		).toBe(path.join(workspace.root, expected))
	})
})

const EXPORTING_PREFIX = 'export JOSH_HOOK_CWD="$PWD" && cd "$CLAUDE_PROJECT_DIR" && sh '
const UNSYNCED_LAUNCHES: ReadonlyArray<readonly [string, string, string]> = [
	['kit checkout', '.', KIT_GATE],
	['an installed package', claude_plugin_config.MARKETPLACE_PATH, INSTALLED_BUNDLE],
]

// The command from before joshuafolkken/kit#6033 exports the launch directory and moves to the root
// before the launcher runs; the launcher keeps that launch directory.
describe('a hook launched by an unsynced command that exports the launch directory', () => {
	it.each(UNSYNCED_LAUNCHES)('runs in the worktree in %s', (_case, package_root, hand_over) => {
		create_package(package_root, hand_over)

		const launcher = path.join(package_root, hook_launch.RUN_HOOK_SCRIPT)
		const command = `${EXPORTING_PREFIX}./${launcher} demo-hook`

		expect(hook_directory(command, `${WORKTREE}/src`)).toBe(path.join(workspace.root, WORKTREE))
	})
})

describe('a hook in a project checked out under a directory named node_modules', () => {
	it('runs in that project root', () => {
		const project = 'node_modules/app'
		const package_root = path.join(project, claude_plugin_config.MARKETPLACE_PATH)

		create_package(package_root, INSTALLED_BUNDLE)

		const launcher = path.join(workspace.root, package_root, hook_launch.RUN_HOOK_SCRIPT)

		expect(hook_directory(`sh "${launcher}" demo-hook`, project, false)).toBe(
			path.join(workspace.root, project),
		)
	})
})
