import { describe, expect, it } from 'vitest'
import { prompt_hooks } from './prompt-hooks'

const FIRST = "echo 'one'"
const SECOND = "echo 'two'"
const OTHER_EVENT = 'echo other'

const SETTINGS = JSON.stringify({
	hooks: {
		UserPromptSubmit: [
			{
				matcher: '',
				hooks: [
					{ type: 'command', command: FIRST },
					{ type: 'command', command: SECOND },
				],
			},
		],
		PostToolUse: [{ matcher: 'Edit', hooks: [{ type: 'command', command: OTHER_EVENT }] }],
	},
})

describe('user_prompt_hook_commands', () => {
	it('reads every command declared for the event', () => {
		expect(prompt_hooks.user_prompt_hook_commands(SETTINGS)).toStrictEqual([FIRST, SECOND])
	})

	// Only this event is injected into every user turn; another event's command is a different cost
	// on a different axis, and counting it would price the per-turn injection wrong.
	it('ignores the other hook events', () => {
		expect(prompt_hooks.user_prompt_hook_commands(SETTINGS)).not.toContain(OTHER_EVENT)
	})

	// A consumer project may have no hooks and no settings file at all, and `josh cost` still has to
	// print a breakdown there.
	it.each(['', '{ not json', '{}', JSON.stringify({ hooks: {} })])(
		'answers nothing for %j',
		(text) => {
			expect(prompt_hooks.user_prompt_hook_commands(text)).toStrictEqual([])
		},
	)
})
