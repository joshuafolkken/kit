import { describe, expect, it } from 'vitest'
import { time_command_key } from './time-command-key'
import { time_shell } from './time-shell'
import { time_span_fixture } from './time-span-fixture'
import { time_spans } from './time-spans'

// What counts as *the same command* across a run's spans (joshuafolkken/kit#1311 for the rule,
// joshuafolkken/kit#1789 for the alias).
//
// Three readers ask this one question — the failure re-run chain, the per-invocation listing and the
// gate-run count — and nothing exercised the rule itself: every case for it went through one of the
// three, so a change here had to be inferred from whichever reader happened to fail.

const PNPM_LABEL = 'Bash: pnpm'
const END_MINUTE = 1
const ALIASED_GATE = 'pnpm josh ga'

function key_of(command: string): string {
	const josh_command = time_shell.josh_command_of(command)

	return time_command_key.command_key(
		time_span_fixture.outcome_span(END_MINUTE, time_spans.OK_OUTCOME, PNPM_LABEL, josh_command),
	)
}

function label_key(label: string): string {
	return time_command_key.command_key(
		time_span_fixture.outcome_span(END_MINUTE, time_spans.OK_OUTCOME, label),
	)
}

describe('time_command_key.command_key — a josh command', () => {
	// `pnpm josh ga` and `pnpm josh gate` are one command typed two ways. Keyed apart, the
	// per-invocation listing dropped both for having one call each and the failure chain did not see
	// the second as answering the red gate before it, so the rework it cost went unreported.
	it('gives an alias and the command it stands for one key', () => {
		expect(key_of(ALIASED_GATE)).toBe(key_of('pnpm josh gate'))
	})

	// The canonical name rather than whichever spelling arrived first: a key built from the alias
	// would put the run's own table under a name the command list does not carry.
	it('keys both by the name the alias stands for', () => {
		expect(key_of(ALIASED_GATE)).toBe('josh gate')
	})
})

describe('time_command_key.command_key — a key that is not a josh command', () => {
	// The expansion reads a josh subcommand, so a key that is not one has nothing to expand and has
	// to arrive exactly as it was.
	it('passes a tool label through unchanged', () => {
		expect(label_key('Read')).toBe('Read')
	})

	it('passes a bash label through unchanged', () => {
		expect(label_key('Bash: git')).toBe('Bash: git')
	})

	// Every call the transcript could not name would otherwise share one key, chaining two unrelated
	// tools together.
	it('gives a call nothing could name no key at all', () => {
		expect(label_key(time_spans.UNKNOWN_TOOL)).toBe(time_command_key.UNNAMED_KEY)
	})
})
