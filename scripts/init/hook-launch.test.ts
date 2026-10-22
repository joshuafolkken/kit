import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { claude_settings_fixture } from '#scripts/claude/claude-settings-fixture'
import { describe, expect, it } from 'vitest'
import { hook_command_bootstrap } from './hook-command-bootstrap-fixture'
import { hook_launch } from './hook-launch'

const { hook_launch_command, PROJECT_ROOT_PREFIX, RUN_HOOK_SCRIPT } = hook_launch

// Run from the root, the probe prints that the prefix landed there.
const AT_ROOT = 'at root'
const ROOT_PROBE = `test -f .git/HEAD || test -d metadata && echo ${AT_ROOT}`
const PRETOOL_GUARD = 'pretool-guard'
const LEAKED_GIT_DIRECTORIES = ['.git', '/elsewhere'] as const
// Whether each agent names the project root for a hook command.
const AGENTS: ReadonlyArray<readonly [string, boolean]> = [
	['Claude Code', true],
	['Codex', false],
]

// The four settings.json hooks, each named by its bundle under `dist/hooks`.
const HOOKS = [PRETOOL_GUARD, 'format-edited', 'session-lang', 'stop-guard'] as const

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

describe('hook_launch_command', () => {
	it('starts from the project root and hands the hook name to the launcher', () => {
		expect(hook_launch_command(PRETOOL_GUARD)).toBe(
			`${PROJECT_ROOT_PREFIX}sh ${RUN_HOOK_SCRIPT} ${PRETOOL_GUARD}`,
		)
	})
})

function probe_from_subdirectory(
	is_project_directory_named: boolean,
	is_external_git = false,
): string {
	const result = hook_command_bootstrap.run_in_temporary_checkout(
		`${PROJECT_ROOT_PREFIX}${ROOT_PROBE}`,
		false,
		true,
		{ is_external_git, is_project_directory_named },
	)

	return result.stdout.trim()
}

// joshuafolkken/kit#2984: every path after the prefix is relative, so a hook fired from a subdirectory
// has to reach the root rather than stay where the session stands — the root Claude Code names, or
// git's where Codex names none (joshuafolkken/kit#4187).
describe('the project-root prefix', () => {
	it.each(AGENTS)('moves to the root from a project subdirectory under %s', (_agent, is_named) => {
		expect(probe_from_subdirectory(is_named)).toBe(AT_ROOT)
	})

	it.each(AGENTS)(
		'moves to the work tree when Git metadata is outside it under %s',
		(_agent, is_named) => {
			expect(probe_from_subdirectory(is_named, true)).toBe(AT_ROOT)
		},
	)

	// A git hook in a subdirectory leaks a `GIT_DIR` that names no repository from there: the checkout's
	// own `.git`, relative, or another checkout's.
	it.each(LEAKED_GIT_DIRECTORIES)(
		'moves to the root under Codex despite a leaked GIT_DIR of %s',
		(git_directory) => {
			const result = hook_command_bootstrap.run_in_temporary_checkout(
				`${PROJECT_ROOT_PREFIX}${ROOT_PROBE}`,
				false,
				true,
				{ git_overrides: { GIT_DIR: git_directory } },
			)

			expect(result.stdout.trim()).toBe(AT_ROOT)
		},
	)
})

describe('a hook fired outside any checkout', () => {
	it('stops before the launcher when no root resolves', () => {
		const outside = mkdtempSync(path.join(tmpdir(), 'kit-hook-outside-'))

		try {
			const result = spawnSync('sh', ['-c', `${PROJECT_ROOT_PREFIX}echo launched`], {
				cwd: outside,
				encoding: 'utf8',
				env: {
					...hook_command_bootstrap.fresh_git_environment(),
					GIT_CEILING_DIRECTORIES: tmpdir(),
				},
			})

			expect(result.status).not.toBe(0)
			expect(result.stdout).toBe('')
		} finally {
			rmSync(outside, { recursive: true, force: true })
		}
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
