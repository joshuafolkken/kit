import type { Interface } from 'node:readline/promises'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ask_yes_no, ask_yes_no_simple } from './git-prompt'
import { git_prompt_display } from './git-prompt-display'

vi.mock('./git-prompt-display', () => ({
	git_prompt_display: {
		display_start_separator: vi.fn(),
		display_end_separator: vi.fn(),
		display_invalid_answer_message: vi.fn(),
	},
}))

const QUESTION = '💬 Continue? (y/n): '
const YES_ANSWER = 'y'
const NO_ANSWER = 'n'
const INVALID_ANSWER = 'x'

function make_prompt(answers: Array<string>): Interface {
	const question_mock = vi.fn()

	for (const answer of answers) {
		question_mock.mockResolvedValueOnce(answer)
	}

	return { question: question_mock } as unknown as Interface
}

beforeEach(() => {
	vi.clearAllMocks()
})

describe('ask_yes_no (with separators)', () => {
	it('returns true for y answer and shows separators', async () => {
		const prompt = make_prompt([YES_ANSWER])
		const is_yes = await ask_yes_no(prompt, QUESTION)

		expect(is_yes).toBe(true)
		expect(git_prompt_display.display_start_separator).toHaveBeenCalledOnce()
		expect(git_prompt_display.display_end_separator).toHaveBeenCalledOnce()
	})

	it('returns false for n answer and shows separators', async () => {
		const prompt = make_prompt([NO_ANSWER])
		const is_yes = await ask_yes_no(prompt, QUESTION)

		expect(is_yes).toBe(false)
		expect(git_prompt_display.display_start_separator).toHaveBeenCalledOnce()
		expect(git_prompt_display.display_end_separator).toHaveBeenCalledOnce()
	})

	it('retries on invalid answer then returns true', async () => {
		const prompt = make_prompt([INVALID_ANSWER, YES_ANSWER])
		const is_yes = await ask_yes_no(prompt, QUESTION)

		expect(is_yes).toBe(true)
		expect(git_prompt_display.display_invalid_answer_message).toHaveBeenCalledOnce()
	})

	it('shows start separator only once even when retrying', async () => {
		const prompt = make_prompt([INVALID_ANSWER, INVALID_ANSWER, YES_ANSWER])

		await ask_yes_no(prompt, QUESTION)

		expect(git_prompt_display.display_start_separator).toHaveBeenCalledOnce()
		expect(git_prompt_display.display_invalid_answer_message).toHaveBeenCalledTimes(2)
	})
})

describe('ask_yes_no_simple (without separators)', () => {
	it('returns true for y answer without any separators', async () => {
		const prompt = make_prompt([YES_ANSWER])
		const is_yes = await ask_yes_no_simple(prompt, QUESTION)

		expect(is_yes).toBe(true)
		expect(git_prompt_display.display_start_separator).not.toHaveBeenCalled()
		expect(git_prompt_display.display_end_separator).not.toHaveBeenCalled()
	})

	it('returns false for n answer without any separators', async () => {
		const prompt = make_prompt([NO_ANSWER])
		const is_yes = await ask_yes_no_simple(prompt, QUESTION)

		expect(is_yes).toBe(false)
		expect(git_prompt_display.display_start_separator).not.toHaveBeenCalled()
		expect(git_prompt_display.display_end_separator).not.toHaveBeenCalled()
	})

	it('retries on invalid answer then returns true without separators', async () => {
		const prompt = make_prompt([INVALID_ANSWER, YES_ANSWER])
		const is_yes = await ask_yes_no_simple(prompt, QUESTION)

		expect(is_yes).toBe(true)
		expect(git_prompt_display.display_invalid_answer_message).toHaveBeenCalledOnce()
		expect(git_prompt_display.display_start_separator).not.toHaveBeenCalled()
		expect(git_prompt_display.display_end_separator).not.toHaveBeenCalled()
	})
})
