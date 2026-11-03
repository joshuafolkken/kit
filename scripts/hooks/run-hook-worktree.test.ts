import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { claude_plugin_config } from '#scripts/init/claude-plugin-config'
import { hook_command_bootstrap } from '#scripts/init/hook-command-bootstrap-fixture'
import { hook_launch } from '#scripts/init/hook-launch'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const RUN_HOOK_SOURCE = fileURLToPath(new URL('run-hook.sh', import.meta.url))
const WORKTREE = '.claude/worktrees/agent-demo'
// Each stub prints the directory the hook runs in, which is all these tests ask about.
const CWD_STUB = 'process.stdout.write(process.cwd())\n'
const KIT_GATE = 'tools/hooks/hook-bundle-ready.ts'
const KIT_COMMAND = hook_launch.hook_launch_command('demo-hook')

const workspace = { root: '' }

function write_file(relative_path: string, content: string): void {
	const file_path = path.join(workspace.root, relative_path)

	mkdirSync(path.dirname(file_path), { recursive: true })
	writeFileSync(file_path, content)
}

// The launcher with a stub where it hands the hook over: the gate in kit's checkout, the bundle in an
// installed package.
function create_package(package_root: string, hand_over: string): void {
	const launcher_path = path.join(workspace.root, package_root, hook_launch.RUN_HOOK_SCRIPT)

	mkdirSync(path.dirname(launcher_path), { recursive: true })
	copyFileSync(RUN_HOOK_SOURCE, launcher_path)
	write_file(path.join(package_root, hand_over), CWD_STUB)
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
	const temporary_root = mkdtempSync(path.join(tmpdir(), 'kit-run-hook-worktree-'))

	workspace.root = realpathSync(temporary_root)
})

afterEach(() => {
	rmSync(workspace.root, { recursive: true, force: true })
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

	it('runs in the worktree under the unsynced command that exports the launch directory', () => {
		create_package('.', KIT_GATE)

		const unsynced_command = `export JOSH_HOOK_CWD="$PWD" && cd "$CLAUDE_PROJECT_DIR" && sh ${hook_launch.RUN_HOOK_SCRIPT} demo-hook`

		expect(hook_directory(unsynced_command, `${WORKTREE}/src`)).toBe(
			path.join(workspace.root, WORKTREE),
		)
	})

	// The launcher finds the root from its own path, so no `CLAUDE_PROJECT_DIR` is needed to reach it.
	it('runs in the project root from a subdirectory with no root named', () => {
		create_package('.', KIT_GATE)

		const absolute_command = `sh "${path.join(workspace.root, hook_launch.RUN_HOOK_SCRIPT)}" demo-hook`

		expect(hook_directory(absolute_command, 'src', false)).toBe(workspace.root)
	})

	it.each(LAUNCHES)('runs in an installed package from %s', (_case, launch_directory, expected) => {
		create_package(claude_plugin_config.MARKETPLACE_PATH, 'dist/hooks/demo-hook.js')
		write_file(path.join(claude_plugin_config.MARKETPLACE_PATH, 'package.json'), '{}\n')

		expect(
			hook_directory(hook_command_bootstrap.consumer_command(KIT_COMMAND), launch_directory),
		).toBe(path.join(workspace.root, expected))
	})
})
