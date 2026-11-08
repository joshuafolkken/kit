import path from 'node:path'
import { temporary_directory } from '#tools/test/temporary-directory'
import { describe, expect, it, vi } from 'vitest'
import { hook_command_bootstrap } from './hook-command-bootstrap-fixture'
import { hook_launch } from './hook-launch'
import { transform_copied_content } from './init-copy-content'

const { consumer_command, run_in_temporary_checkout } = hook_command_bootstrap
const SETTINGS_DESTINATION = path.join('.claude', 'settings.json')
const CODEX_HOOKS_DESTINATION = path.join('.codex', 'hooks.json')
const KIT_LAUNCHER_COMMAND = hook_launch.hook_launch_command('pretool-guard')
const CODEX_LAUNCHER_COMMAND = hook_launch.codex_command(KIT_LAUNCHER_COMMAND)
const PRETOOL_SOURCE = '{"command": "pnpm josh pretool:guard"}'
const INSTALL_NOTICE = 'run pnpm install, then reread CLAUDE.md'
const GUARD_OUTPUT = 'guard ran'
const FOREIGN_DIRECTORY_PREFIX = 'kit-hook-foreign-'

const make_directory = temporary_directory()

function expect_guard_ran(result: ReturnType<typeof run_in_temporary_checkout>): void {
	expect(result.status).toBe(0)
	expect(result.stdout).toBe(GUARD_OUTPUT)
	expect(result.stderr).not.toContain(INSTALL_NOTICE)
}

describe('the temporary checkout', () => {
	it('initializes when GIT_DIR points elsewhere', () => {
		const foreign_root = make_directory(FOREIGN_DIRECTORY_PREFIX)

		vi.stubEnv('GIT_DIR', path.join(foreign_root, '.git'))

		try {
			const result = run_in_temporary_checkout(
				'test -d .git && git rev-parse --is-inside-work-tree',
			)

			expect(result.status).toBe(0)
			expect(result.stdout.trim()).toBe('true')
		} finally {
			vi.unstubAllEnvs()
		}
	})
})

describe('bootstrap without installed dependencies', () => {
	it.each([SETTINGS_DESTINATION, CODEX_HOOKS_DESTINATION])(
		'lets bootstrap proceed with a clear notice when %s has no installed kit',
		(destination) => {
			const { command } = JSON.parse(transform_copied_content(destination, PRETOOL_SOURCE)) as {
				command: string
			}
			const result = run_in_temporary_checkout(command, false, false, {
				is_project_directory_named: destination === SETTINGS_DESTINATION,
			})

			expect(result.status).toBe(0)
			expect(result.stderr).toContain(INSTALL_NOTICE)
			expect(result.stderr).not.toContain('Cannot find module')
		},
	)

	it('runs a present hook bundle even if the dispatcher is missing', () => {
		expect_guard_ran(
			run_in_temporary_checkout(consumer_command(KIT_LAUNCHER_COMMAND), true, false, {
				is_project_directory_named: true,
			}),
		)
	})
})

describe('installed hook from a project subdirectory', () => {
	it.each([
		['Claude Code', consumer_command(KIT_LAUNCHER_COMMAND), true],
		['Codex', consumer_command(CODEX_LAUNCHER_COMMAND, true), false],
	])(
		'runs the hook bundle under %s instead of reporting an inactive installation',
		(_agent, command, is_project_directory_named) => {
			expect_guard_ran(
				run_in_temporary_checkout(command, true, true, { is_project_directory_named }),
			)
		},
	)
})

describe('installed hook with Git located elsewhere', () => {
	// A named root outranks a leaked `GIT_WORK_TREE`; without one, git is asked with it unset.
	it('runs the hook bundle when Git points to another work tree under Claude Code', () => {
		const foreign_root = make_directory(FOREIGN_DIRECTORY_PREFIX)

		expect_guard_ran(
			run_in_temporary_checkout(consumer_command(KIT_LAUNCHER_COMMAND), true, true, {
				git_overrides: { GIT_WORK_TREE: foreign_root },
				is_project_directory_named: true,
			}),
		)
	})

	it('runs the hook bundle under Codex when Git metadata is outside the work tree', () => {
		expect_guard_ran(
			run_in_temporary_checkout(consumer_command(CODEX_LAUNCHER_COMMAND, true), true, true, {
				is_external_git: true,
			}),
		)
	})
})
