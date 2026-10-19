import { test_declared_changed } from '#scripts/test/test-declared-changed'
import type { GuardedCall } from '#scripts/time-runtime/time-batch-guard'
import { run_tail_rule } from './run-tail-rule'

// The trigger and the delivered text behind the `test-declared` row of `delivered-rules.ts`.
// It lives beside `run-tail-rule.ts` and the other per-rule modules rather than
// inline in the enumeration, so the enumeration stays a list of rows.
//
// **A commit whose code change carries no test, refused at the commit stage `run-tail` already
// matches.** `CLAUDE.md` mandated a test for ALL code changes in three places and refused it in none;
// the input is mechanical — the changed paths, the test-file spelling, the exempt-path enumeration —
// so it is a delivered rule rather than resident prose.
//
// **No new delivery path.** The command half is `run_tail_rule.is_push_step_call`, reused verbatim, and the
// only thing added is the world-read: the working-tree verdict `pnpm josh test:declared` prints. Like
// `pre-gate-cut`, the command test comes first and the git read second, so an ordinary `Bash` call
// pays nothing and only a `pnpm josh git -y` spawns `git status`.
//
// **Once per run, because the exemption is a person's judgement a synchronous guard cannot read.** The
// non-executable-config and cosmetic-asset arms of `prompts/testing-guide.md`'s "Non-runtime updates" exception stay
// `required` by the classifier, and a person declares them in the Step 0 work summary — which no label
// or transcript tail records. So a row that fired every time would wedge exactly that declared-exempt
// commit; refusing once and passing the reissue is the same safe direction `issue-comments` takes, and
// a compliant reissue that adds a test flips the verdict to `satisfied` and stops matching anyway.
function is_untested_commit(call: GuardedCall): boolean {
	if (!run_tail_rule.is_push_step_call(call)) return false

	return test_declared_changed.current_verdict() === 'required'
}

const REASON =
	'⛔ test declared: this commits a runtime code change with no test beside it — `pnpm josh ' +
	'test:declared` reads it `required` and names the files. Tests are required for ALL code changes: ' +
	'add the test and reissue, or, for a change that touches no runtime path, declare the non-runtime ' +
	'exception in your Step 0 work summary and reissue. It fires once per run (`CLAUDE.md` → Code ' +
	'Change Rules).'

// The enumeration row itself, so `delivered-rules.ts` spreads one entry rather than restating the
// trigger and reason it already single-sources here. Once per run (the default delivery) for the
// reason above.
const ROW = {
	id: 'test-declared',
	is_trigger: is_untested_commit,
	reason: REASON,
	about: {
		title: 'Test declaration',
		topic: '`CLAUDE.md` → Code Change Rules',
		fires: '`pnpm josh git -y` (`josh g`) while `pnpm josh test:declared` answers `required`',
		quiet: '`exempt` (non-runtime only) or `satisfied` (tests included)',
	},
}

const test_declared_commit = { REASON, ROW }

export { test_declared_commit }
