import { json_value } from '#scripts/json-value'
import { z } from 'zod'

// The `UserPromptSubmit` hook commands declared in a `.claude/settings.json`
// (joshuafolkken/kit#1151).
//
// What these commands echo is injected into **every** user turn and then re-read as accumulated
// context on every turn after it, which is why joshuafolkken/kit#967 put a ceiling on their size and
// why `josh cost` names them in the resident breakdown. Two readers, one parser: the suite that
// enforces the ceiling and the report that prices it must agree on what is being measured, or the
// ceiling guards a quantity the report does not show.

const HOOK_SCHEMA = z.object({ command: z.string().nullish() })
const MATCHER_SCHEMA = z.object({ hooks: z.array(HOOK_SCHEMA).nullish() })
const SETTINGS_SCHEMA = z.object({
	hooks: z
		.object({
			UserPromptSubmit: z.array(MATCHER_SCHEMA).nullish(),
		})
		.nullish(),
})

// An unreadable or hook-less settings file yields no commands rather than throwing: a consumer
// project may have neither, and `josh cost` must still print a breakdown there.
function user_prompt_hook_commands(settings_text: string): Array<string> {
	const parsed = SETTINGS_SCHEMA.safeParse(json_value.parse_or_undefined(settings_text))
	const matchers = parsed.success ? (parsed.data.hooks?.UserPromptSubmit ?? []) : []

	return matchers.flatMap((matcher) =>
		(matcher.hooks ?? []).flatMap((hook) =>
			typeof hook.command === 'string' ? [hook.command] : [],
		),
	)
}

const prompt_hooks = { user_prompt_hook_commands }

export { prompt_hooks }
