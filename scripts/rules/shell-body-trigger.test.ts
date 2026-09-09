import { describe, expect, it } from 'vitest'
import { shell_body_trigger } from './shell-body-trigger'

// joshuafolkken/kit#1198: the trigger reads what the body *contains*, not which flag carries it —
// every worked example in this repository's prompts passes a placeholder, and keying on the flag
// would refuse those too. So the matching cases all carry a backtick or a `$`, and the non-matching
// ones are the same flags with a body the shell leaves alone.
//
// **Each of the three regex corrections is pinned from both sides.** A guard can pass vacuously — a
// pattern that stopped matching anything would make every "leaves alone" case green — so the
// spelling that must fire is asserted beside the one that must not, and the pair is what proves the
// change rather than either half.
const { is_shell_evaluated_body } = shell_body_trigger
const READS_AS_EVALUATED = 'reads %j as an evaluated body'
const LEAVES_ALONE = 'leaves %j alone'
// The exemption's reason for existing: the whole body is one file read, so the shell hands it over
// byte for byte. Named because two suites below need the same call to stay silent.
const FILE_READ_BODY = 'gh api repos/o/r/issues/1/comments -f body="$(cat /tmp/body.md)"'
// The fixtures the compliance suites share with the trigger suites: the inert placeholder every prompt
// in this repository writes, the spelling that really is evaluated, the three path-borne forms the
// refusal hands back, and two commands that carry no body at all.
const INERT_PLACEHOLDER_BODY = 'gh api repos/{owner}/{repo}/issues/1198/comments -f body="<plan>"'
const INLINE_EVALUATED_BODY = 'gh issue comment 1198 --body "ran `git switch main`"'
const FIELD_FILE_BODY = 'gh api repos/o/r/issues/1/comments --field body=@/tmp/body.md'
const QUOTED_FIELD_FILE_BODY = 'gh api repos/o/r/issues/1/comments --field "body=@$HOME/body.md"'
const NOTIFY_FILE_BODY = 'pnpm josh followup "t #1" --notify-message-file /tmp/body.md'
const BRANCH_FLAG_COMMAND = 'git checkout -b "feature-$USER"'
const NO_BODY_COMMAND = 'ls -la'
// The two quote forms `INLINE_BODY_VALUE` cannot see. The first is the form `CLAUDE.md`'s own
// mid-workflow stop command uses and the refusal calls the other safe form; the second is neither
// evaluated nor sanctioned, so it reaches the rule without keeping it.
const ANSI_C_QUOTED_BODY = "pnpm josh notify --task-type confirmation --body=$'stopped: waiting'"
const SINGLE_QUOTED_BODY = "gh api repos/o/r/issues/1/comments -f body='plain text'"

describe('is_shell_evaluated_body — the spellings the shell evaluates', () => {
	it.each([
		'gh api repos/{owner}/{repo}/issues/1198/comments -f body="Cause: `pnpm josh ms` ran"',
		INLINE_EVALUATED_BODY,
		'gh api repos/{owner}/{repo}/issues/1/comments --field body="$HOME is expanded"',
		'pnpm josh followup "t #1" --merge --notify-message="Result: `josh notify` ships it"',
		// A substitution embedded in prose really is evaluated, so the `$(…)` exemption is anchored to
		// a value that is nothing else.
		'gh api repos/o/r/issues/1/comments -f body="Result: run $(git log -1) to confirm"',
	])(READS_AS_EVALUATED, (command) => {
		expect(is_shell_evaluated_body(command)).toBe(true)
	})

	it.each([
		// The shape every prompt in this repository actually writes — inert, and left alone.
		INERT_PLACEHOLDER_BODY,
		'gh issue comment 1198 --body "Implemented the gate. Done!"',
		// Already safe: the body never reaches the shell as text. The `*-file` spellings end in `-`
		// where the pattern needs whitespace or `=`, so they cannot match it.
		FIELD_FILE_BODY,
		'pnpm josh followup "t #1" --merge --notify-message-file /tmp/body.md',
		// A whole-value substitution's output is not re-scanned, so the body arrives byte for byte.
		FILE_READ_BODY,
		// A backslash makes the next character literal inside double quotes.
		String.raw`gh issue comment 1 --body "costs \$5 and a \` mark"`,
		// `-b` is `git checkout`'s branch flag as often as it is `gh`'s body flag.
		BRANCH_FLAG_COMMAND,
	])(LEAVES_ALONE, (command) => {
		expect(is_shell_evaluated_body(command)).toBe(false)
	})
})

// **`-f "body=…"` is the same command as `-f body="…"`.** zsh strips the quotes before `gh` starts,
// so both hand `gh` one identical argument and both execute the backtick in it. The pattern knew only
// the second spelling and was silent on the first — half the calls it was written for.
describe('is_shell_evaluated_body — the quote on either side of `body=`', () => {
	it.each([
		'gh api repos/o/r/issues/1/comments -f "body=see `pnpm josh ms`"',
		'gh api repos/o/r/issues/1/comments --field "body=$HOME is expanded"',
		'gh api repos/o/r/issues/1/comments --raw-field "body=run `git status` first"',
		// `gh` takes `=` between a flag and its value as readily as a space, and the backtick runs
		// either way.
		'gh api repos/o/r/issues/1/comments --raw-field=body="see `pnpm josh ms`"',
		'gh api repos/o/r/issues/1/comments --field="body=run `git status` first"',
	])(READS_AS_EVALUATED, (command) => {
		expect(is_shell_evaluated_body(command)).toBe(true)
	})

	// The negative control for the same change. Moving the quote must not turn the inert placeholder
	// into a refusal, and it must not make `body=@<path>` match some later quote in the command — the
	// capture would then be an unquoted path, and a `$` in it would refuse the file form this rule
	// exists to ask for.
	it.each([
		'gh api repos/o/r/issues/1/comments -f "body=<plan>"',
		'gh api repos/o/r/issues/1/comments --field body=@$HOME/body.md --jq ".url"',
		'gh api repos/o/r/issues/1/comments --field body=@/tmp/body.md -f "title=Fix"',
		'gh api repos/o/r/issues/1/comments --field=body="<plan>"',
		'gh api repos/o/r/issues/1/comments --field=body=@$HOME/body.md --jq ".url"',
	])(LEAVES_ALONE, (command) => {
		expect(is_shell_evaluated_body(command)).toBe(false)
	})
})

// **A `$( … )` wrapper is not a way to smuggle a backtick past the rule.** The exemption's reason is
// that the substitution's *output* is not re-scanned — but the command inside it is shell text, and a
// backtick there runs exactly as an inline one does.
describe('is_shell_evaluated_body — what the whole-value exemption covers', () => {
	it.each([
		'gh api repos/o/r/issues/1/comments -f body="$(echo `date`)"',
		'pnpm josh notify --body "$(printf `git rev-parse HEAD`)"',
	])(READS_AS_EVALUATED, (command) => {
		expect(is_shell_evaluated_body(command)).toBe(true)
	})

	// The negative control: the file reads the exemption was written for still pass, including the one
	// that composes its path from a nested substitution. Refusing those would spend the run's single
	// delivery on a caller already passing the body by path.
	it.each([
		FILE_READ_BODY,
		'gh api repos/o/r/issues/1/comments -f body="$(cat $HOME/body.md)"',
		'gh api repos/o/r/issues/1/comments -f "body=$(cat /tmp/body.md)"',
	])(LEAVES_ALONE, (command) => {
		expect(is_shell_evaluated_body(command)).toBe(false)
	})
})

// **`body=@<path>` is the spelling the refusal itself asks for.** Unquoted it never reaches the
// pattern; with the quote one character to the left it does, and the `$` in a path like
// `@$HOME/body.md` would refuse a caller who had already done what the rule asked.
describe('is_shell_evaluated_body — a whole value that is a file reference', () => {
	it.each([QUOTED_FIELD_FILE_BODY, 'gh api repos/o/r/issues/1/comments -F "body=@/tmp/body.md"'])(
		LEAVES_ALONE,
		(command) => {
			expect(is_shell_evaluated_body(command)).toBe(false)
		},
	)

	// The negative control: a body that merely opens with an `@mention` is not a file reference, and a
	// backtick after it is executed exactly as it would be anywhere else.
	it.each([
		'gh api repos/o/r/issues/1/comments -f body="@joshuafolkken see `git log -1`"',
		'gh api repos/o/r/issues/1/comments -f "body=@joshuafolkken $HOME is expanded"',
	])(READS_AS_EVALUATED, (command) => {
		expect(is_shell_evaluated_body(command)).toBe(true)
	})
})

// **A `"` is legal inside `$( … )`.** The value capture stopped at the first one, truncating
// `$(cat "$(pwd)/x.md")` to `$(cat `, finding the `$` and refusing a caller who had already moved the
// body into a file.
describe('is_shell_evaluated_body — a quote nested inside the substitution', () => {
	it.each([
		'gh api repos/o/r/issues/1/comments -f body="$(cat "$(pwd)/body.md")"',
		'pnpm josh followup "t #1" --notify-message-file /tmp/b.md -f body="$(cat "/tmp/b.md")"',
	])(LEAVES_ALONE, (command) => {
		expect(is_shell_evaluated_body(command)).toBe(false)
	})

	// The negative control for the same change: reaching past the nested quote must not also start
	// excusing a substitution that is only part of the body, nor one whose own command runs a backtick.
	it.each([
		'gh api repos/o/r/issues/1/comments -f body="see $(cat "$(pwd)/body.md") above"',
		'gh api repos/o/r/issues/1/comments -f body="$(cat "$(echo `pwd`)/body.md")"',
	])(READS_AS_EVALUATED, (command) => {
		expect(is_shell_evaluated_body(command)).toBe(true)
	})
})

// **The compliance side of the same rule** (joshuafolkken/kit#1643). `rule-value.ts` needs two more
// answers about a call: whether it passed a body at all, and whether it passed one safely. The trigger
// fires only on the violation, so without the first a run that always passed bodies safely would drop
// out of the reading and the rate would be taken over runs that broke the rule.
describe('keeps_body_safe — the spellings the refusal hands back', () => {
	it.each([
		FIELD_FILE_BODY,
		QUOTED_FIELD_FILE_BODY,
		NOTIFY_FILE_BODY,
		'pnpm josh notify --task-type confirmation --body-file /tmp/body.md',
		FILE_READ_BODY,
		// **`$'…'` is the other sanctioned form**, and it is the one `CLAUDE.md`'s own mid-workflow stop
		// command uses — left out, every run that stopped correctly would be scored as having broken the
		// rule it kept.
		ANSI_C_QUOTED_BODY,
		String.raw`gh api repos/o/r/issues/1/comments -f body=$'Cause: x\nFix: y'`,
	])('reads %j as a body passed safely', (command) => {
		expect(shell_body_trigger.keeps_body_safe(command)).toBe(true)
	})

	it.each([
		// An inline body is not the compliant spelling, inert or not: the rule asks for a path.
		INERT_PLACEHOLDER_BODY,
		// A single-quoted body is not evaluated, but it is not one of the forms the refusal names
		// either — it reaches the rule without keeping it.
		SINGLE_QUOTED_BODY,
		// A call doing both is not credited for the half it got right — the measurement asks whether the
		// rule was kept before it asks whether it was broken.
		'pnpm josh followup --notify-message-file /tmp/b.md -f body="see `git log -1`"',
		// **The refusal text itself names `--body-file <path>`**, so a command that merely quotes the
		// flag is a run reading this repository rather than one passing a body by path.
		'grep -rn "--body-file" scripts/rules',
		NO_BODY_COMMAND,
	])('does not read %j as a body passed safely', (command) => {
		expect(shell_body_trigger.keeps_body_safe(command)).toBe(false)
	})
})

describe('carries_a_body — the occasion the rule governs', () => {
	it.each([
		INERT_PLACEHOLDER_BODY,
		NOTIFY_FILE_BODY,
		INLINE_EVALUATED_BODY,
		// The two quote forms the trigger cannot see. Both reach the rule, and dropping them would bias the
		// published rate upward by removing compliant runs from the denominator.
		ANSI_C_QUOTED_BODY,
		SINGLE_QUOTED_BODY,
	])('reads %j as a call that passes a body', (command) => {
		expect(shell_body_trigger.carries_a_body(command)).toBe(true)
	})

	it.each([BRANCH_FLAG_COMMAND, 'pnpm josh gate', NO_BODY_COMMAND])(
		'leaves %j out of the denominator',
		(command) => {
			expect(shell_body_trigger.carries_a_body(command)).toBe(false)
		},
	)
})
