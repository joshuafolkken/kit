import { test_declared_changed } from '#scripts/test/test-declared-changed'
import type { GuardedCall } from '#scripts/time-runtime/time-batch-guard'
import { run_tail } from './run-tail'

// The trigger and the delivered text behind the `test-declared` row of `delivered-rules.ts`
// (joshuafolkken/kit#2118). It lives beside `run-tail.ts` and the other per-rule modules rather than
// inline in the enumeration, so the enumeration stays a list of rows.
//
// **A commit whose code change carries no test, refused at the commit stage `run-tail` already
// matches.** `CLAUDE.md` mandated a test for ALL code changes in three places and refused it in none;
// the input is mechanical — the changed paths, the test-file spelling, the exempt-path enumeration —
// so it is a delivered rule rather than resident prose.
//
// **No new delivery path.** The command half is `run_tail.is_push_step_call`, reused verbatim, and the
// only thing added is the world-read: the working-tree verdict `pnpm josh test:declared` prints. Like
// `pre-gate-cut`, the command test comes first and the git read second, so an ordinary `Bash` call
// pays nothing and only a `pnpm josh git -y` spawns `git status`.
//
// **Once per run, because the exemption is a person's judgement a synchronous guard cannot read.** The
// non-executable-config and cosmetic-asset arms of `CLAUDE.md`'s "Non-runtime updates" exception stay
// `required` by the classifier, and a person declares them in the Step 0 work summary — which no label
// or transcript tail records. So a row that fired every time would wedge exactly that declared-exempt
// commit; refusing once and passing the reissue is the same safe direction `issue-comments` takes, and
// a compliant reissue that adds a test flips the verdict to `satisfied` and stops matching anyway.
function is_untested_commit(call: GuardedCall): boolean {
	if (!run_tail.is_push_step_call(call)) return false

	return test_declared_changed.current_verdict() === 'required'
}

const REASON =
	'⛔ test declared: this commits a runtime code change with no test beside it — `pnpm josh ' +
	'test:declared` reads the working tree as `required` (a changed file that is neither a test — ' +
	'`*.test.ts` / `*.e2e.ts` — nor a mechanically-exempt non-runtime path). `CLAUDE.md` → Code ' +
	'Change Rules requires a test for ALL code changes: a bug fix gets a regression test, a refactor ' +
	'gets tests pinning behavior first, logic gets a unit test, an observable UI/timing change gets an ' +
	'E2E. Add the declared test and reissue this commit. **If the change genuinely touches no ' +
	'executable runtime path** it is the pre-approved non-runtime exception — declare it in your Step ' +
	'0 work summary with the reason it is exempt (non-executable config, a cosmetic asset swap) and ' +
	'reissue; the exception is a presentation, not a stop. Run `pnpm josh test:declared` to see the ' +
	'files it names. The procedure is `prompts/collaboration-workflow/rule-delivery.md` → ' +
	'"配送されている規則". This fires once per run, so reissuing will not repeat on the call in hand.'

// The enumeration row itself, so `delivered-rules.ts` spreads one entry rather than restating the
// trigger and reason it already single-sources here. Once per run (the default delivery) for the
// reason above.
const ROW = { id: 'test-declared', is_trigger: is_untested_commit, reason: REASON }

const test_declared_commit = { REASON, ROW, is_untested_commit }

export { test_declared_commit }
