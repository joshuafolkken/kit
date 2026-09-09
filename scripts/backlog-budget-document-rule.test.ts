import { describe, expect, it } from 'vitest'
import { read_repo_file, read_unwrapped } from './ai-document-fixture'
import { COMMAND_MAP } from './josh/josh-command-map'

// `josh backlog:budget` is what decides where a `backlogrun` stops (joshuafolkken/kit#1632). The
// budgets are only real if the loop is told to ask, so the markers below pin the parts a reader
// could otherwise satisfy by describing the flags without wiring them into the loop.

const BACKLOGRUN_DOC = '.claude/skills/workflow-commands/backlogrun.md'
const COMMAND_DOC = 'docs/josh-commands.md'

// Both budgets are off by default, so a `backlogrun` with neither flag behaves exactly as it did.
// Stated in one place only, this is the first thing a rewrite drops.
const DEFAULT_MARKERS: ReadonlyArray<[string, string]> = [
	['the idle watch is written in minutes', '`--idle <minutes>`'],
	['the maximum is written as a count', '`--max <count>`'],
	['both are off unless asked for', '**both are off by default**'],
	['the idle watch restarts on a pickup', 'restarts the watch'],
]

// The loop asks a command rather than counting in its head — the failure joshuafolkken/kit#1460
// measured, and the reason every other threshold in this repository is a command's answer.
const LOOP_MARKERS: ReadonlyArray<[string, string]> = [
	['the budget command is asked every iteration', 'pnpm josh backlog:budget'],
	['the verdict words are the ones the command prints', '| `run` | Start what `backlog:next`'],
	['the answer word is carried from the offer table', '| Budget answer |'],
	['the working tree is free while watching', '**Nothing is held while watching**'],
]

// The three things the acceptance criteria put in the completion report. A run that reported only a
// count would leave the person unable to tell an idle pickup from an ordinary one.
const REPORT_MARKERS: ReadonlyArray<[string, string]> = [
	['how many were picked up during a watch', 'picked up during an idle watch'],
	['the termination reason is quoted', 'termination reason'],
]

// The whole-run bound stays, stays where it was stated, and outranks both new budgets.
const BOUND_MARKERS: ReadonlyArray<[string, string]> = [
	['the 8-hour bound is unchanged', '**The whole-run 8-hour bound is unchanged'],
	['it is still stated in `epicrun.md`', '`epicrun.md` → "Waiting, and never waiting forever"'],
	['the per-epic guards are untouched', '`epicrun.md` → "Guards"'],
]

// A new issue is never implemented because it appeared — a person still has to opt it in.
const SAFETY_MARKER = 'it needs `auto-ok`, which only a person applies'

describe('backlogrun.md documents the two budgets', () => {
	it.each([...DEFAULT_MARKERS, ...LOOP_MARKERS, ...REPORT_MARKERS, ...BOUND_MARKERS])(
		'says %s',
		(_name, marker) => {
			expect(read_unwrapped(BACKLOGRUN_DOC)).toContain(marker)
		},
	)

	it('says the opt-in is what keeps an idle watch from being a way in', () => {
		expect(read_unwrapped(BACKLOGRUN_DOC)).toContain(SAFETY_MARKER)
	})

	it('routes the full flag contract to the command reference rather than restating it', () => {
		expect(read_unwrapped(BACKLOGRUN_DOC)).toContain('`josh backlog:budget`')
	})
})

describe('josh backlog:budget is a registered command with a reference section', () => {
	it('is in the command map', () => {
		expect(Object.keys(COMMAND_MAP)).toContain('backlog:budget')
	})

	it('has its own heading in the command reference', () => {
		expect(read_repo_file(COMMAND_DOC)).toMatch(/^### `josh backlog:budget`$/mu)
	})

	it.each([
		['the alias', 'alias: josh bb'],
		['the verdict words', '| `watch` |'],
		['the mapping from `backlog:next`', '`none` is `exhausted`'],
		['that an unreadable flag is never defaulted', 'makes the whole invocation unreadable'],
		['the entry point that consumes it', '`backlogrun`'],
	])('documents %s', (_name, marker) => {
		expect(read_unwrapped(COMMAND_DOC)).toContain(marker)
	})
})
