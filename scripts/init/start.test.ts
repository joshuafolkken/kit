import { beforeEach, describe, expect, it, vi } from 'vitest'
import { project_profile, type ProjectShape } from './project-profile'
import { start } from './start'
import { start_prompt } from './start-prompt'
import { start_steps } from './start-steps'

const SHAPE: ProjectShape = {
	profile: 'basic',
	reason: 'test',
	has_web: true,
	has_typescript: false,
	has_git: false,
	has_github: false,
}
const SELF_RUN_REFUSAL = 'Refusing to sync'
const NO_GIT = {
	has_git: false,
	has_github: false,
	has_origin: false,
	branch: undefined,
	has_commits: false,
}

beforeEach(() => {
	vi.restoreAllMocks()
	vi.spyOn(project_profile, 'inspect_project').mockReturnValue(SHAPE)
	vi.spyOn(start_steps, 'read_git_state').mockReturnValue(NO_GIT)
	vi.spyOn(start_steps, 'self_run_refusal').mockReturnValue(undefined)
	vi.spyOn(start_steps, 'github_cli_refusal').mockReturnValue(undefined)
	vi.spyOn(start_steps, 'run_steps').mockImplementation(() => undefined)
	vi.spyOn(start_prompt, 'confirm_choices').mockResolvedValue('basic')
	vi.spyOn(console, 'info').mockImplementation(() => undefined)
	vi.spyOn(console, 'error').mockImplementation(() => undefined)
})

describe('josh start', () => {
	it('stops before any step when --yes is given without --github', async () => {
		expect(await start.run(['--yes'], false)).toBe(1)
		expect(start_steps.run_steps).not.toHaveBeenCalled()
		expect(console.error).toHaveBeenCalledWith(expect.stringContaining('Add --github'))
	})

	it('runs every step unattended with --yes, --github and a profile', async () => {
		expect(await start.run(['--yes', '--github', '--profile', 'full'], false)).toBe(0)
		expect(start_prompt.confirm_choices).not.toHaveBeenCalled()
		expect(start_steps.run_steps).toHaveBeenCalledWith(
			['git_init', 'initialize', 'commit', 'repository', 'labels'],
			expect.objectContaining({ profile: 'full', visibility: 'private' }),
		)
	})

	it('offers the detected profile as the default at a terminal', async () => {
		expect(await start.run([], true)).toBe(0)
		expect(start_prompt.confirm_choices).toHaveBeenCalledWith(
			expect.objectContaining({ shape: SHAPE, consent: 'ask' }),
		)
	})
})

describe('josh start stops and protects existing state', () => {
	it('stops before any step inside the kit source repository', async () => {
		vi.mocked(start_steps.self_run_refusal).mockReturnValue(SELF_RUN_REFUSAL)

		expect(await start.run(['--yes', '--github'], false)).toBe(1)
		expect(start_steps.run_steps).not.toHaveBeenCalled()
		expect(console.error).toHaveBeenCalledWith(SELF_RUN_REFUSAL)
	})

	it('stops before any step when gh is not ready', async () => {
		vi.mocked(start_steps.github_cli_refusal).mockReturnValue('run gh auth login')

		expect(await start.run(['--yes', '--github'], false)).toBe(1)
		expect(start_steps.run_steps).not.toHaveBeenCalled()
	})

	it('stops before any step when the user declines at the terminal', async () => {
		vi.mocked(start_prompt.confirm_choices).mockRejectedValue(new Error('Nothing was changed.'))

		expect(await start.run([], true)).toBe(1)
		expect(start_steps.run_steps).not.toHaveBeenCalled()
	})

	it('leaves an existing GitHub origin alone', async () => {
		vi.mocked(start_steps.read_git_state).mockReturnValue({
			...NO_GIT,
			has_git: true,
			has_github: true,
		})

		expect(await start.run(['--yes'], false)).toBe(0)
		expect(start_steps.run_steps).toHaveBeenCalledWith(['initialize', 'labels'], expect.anything())
	})
})

describe('josh start options', () => {
	it('defaults to an interactive, private, profile-detecting run', () => {
		expect(start.parse_start_options([])).toStrictEqual({
			profile: undefined,
			is_yes: false,
			is_github: false,
			visibility: 'private',
		})
	})

	it('reads the profile alongside every switch', () => {
		const args = ['--yes', '--profile', 'full', '--github', '--public']

		expect(start.parse_start_options(args)).toStrictEqual({
			profile: 'full',
			is_yes: true,
			is_github: true,
			visibility: 'public',
		})
	})

	it('names josh start in the usage for an unknown argument', () => {
		expect(() => start.parse_start_options(['--force'])).toThrow('Usage: josh start')
	})

	it('rejects an unknown profile', () => {
		expect(() => start.parse_start_options(['--profile', 'python'])).toThrow(
			'Profile must be basic or full',
		)
	})
})
