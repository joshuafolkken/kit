import { cost_cli, type CostVerdict } from '#scripts/cost-runtime/cost-cli'
import { vi } from 'vitest'

// What the `josh run:carry` CLI suites share. **Every claim prices the asking session first**, and
// the real `cost_cli.session_verdict` reads the machine's whole transcript corpus — slow on a
// developer's machine, instant in CI, where there is no transcript. A suite holds the verdict at CI's
// answer, `unmeasurable`, with `hold_verdict` in its `beforeEach` instead; the `over` refusal itself
// is pinned in `run-carry-cli-over.test.ts`.

const UNMEASURABLE: CostVerdict = 'unmeasurable'

// What `--json` puts on standard output. Only the two fields the suites read are named: `remaining`
// is the answer a resumed named-issue run acts on, and `started_at` is what says the whole-run bound was
// not restarted by the resumption.
interface CarryJson {
	carry?: { started_at?: string }
	remaining?: ReadonlyArray<number>
}

function hold_verdict(verdict: CostVerdict = UNMEASURABLE): void {
	vi.spyOn(cost_cli, 'session_verdict').mockReturnValue(verdict)
}

function last_json(out: ReadonlyArray<string>): CarryJson {
	return JSON.parse(out.at(-1) ?? '{}') as CarryJson
}

const run_carry_cli_fixture = { hold_verdict, last_json }

export { run_carry_cli_fixture }
