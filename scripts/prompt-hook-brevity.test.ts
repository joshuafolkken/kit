import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// The `UserPromptSubmit` hooks are injected into the conversation on **every user turn**, and what
// is injected is then re-read as accumulated context on every turn after it. joshuafolkken/kit#967
// cut them from 1,471 bytes to 1,010 by applying the same rule a resident document follows since
// kit#964: state the trigger and point at the body, which is in `CLAUDE.md` and is already loaded.
// A third rather than a half — every clause that survived is a directive some suite pins, and the
// rest was explanation the full rule already carries.
//
// Shortening a rule is only safe if the rule survives, so this suite pins the directives rather
// than the prose. A rewrite that drops one of them fails here, however elegant it reads.

// Headroom on purpose. joshuafolkken/kit#951 showed what a ceiling with none does: the next edit
// pays for itself by deleting a neighboring sentence, and the sentence it deletes is whichever one
// no test pinned rather than whichever matters least. 1,010 bytes today against a 1,100 ceiling
// still locks in a quarter of the reduction and leaves room for one legitimate clarification.
const PER_TURN_CEILING_BYTES = 1100

// One phrase per instruction the long form carried. Chosen as the words that change behavior — the
// trigger, the shape, the prohibitions — not the sentences that explained why.
//
// Some of these are also asserted by `report-format.test.ts` and `claude-settings.test.ts`, and the
// overlap is deliberate rather than an oversight. Those suites pin a phrase because the *rule* needs
// it; this one pins the same phrase because a *shortening* must not drop it. They would be edited
// for different reasons and by different changes, and a rewrite that satisfied one while quietly
// failing the other is exactly what this list exists to catch.
const REQUIRED_DIRECTIVES: ReadonlyArray<string> = [
	'before writing any implementation code',
	'in the session language',
	'a non-programmer can follow',
	'only internal identifiers are banned',
	'Now / Change / Check',
	'Name the concrete subject in each line',
	'subject-less prose is not acceptable',
	'no file paths, function or type names, or CLI option flags',
	'Details',
	'every change with its test',
	'never wrapped in a code fence',
	'fullrun/halfrun/queue',
	'never a confirmation stop',
	'Cause / Fix / Result',
	'Tests are required for ALL changes',
	'Code Change Rules Step 0 in CLAUDE.md',
	'reversible',
	'NOT Tier C',
	'inspect the target first',
]

const SETTINGS_PATH = fileURLToPath(new URL('../.claude/settings.json', import.meta.url))

interface HookHandler {
	command: string
}

interface HookMatcher {
	hooks: ReadonlyArray<HookHandler>
}

interface SettingsShape {
	// eslint-disable-next-line @typescript-eslint/naming-convention -- Claude Code hook event name
	hooks: { UserPromptSubmit?: ReadonlyArray<HookMatcher> }
}

function prompt_hook_commands(): ReadonlyArray<string> {
	const settings = JSON.parse(readFileSync(SETTINGS_PATH, 'utf8')) as SettingsShape
	const matchers = settings.hooks.UserPromptSubmit ?? []

	return matchers.flatMap((matcher) => matcher.hooks.map((hook) => hook.command))
}

function injected_text(): string {
	return prompt_hook_commands().join('\n')
}

describe('the per-turn hooks stay small', () => {
	it('injects at least something', () => {
		expect(prompt_hook_commands().length).toBeGreaterThan(0)
	})

	// A ceiling rather than an exact size: the point is that the cost per turn cannot creep back,
	// not that the wording is frozen.
	it('injects less than the ceiling per user turn', () => {
		expect(Buffer.byteLength(injected_text(), 'utf8')).toBeLessThan(PER_TURN_CEILING_BYTES)
	})
})

describe('the per-turn hooks kept every directive', () => {
	it.each(REQUIRED_DIRECTIVES)('still states %j', (directive) => {
		expect(injected_text()).toContain(directive)
	})

	// The body lives in `CLAUDE.md`, so a hook that stopped naming it would leave the short form as
	// the whole rule.
	it('points at the document that holds the full rule', () => {
		expect(injected_text()).toContain('CLAUDE.md')
	})
})
