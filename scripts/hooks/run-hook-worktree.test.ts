import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { claude_plugin_config } from '#scripts/init/claude-plugin-config'
import { hook_command_bootstrap } from '#scripts/init/hook-command-bootstrap-fixture'
import { hook_command_rewrite } from '#scripts/init/hook-command-rewrite'
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

// The command a consumer's settings.json carries once kit's sync has rewritten it.
function consumer_command(): string {
	const settings = hook_command_rewrite.rewrite_hook_commands(
		JSON.stringify({ command: KIT_COMMAND }),
	)
	const { command } = JSON.parse(settings) as { command: string }

	return command
}

// Launched as Claude Code launches a hook inside one of its worktrees: from where the session stands,
// with `CLAUDE_PROJECT_DIR` still naming the main checkout.
function hook_directory(command: string, launch_directory: string): string {
	const cwd = path.join(workspace.root, launch_directory)

	mkdirSync(cwd, { recursive: true })

	const { stdout } = spawnSync('sh', ['-c', command], {
		cwd,
		encoding: 'utf8',
		env: {
			...hook_command_bootstrap.fresh_git_environment(),
			[hook_command_bootstrap.PROJECT_DIRECTORY_VARIABLE]: workspace.root,
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

	it('runs in the worktree when the launcher is named by an absolute path', () => {
		create_package('.', KIT_GATE)

		const launcher = path.join(workspace.root, hook_launch.RUN_HOOK_SCRIPT)
		const absolute_command = `${hook_launch.PROJECT_ROOT_PREFIX}sh ${launcher} demo-hook`

		expect(hook_directory(absolute_command, WORKTREE)).toBe(path.join(workspace.root, WORKTREE))
	})

	it.each(LAUNCHES)('runs in an installed package from %s', (_case, launch_directory, expected) => {
		create_package(claude_plugin_config.MARKETPLACE_PATH, 'dist/hooks/demo-hook.js')
		write_file(path.join(claude_plugin_config.MARKETPLACE_PATH, 'package.json'), '{}\n')

		expect(hook_directory(consumer_command(), launch_directory)).toBe(
			path.join(workspace.root, expected),
		)
	})
})
