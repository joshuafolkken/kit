import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SEPARATOR_LINE } from './constants'
import { git_prompt_display } from './git-prompt-display'

beforeEach(() => {
	vi.spyOn(console, 'info')
})

afterEach(() => {
	vi.restoreAllMocks()
})

describe('git_prompt_display.display_start_separator', () => {
	it('prints an empty line then the separator', () => {
		git_prompt_display.display_start_separator()
		const { calls } = vi.mocked(console.info).mock

		expect(calls[0]).toEqual([''])
		expect(calls[1]).toEqual([SEPARATOR_LINE])
	})
})

describe('git_prompt_display.display_end_separator', () => {
	it('prints the separator', () => {
		git_prompt_display.display_end_separator()

		expect(vi.mocked(console.info)).toHaveBeenCalledWith(SEPARATOR_LINE)
	})
})

describe('git_prompt_display.display_invalid_answer_message', () => {
	it('prints the reply hint', () => {
		git_prompt_display.display_invalid_answer_message()

		expect(vi.mocked(console.info)).toHaveBeenCalledWith('💡 Reply y / n.')
	})
})
