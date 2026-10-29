import { mkdirSync, realpathSync, rmSync } from 'node:fs'
import path from 'node:path'
import { git_common_directory } from '#scripts/git/git-common-directory'
import { detached_launch } from '#scripts/run/detached-launch'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { agent_role_profile } from './agent-role-profile'
import { agent_safe_text } from './agent-safe-text'
import { codex_agent_argv } from './codex-agent-argv'

const FIXTURE = path.join(process.cwd(), 'node_modules', '.cache', 'codex-argv-safety-test')
const COMMON = path.join(FIXTURE, 'long 日本語 path.with.dots "quoted"', '.git')
const WORKTREE_COUNT = 40
const LONG_NAME_LENGTH = 100
const INVOCATION = 'Validate the launcher fixture only'

const repository_directory = vi.spyOn(git_common_directory, 'repository')

afterEach(() => {
	repository_directory.mockReset()
	rmSync(FIXTURE, { force: true, recursive: true })
})

function registered_worktrees(): string {
	for (let index = 0; index < WORKTREE_COUNT; index += 1) {
		const name = `${String(index)}-${'x'.repeat(LONG_NAME_LENGTH)}`

		mkdirSync(path.join(COMMON, 'worktrees', name), { recursive: true })
	}

	repository_directory.mockReturnValue(COMMON)

	return realpathSync(COMMON)
}

describe('Codex permission arguments at the shared launcher boundary', () => {
	it.each(Object.values(agent_role_profile.OPENAI_PROFILES))(
		'accepts a $role vector with many long registered worktree paths',
		(profile) => {
			registered_worktrees()
			const argv = codex_agent_argv.build(INVOCATION, profile, FIXTURE)
			const permissions = argv.args.filter((value) => value.startsWith('permissions.'))

			expect(permissions.join('').length).toBeGreaterThan(agent_safe_text.MAX_VALUE_LENGTH)
			expect(detached_launch.is_safe_argv(argv)).toBe(true)
		},
	)
})
