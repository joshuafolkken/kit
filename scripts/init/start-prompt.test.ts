import path from 'node:path'
import { createInterface, type Interface } from 'node:readline/promises'
import { ask_yes_no_simple } from '#scripts/git/git-prompt'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ProjectShape } from './project-profile'
import type { StartOptions } from './start-plan'
import { start_prompt, type Choices } from './start-prompt'

vi.mock('node:readline/promises', () => ({ createInterface: vi.fn() }))
vi.mock('#scripts/git/git-prompt', () => ({ ask_yes_no_simple: vi.fn() }))

const question = vi.fn<(text: string) => Promise<string>>()
const close = vi.fn<() => void>()
const SHAPE: ProjectShape = {
	profile: 'static',
	reason: 'test',
	has_web: true,
	has_typescript: false,
	has_git: false,
	has_github: false,
}
const OPTIONS: StartOptions = {
	profile: undefined,
	is_yes: false,
	is_github: false,
	visibility: 'private',
}
const CHOICES: Choices = {
	options: OPTIONS,
	shape: SHAPE,
	consent: 'granted',
	root: path.join(path.sep, 'work', 'my-site'),
}

beforeEach(() => {
	question.mockReset()
	close.mockReset()
	vi.mocked(ask_yes_no_simple).mockReset()
	const prompt: unknown = { question, close }

	vi.mocked(createInterface).mockReturnValue(prompt as Interface)
})

describe('the profile question of josh start', () => {
	it('accepts the detected profile when the answer is empty', async () => {
		question.mockResolvedValue('  ')

		expect(await start_prompt.confirm_choices(CHOICES)).toBe('static')
		expect(close).toHaveBeenCalled()
	})

	it('takes the profile the user types', async () => {
		question.mockResolvedValue('node')

		expect(await start_prompt.confirm_choices(CHOICES)).toBe('node')
	})

	it('does not ask when --profile was given', async () => {
		const choices = { ...CHOICES, options: { ...OPTIONS, profile: 'node' as const } }

		expect(await start_prompt.confirm_choices(choices)).toBe('node')
		expect(question).not.toHaveBeenCalled()
	})
})

describe('the repository question of josh start', () => {
	it('does not ask when consent was already granted', async () => {
		question.mockResolvedValue('')
		await start_prompt.confirm_choices(CHOICES)

		expect(ask_yes_no_simple).not.toHaveBeenCalled()
	})

	it('asks for the named repository and proceeds on yes', async () => {
		question.mockResolvedValue('')
		vi.mocked(ask_yes_no_simple).mockResolvedValue(true)

		expect(await start_prompt.confirm_choices({ ...CHOICES, consent: 'ask' })).toBe('static')
		expect(ask_yes_no_simple).toHaveBeenCalledWith(
			expect.anything(),
			expect.stringContaining('private GitHub repository "my-site"'),
		)
	})

	it('stops and closes the prompt when the user declines', async () => {
		question.mockResolvedValue('')
		vi.mocked(ask_yes_no_simple).mockResolvedValue(false)

		await expect(start_prompt.confirm_choices({ ...CHOICES, consent: 'ask' })).rejects.toThrow(
			'Nothing was changed',
		)
		expect(close).toHaveBeenCalled()
	})
})
