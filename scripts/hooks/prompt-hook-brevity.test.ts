import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { prompt_hooks } from './prompt-hooks'

// The `UserPromptSubmit` hooks are injected into the conversation on **every user turn**, and what
// is injected is then re-read as accumulated context on every turn after it. joshuafolkken/kit#967
// cut them from 1,471 bytes to 1,010 by applying the same rule a resident document follows since
// kit#964: state the trigger and point at the body, which is in `CLAUDE.md` and is already loaded.
// A third rather than a half — every clause that survived is a directive some suite pins, and the
// rest was explanation the full rule already carries.
//
// Shortening a rule is only safe if the rule survives, so this suite pins the directives rather
// than the prose. A rewrite that drops one of them fails here, however elegant it reads.
//
// joshuafolkken/kit#2889 cut the hooks again, to a trigger and a pointer: the directives they
// restated now live once, in `CLAUDE.md` → Code Change Rules Step 0 (and the deletion policy in its
// Tier C line, pinned by `claude-settings-hooks.test.ts`), which every session already loads. So the
// directives are pinned where they live, and the hook is pinned to the trigger and the pointer.

// Headroom on purpose. joshuafolkken/kit#951 showed what a ceiling with none does: the next edit
// pays for itself by deleting a neighboring sentence, and the sentence it deletes is whichever one
// no test pinned rather than whichever matters least. About 190 bytes today against a 256 ceiling
// locks in the reduction and leaves room for one legitimate clarification.
const PER_TURN_CEILING_BYTES = 256

// The trigger and the shape the reader is asked for — stated by the hook and by Step 0 alike.
const SHARED_DIRECTIVES: ReadonlyArray<string> = [
	'before writing any implementation code',
	'Now / Change / Check',
	'every change with its test',
]

// What the hook itself must keep: the shared directives and the pointer.
const HOOK_DIRECTIVES: ReadonlyArray<string> = [
	...SHARED_DIRECTIVES,
	'Code Change Rules Step 0 in CLAUDE.md',
]

// One phrase per instruction the long hook carried, now asserted in the Step 0 it points at. Chosen
// as the words that change behavior — the trigger, the shape, the prohibitions — not the sentences
// that explained why. Some of these are also asserted by `report-format.test.ts`; the overlap is
// deliberate — that suite pins a phrase because the *rule* needs it, this one because a
// *shortening* must not drop it.
const STEP_ZERO_DIRECTIVES: ReadonlyArray<string> = [
	...SHARED_DIRECTIVES,
	'in the session language',
	'a non-programmer can follow',
	'only internal identifiers are banned',
	'name the concrete subject in each line',
	'subject-less prose is not acceptable',
	'no file paths, function or type names, or CLI option flags',
	'Details',
	'never wrapped in a code fence',
	'fullrun/halfrun/backlogrun',
	'never a confirmation stop',
	'Cause / Fix / Result',
	'Tests are required for ALL changes',
	'zero tests without explicit approval is a violation',
]

const SETTINGS_PATH = fileURLToPath(new URL('../../.claude/settings.json', import.meta.url))
const CLAUDE_MD_PATH = fileURLToPath(new URL('../../CLAUDE.md', import.meta.url))
const STEP_ZERO_START = '0. **Work summary + test declaration**'
const STEP_ONE_START = '1. **Refactor first**'

function step_zero(): string {
	const text = readFileSync(CLAUDE_MD_PATH, 'utf8')

	return text.slice(text.indexOf(STEP_ZERO_START), text.indexOf(STEP_ONE_START))
}

// Read through the same parser `josh cost` prices these with (joshuafolkken/kit#1151). A ceiling
// and a report that disagreed about what "the injected text" is would guard one quantity and print
// another.
function prompt_hook_commands(): ReadonlyArray<string> {
	return prompt_hooks.user_prompt_hook_commands(readFileSync(SETTINGS_PATH, 'utf8'))
}

// Only an `echo` reminder's text is injected into the turn verbatim, so the ceiling weighs those
// alone. A launcher command (`if [ -f … ] node … else pnpm josh … fi`, joshuafolkken/kit#2023) is
// executed rather than injected — what reaches the turn is its runtime stdout, sized independently of
// the command text — so counting its bytes here would guard a quantity that never enters context.
const ECHO_COMMAND_PREFIX = 'echo '

function injected_text(): string {
	return prompt_hook_commands()
		.filter((command) => command.startsWith(ECHO_COMMAND_PREFIX))
		.join('\n')
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

describe('the per-turn hooks kept the trigger and the pointer', () => {
	it.each(HOOK_DIRECTIVES)('the hook still states %j', (directive) => {
		expect(injected_text()).toContain(directive)
	})

	// The body lives in `CLAUDE.md`, so a hook that stopped naming it would leave the short form as
	// the whole rule.
	it('points at the document that holds the full rule', () => {
		expect(injected_text()).toContain('CLAUDE.md')
	})
})

describe('the Step 0 the hook points at kept every directive', () => {
	it('finds Step 0 in CLAUDE.md', () => {
		expect(step_zero()).toContain(STEP_ZERO_START)
	})

	it.each(STEP_ZERO_DIRECTIVES)('Step 0 still states %j', (directive) => {
		expect(step_zero()).toContain(directive)
	})
})
