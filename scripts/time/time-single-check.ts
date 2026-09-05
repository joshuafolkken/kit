import { time_shell } from './time-shell'

// Which calls are one verification check run on its own, and what makes two of them the same call
// (joshuafolkken/kit#1383).
//
// Measured on run #1379, that run issued eight of these — 45.9 seconds of tool time, six of them in
// the fix phase, each its own round trip — and 18.1 seconds after the last one `josh gate` ran lint,
// the type check, the spell check and the unit tests over the same tree. Three repeated an earlier
// call **with the same arguments**, and every one of those three followed an edit.
//
// **The arguments are part of the identity, and that is the whole reason this module exists.**
// `time-command-key.ts` keys a call by its josh subcommand, because a span keeps no input — which is
// the right grain for "was this command called twice" and the wrong one here: `josh test:related a.ts`
// and `josh test:related b.ts` are two questions, and counting them as a repeat would report ordinary
// feedback as waste. So the signature is read while the input is still in hand, exactly as
// `time-markers.ts` and `time-bundle-call.ts` read theirs, and the span carries the answer.
//
// **The set is an allow-list of the checks a run may issue on its own**, never "every josh command
// that verifies something". `josh gate` is deliberately absent: it *is* the gate, and the count this
// module feeds is about what ran in front of one. `josh eval:scope` is absent too — the completion
// gate prescribes exactly one call of it per run, so it is a step of the procedure rather than
// probing between edits, and folding it in would put a required call under a rule about avoidable
// ones (joshuafolkken/kit#1383 → the `eval:scope` question).
//
// **A consumer project's type check is invisible here, and that is an under-report rather than a
// zero.** kit type-checks with `josh check`, but `@joshuafolkken/app-kit` answers `josh-app check:ci`
// — which is not a `pnpm josh <cmd>` call at all, so `time-spans.ts` reads no subcommand off it. The
// figure is therefore a floor in a consumer, which is the direction every rule in this pipeline
// leans.
const CHECK_COMMANDS: ReadonlySet<string> = new Set([
	'josh check',
	'josh cspell',
	'josh cspell:dot',
	'josh lint',
	'josh lint:related',
	'josh test:related',
	'josh test:unit',
])

// What a call that is not one of them carries. The empty string rather than `undefined` for the
// reason `josh_command` is empty for a non-josh call: a span field that is sometimes absent is one
// every reader has to defend against.
const NO_CHECK = ''
const KEY_SEPARATOR = ' '

// **Sorted and de-duplicated, so the signature is the set of files rather than the order they were
// typed in.** `josh test:related a.ts b.ts` and `josh test:related b.ts a.ts` run the same tests, and
// a key that told them apart would report the second as new work — which is the direction that hides
// the waste this measures.
function argument_key(command: string): Array<string> {
	return [...new Set(time_shell.josh_arguments(command))].toSorted((left, right) =>
		left.localeCompare(right),
	)
}

// The signature, or `NO_CHECK` for a call that is not a single check. It takes the subcommand the
// caller has already read rather than reading it again: `time-spans.ts` computes it one line above,
// and two readings of the same command are how a call comes to be labelled by one subcommand and
// keyed by another.
function check_key(josh_command: string, command: string): string {
	if (!CHECK_COMMANDS.has(josh_command)) return NO_CHECK

	return [josh_command, ...argument_key(command)].join(KEY_SEPARATOR)
}

const time_single_check = { CHECK_COMMANDS, NO_CHECK, check_key }

export { time_single_check }
