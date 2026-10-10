import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { prompt_hooks } from './prompt-hooks'
import { step_zero_notice } from './step-zero-notice'

// The `UserPromptSubmit` hooks are injected into the conversation on **every user turn**, and what
// is injected is then re-read as accumulated context on every turn after it. joshuafolkken/kit#967
// cut them from 1,471 bytes to 1,010 by applying the same rule a resident document follows since
// kit#964: state the trigger and point at the body, which is in `CLAUDE.md` and is already loaded.
// joshuafolkken/kit#2889 cut them again, to a trigger and a pointer.
//
// joshuafolkken/kit#2994 took the last echo off the prompt altogether: the Step 0 reminder fires on
// the first runtime `Edit` / `Write` of a session (`step-zero-notice.ts`), the moment its trigger —
// "before writing any implementation code" — names, so a question that writes nothing carries none
// of it. This suite pins that no echo comes back, that the moved reminder kept the trigger and the
// pointer, and that the Step 0 it points at kept every directive.
//
// Shortening a rule is only safe if the rule survives, so this suite pins the directives rather
// than the prose. A rewrite that drops one of them fails here, however elegant it reads.

// The trigger and the shape the reader is asked for — stated by the reminder and by Step 0 alike.
const SHARED_DIRECTIVES: ReadonlyArray<string> = [
	'before writing any implementation code',
	'Now / Change / Check',
	'every change with its test',
]

// What the reminder itself must keep: the shared directives and the pointer.
const REMINDER_DIRECTIVES: ReadonlyArray<string> = [
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
	'Tests are required for ALL changes',
	'zero tests without explicit approval is a violation',
]

// joshuafolkken/kit#3395 moved the rest of Step 0 to the report format it points at, in the session
// language that document is written in. The same directives, pinned where they now live.
const REPORT_FORMAT_PATH = fileURLToPath(
	new URL('../../prompts/collaboration-workflow/report-format.md', import.meta.url),
)
const MOVED_STEP_ZERO_DIRECTIVES: ReadonlyArray<string> = [
	'セッション言語',
	'プログラマでない人にも追える',
	'禁じるのは内部識別子だけ',
	'各行に具体的な主語を書き、主語のない文は不可',
	'ファイルパス・関数名や型名・CLI のオプションフラグは書かない',
	'`技術詳細`',
	'### 出力はコードフェンスで囲まない（必須）',
	'`fullrun` / `halfrun` / `prrun` / `backlogrun` で必須',
	'確認のための停止ではない',
	'`Cause` / `Fix` / `Result`',
]

const SETTINGS_PATH = fileURLToPath(new URL('../../.claude/settings.json', import.meta.url))
const CLAUDE_MD_PATH = fileURLToPath(new URL('../../CLAUDE.md', import.meta.url))
const STEP_ZERO_START = '0. **Work summary + test declaration**'
const STEP_ONE_START = '1. **Refactor first**'
const ECHO_COMMAND_PREFIX = 'echo '

function step_zero(): string {
	const text = readFileSync(CLAUDE_MD_PATH, 'utf8')

	return text.slice(text.indexOf(STEP_ZERO_START), text.indexOf(STEP_ONE_START))
}

// Read through the same parser `josh cost` prices these with (joshuafolkken/kit#1151), so the suite
// and the report agree about what "the injected text" is.
function prompt_hook_commands(): ReadonlyArray<string> {
	return prompt_hooks.user_prompt_hook_commands(readFileSync(SETTINGS_PATH, 'utf8'))
}

describe('the per-turn hooks inject no reminder text', () => {
	it('still runs a prompt hook (the session-language line)', () => {
		expect(prompt_hook_commands().length).toBeGreaterThan(0)
	})

	it('echoes nothing into a prompt that writes no code', () => {
		expect(
			prompt_hook_commands().filter((command) => command.startsWith(ECHO_COMMAND_PREFIX)),
		).toEqual([])
	})
})

describe('the Edit-time reminder kept the trigger and the pointer', () => {
	it.each(REMINDER_DIRECTIVES)('the reminder still states %j', (directive) => {
		expect(step_zero_notice.NOTICE.toLowerCase()).toContain(directive.toLowerCase())
	})
})

describe('the Step 0 the reminder points at kept every directive', () => {
	it('finds Step 0 in CLAUDE.md', () => {
		expect(step_zero()).toContain(STEP_ZERO_START)
	})

	it.each(STEP_ZERO_DIRECTIVES)('Step 0 still states %j', (directive) => {
		expect(step_zero()).toContain(directive)
	})

	it.each(MOVED_STEP_ZERO_DIRECTIVES)(
		'the report format Step 0 points at states %j',
		(directive) => {
			expect(readFileSync(REPORT_FORMAT_PATH, 'utf8')).toContain(directive)
		},
	)
})
