import type { Interface } from 'node:readline/promises'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { OperationCancelledError } from './git-error'
import { ask_yes_no, ask_yes_no_simple, git_prompt } from './git-prompt'
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

// joshuafolkken/kit#2985: a declined confirmation throws a typed error rather than calling
// `process.exit`, so the caller's `finally` — a lock release, say — still runs. Without a TTY the
// prompt falls back to "no", which is the cancellation path.
describe('git_prompt cancel confirmations — a declined answer', () => {
	const is_tty_original = process.stdin.isTTY

	afterEach(() => {
		process.stdin.isTTY = is_tty_original
		vi.restoreAllMocks()
	})

	it.each([
		['confirm_unstaged_files', git_prompt.confirm_unstaged_files],
		['confirm_missing_package_json', git_prompt.confirm_missing_package_json],
		['confirm_without_version_update', git_prompt.confirm_without_version_update],
	])(
		'%s rejects with OperationCancelledError and the caller finally runs',
		async (_name, confirm) => {
			process.stdin.isTTY = false
			const exit_spy = vi.spyOn(process, 'exit')
			const cleanup = vi.fn()

			async function guarded(): Promise<void> {
				try {
					await confirm()
				} finally {
					cleanup()
				}
			}

			await expect(guarded()).rejects.toThrow(OperationCancelledError)
			expect(cleanup).toHaveBeenCalledOnce()
			expect(exit_spy).not.toHaveBeenCalled()
		},
	)
})
