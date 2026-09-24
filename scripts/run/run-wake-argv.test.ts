import { agent_diagnostics } from '#scripts/agent/agent-diagnostics'
import { claude_agent_argv } from '#scripts/agent/claude-agent-argv'
import { describe, expect, it, vi } from 'vitest'
import { run_wake_session } from './run-wake-session'

// joshuafolkken/kit#1719. What the supervisor spawns is the one place it could widen what may be run,
// so the argument vector is pinned rather than left to reading.

const INVOCATION = 'backlogrun --max 5 --idle 30'
const REORDERED_INVOCATION = 'backlogrun --idle 30 --max 5'
const NO_WATCH_INVOCATION = 'backlogrun --idle 0'
const ONE_FLAG_INVOCATION = 'backlogrun --max 5'
const BARE_INVOCATION = 'backlogrun'
const NAMED_INVOCATION = 'backlogrun #1762 #1749'
const SKIP_PERMISSIONS = 'dangerously-skip-permissions'

// The CLI version probe is the diagnostics' own test; here it would depend on the machine's CLI.
vi.spyOn(agent_diagnostics, 'check').mockReturnValue({ kind: 'ready' })

describe('run_wake_session.wake_argv — what the woken session is asked to do', () => {
	// The scheduler and worker share the provider adapter but resolve role-specific defaults; the
	// scheduler's explicit profile travels with the invocation still last (joshuafolkken/kit#1932).
	it('runs the agent CLI headless with the recorded invocation as its prompt and the default model and effort', () => {
		expect(run_wake_session.wake_argv(INVOCATION)).toStrictEqual(
			claude_agent_argv.resolve(INVOCATION, 'scheduler'),
		)
	})

	// The person typed the invocation; nothing between the record and the session may split it on its
	// spaces, so it stays exactly one element however many flags precede it.
	it('appends the invocation as one argument, never split on its spaces', () => {
		const built = run_wake_session.wake_argv(INVOCATION)
		const argv = built?.kind === 'argv' ? built.argv : undefined

		expect(argv?.args.at(-1)).toBe(INVOCATION)
		expect(argv?.args.filter((argument) => argument === INVOCATION)).toHaveLength(1)
	})

	// `auto-ok` decides what may be run unattended and is a person's to apply. A waker that could
	// write it would be widening its own authorization, so nothing it spawns may mention it.
	it('never names auto-ok anywhere in what it launches', () => {
		expect(JSON.stringify(run_wake_session.wake_argv(INVOCATION))).not.toContain('auto-ok')
	})

	// `eval-session.ts` passes it because that suite runs in a throwaway checkout whose credentials
	// were taken away. This one runs in the person's own repository, so it must not.
	it('does not disarm permission checks', () => {
		const argv = JSON.stringify(run_wake_session.wake_argv(INVOCATION))

		expect(argv).not.toContain(SKIP_PERMISSIONS)
	})

	// The binary was an environment variable first, which put the choice of what runs unattended with
	// the person's credentials in reach of anything that can set an environment. `eval-session.ts`
	// hard-codes the same binary for the same reason.
	it('takes the agent CLI from a constant rather than from the environment', () => {
		expect(run_wake_session.WAKE_COMMAND).toBe('claude')
		expect(JSON.stringify(run_wake_session)).not.toContain('JOSH_WAKE_COMMAND')
	})
})

function prompt_of(invocation: string): string | undefined {
	const built = run_wake_session.wake_argv(invocation)

	return built?.kind === 'argv' ? built.argv.args.at(-1) : undefined
}

// The recorded invocation is taken apart and composed again out of this file's own constants and the
// integers that passed, so the text held in the record never reaches the operating system. A check
// that only inspected the string would leave it flowing into `spawn` unchanged.
describe('run_wake_session.wake_argv — the invocation is rebuilt, not passed through', () => {
	it('accepts a bare backlogrun and rebuilds it as the command word alone', () => {
		expect(prompt_of(BARE_INVOCATION)).toBe(BARE_INVOCATION)
	})

	it('accepts the budget flags and keeps the order they were recorded in', () => {
		expect(prompt_of(INVOCATION)).toBe(INVOCATION)
		expect(prompt_of(REORDERED_INVOCATION)).toBe(REORDERED_INVOCATION)
	})

	// `--idle 0` turns the idle watch off (joshuafolkken/kit#1676), so zero is a budget a person can
	// declare rather than a value that only ever meant "unset". A rebuild that refused it would wake
	// the next session watching for 30 minutes a run that asked to finish at its first empty backlog.
	it('carries an idle watch turned off across the cut', () => {
		expect(prompt_of(NO_WATCH_INVOCATION)).toBe(NO_WATCH_INVOCATION)
	})

	// A check that merely validated the value would accept this: `05` passes the integer test. The
	// rebuild writes it back as `5`, and a rebuilt string that differs from the record is refused —
	// the woken session hands its prompt straight to `run:carry --begin`, which compares it to the
	// record character for character, so continuing on a rewritten one cannot work.
	it('refuses a value the rebuild would have rewritten, which a bare check would accept', () => {
		expect(run_wake_session.wake_argv('backlogrun --max 05')).toBeUndefined()
	})

	it('refuses spacing the rebuild would have collapsed', () => {
		expect(run_wake_session.wake_argv('backlogrun   --max   5')).toBeUndefined()
	})

	// Dropping it would wake a session running to a budget the person never declared, the first time
	// `backlogrun` grows a flag this supervisor has not caught up with.
	it('refuses an unknown flag rather than dropping it', () => {
		expect(run_wake_session.wake_argv('backlogrun --lanes 3')).toBeUndefined()
		expect(run_wake_session.wake_argv(`${ONE_FLAG_INVOCATION} --lanes 3`)).toBeUndefined()
	})

	it('refuses a flag given without a value', () => {
		expect(run_wake_session.wake_argv('backlogrun --max')).toBeUndefined()
	})

	// `Number('')`, `Number(' ')` and `Number('0x10')` are all safe integers, so a check that only asked
	// `Number.isSafeInteger` would read an unset shell variable as a budget of zero.
	it('refuses a value that is not a plain non-negative integer', () => {
		expect(run_wake_session.wake_argv('backlogrun --max 5.5')).toBeUndefined()
		expect(run_wake_session.wake_argv('backlogrun --max -1')).toBeUndefined()
		expect(run_wake_session.wake_argv('backlogrun --max 0x10')).toBeUndefined()
		expect(run_wake_session.wake_argv('backlogrun --max many')).toBeUndefined()
	})

	// A command word this one is merely a prefix of is a different command, and starts nothing here.
	it('refuses a first token that is not the command this supervisor continues', () => {
		expect(run_wake_session.wake_argv('backlogrun-now --max 5')).toBeUndefined()
		expect(run_wake_session.wake_argv('--max 5')).toBeUndefined()
	})
})

// joshuafolkken/kit#1984: a named-issue `backlogrun` is carried across a cut. The record holds the
// **opening** issue list at every cut, so the prompt the successor is handed round-trips back to
// `run:carry --begin` character for character — which is what `safe_invocation` refuses a wake on when
// it does not.
describe('run_wake_session.wake_argv — a named-issue backlogrun', () => {
	it('hands on the list the record holds, unchanged', () => {
		expect(prompt_of(NAMED_INVOCATION)).toBe(NAMED_INVOCATION)
	})

	// A repository-qualified reference and a malformed number are grammars this supervisor does not
	// carry — waking on either would launch a session that cannot claim the record.
	it.each(['backlogrun kit#1749', 'backlogrun #0'])('refuses %s', (invocation) => {
		expect(run_wake_session.wake_argv(invocation)).toBeUndefined()
	})
})
