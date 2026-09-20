import { describe, expect, it } from 'vitest'
import { interactive_ask } from './interactive-ask'

// joshuafolkken/kit#2201: the interactive-tool set the lane-child refusal reads, and the extractor that
// lifts a refused ask out of an exit record's `permission_denials` for the parent's park comment.

describe('is_interactive_tool', () => {
	it('reads AskUserQuestion as an interactive tool', () => {
		expect(interactive_ask.is_interactive_tool('AskUserQuestion')).toBe(true)
	})

	it('reads an ordinary tool as not interactive', () => {
		expect(interactive_ask.is_interactive_tool('Bash')).toBe(false)
	})
})

describe('refused_ask_of', () => {
	// The measured case: a child reached for AskUserQuestion, was refused, and its question and options
	// are stranded in the denial — which is exactly what the park comment needs.
	it('lifts the question and its option labels out of a refused ask', () => {
		const denials = [
			{
				tool_name: 'AskUserQuestion',
				tool_input: {
					questions: [
						{ question: 'Which library?', options: [{ label: 'zod' }, { label: 'valibot' }] },
					],
				},
			},
		]

		expect(interactive_ask.refused_ask_of(denials)).toBe('Which library? [zod / valibot]')
	})

	// Several questions in one ask are joined, so none is dropped from the basis.
	it('joins several questions from one ask', () => {
		const denials = [
			{
				tool_name: 'AskUserQuestion',
				tool_input: {
					questions: [
						{ question: 'A?', options: [{ label: 'x' }] },
						{ question: 'B?', options: [{ label: 'y' }] },
					],
				},
			},
		]

		expect(interactive_ask.refused_ask_of(denials)).toBe('A? [x]; B? [y]')
	})
})

describe('refused_ask_of — finding the interactive denial', () => {
	// A non-interactive denial in the list is passed over, and the interactive one still found.
	it('passes over a non-interactive denial to find the ask', () => {
		const denials = [
			{ tool_name: 'Read' },
			{ tool_name: 'AskUserQuestion', tool_input: { questions: [{ question: 'Q?' }] } },
		]

		expect(interactive_ask.refused_ask_of(denials)).toBe('Q?')
	})

	// A question the harness preserved without option labels still yields its text.
	it('renders a question that carries no options', () => {
		const denials = [
			{ tool_name: 'AskUserQuestion', tool_input: { questions: [{ question: 'Q?' }] } },
		]

		expect(interactive_ask.refused_ask_of(denials)).toBe('Q?')
	})
})

describe('refused_ask_of — the answers that carry nothing', () => {
	it('is undefined when no denial was an interactive ask', () => {
		const denials = [{ tool_name: 'Read' }, { tool_name: 'Bash' }]

		expect(interactive_ask.refused_ask_of(denials)).toBeUndefined()
	})

	it('is undefined when the interactive denial carried no questions', () => {
		const denials = [{ tool_name: 'AskUserQuestion', tool_input: {} }]

		expect(interactive_ask.refused_ask_of(denials)).toBeUndefined()
	})

	it('is undefined for a permission_denials that is not an array', () => {
		expect(interactive_ask.refused_ask_of(undefined)).toBeUndefined()
		expect(interactive_ask.refused_ask_of(2)).toBeUndefined()
	})
})
