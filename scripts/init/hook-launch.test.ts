import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { claude_settings_fixture } from '#scripts/claude/claude-settings-fixture'
import { temporary_directory } from '#tools/test/temporary-directory'
import { describe, expect, it } from 'vitest'
import { hook_command_bootstrap } from './hook-command-bootstrap-fixture'
import { hook_launch } from './hook-launch'

const { CLAUDE_ROOT, codex_command, CODEX_ROOT, hook_launch_command, RUN_HOOK_SCRIPT } = hook_launch

// Run from the root, the probe prints that the root expression named it.
const AT_ROOT = 'at root'
const ROOT_PROBE = `test -f .git/HEAD || test -d metadata && echo ${AT_ROOT}`
const PRETOOL_GUARD = 'pretool-guard'
const LEAKED_GIT_DIRECTORIES = ['.git', '/elsewhere'] as const
// The root each agent's hook command names, and whether the agent names it in `CLAUDE_PROJECT_DIR`.
const AGENTS: ReadonlyArray<readonly [string, string, boolean]> = [
	['Claude Code', CLAUDE_ROOT, true],
	['Codex', CODEX_ROOT, false],
]

// The four settings.json hooks, each named by its bundle under `dist/hooks`.
const HOOKS = [PRETOOL_GUARD, 'format-edited', 'session-lang', 'stop-guard'] as const

const make_directory = temporary_directory()

function command_containing(fragment: string): string {
	const { hooks } = claude_settings_fixture.load_settings()
	const events = [hooks.UserPromptSubmit, hooks.PreToolUse, hooks.PostToolUse, hooks.Stop]
	const commands = events
		.flatMap((matchers) => matchers ?? [])
		.flatMap((entry) => entry.hooks.map((handler) => handler.command))
	const found = commands.find((command) => command.endsWith(` ${fragment}`))
	if (found === undefined) throw new Error(`no hook command launches ${fragment}`)

	return found
}

type CheckoutOptions = Parameters<typeof hook_command_bootstrap.run_in_temporary_checkout>[3]

function probe_from_subdirectory(root: string, options: CheckoutOptions): string {
	const result = hook_command_bootstrap.run_in_temporary_checkout(
		`cd "${root}" && ${ROOT_PROBE}`,
		false,
		true,
		options,
	)

	return result.stdout.trim()
}

describe('hook_launch_command', () => {
	it('names the launcher under the root Claude Code names and hands it the hook name', () => {
		expect(hook_launch_command(PRETOOL_GUARD)).toBe(
			`sh "$CLAUDE_PROJECT_DIR/${RUN_HOOK_SCRIPT}" ${PRETOOL_GUARD}`,
		)
	})

	it('names the launcher under the root git resolves for Codex', () => {
		expect(codex_command(hook_launch_command(PRETOOL_GUARD))).toBe(
			hook_launch_command(PRETOOL_GUARD, CODEX_ROOT),
		)
	})
})

// joshuafolkken/kit#2984: a hook fired from a subdirectory has to reach the root rather than stay where
// the session stands — the root Claude Code names, or git's where Codex names none (joshuafolkken/kit#4187).
describe('the root a hook command names', () => {
	it.each(AGENTS)('is the root from a project subdirectory under %s', (_agent, root, is_named) => {
		expect(probe_from_subdirectory(root, { is_project_directory_named: is_named })).toBe(AT_ROOT)
	})

	it.each(AGENTS)(
		'is the work tree when Git metadata is outside it under %s',
		(_agent, root, is_named) => {
			const options = { is_external_git: true, is_project_directory_named: is_named }

			expect(probe_from_subdirectory(root, options)).toBe(AT_ROOT)
		},
	)

	// A git hook in a subdirectory leaks a `GIT_DIR` that names no repository from there: the checkout's
	// own `.git`, relative, or another checkout's.
	it.each(LEAKED_GIT_DIRECTORIES)(
		'is the root under Codex despite a leaked GIT_DIR of %s',
		(git_directory) => {
			const options = { git_overrides: { GIT_DIR: git_directory } }

			expect(probe_from_subdirectory(CODEX_ROOT, options)).toBe(AT_ROOT)
		},
	)
})

describe('a Codex hook fired outside any checkout', () => {
	it('fails without launching a hook when no root resolves', () => {
		const outside = make_directory('kit-hook-outside-')
		const command = codex_command(hook_launch_command(PRETOOL_GUARD))
		const result = spawnSync('sh', ['-c', command], {
			cwd: outside,
			encoding: 'utf8',
			env: {
				...hook_command_bootstrap.fresh_git_environment(),
				GIT_CEILING_DIRECTORIES: path.dirname(outside),
			},
		})

		expect(result.status).not.toBe(0)
		expect(result.stdout).toBe('')
	})
})

// kit's own settings.json launches each hook with the generated command: a hand-edit that drifts from
// `hook_launch_command` is caught here rather than shipping a command the launcher no longer matches.
describe("kit's own settings.json", () => {
	it('launches each hook with the generated command', () => {
		for (const name of HOOKS) {
			expect(command_containing(name)).toBe(hook_launch_command(name))
		}
	})
})
