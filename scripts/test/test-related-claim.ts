import { core_budget } from '#scripts/gate/core-budget'
import { gate_plan } from '#scripts/gate/gate-plan'
import { test_pinned_reach } from './test-pinned-reach'
import { related_scope } from './test-related-scope'

// The cores a `josh test:related` vitest pass claims once its files are known (joshuafolkken/kit#5135):
// a narrowed pass by the test files its imports reach — not by its own files, one of which may reach
// hundreds — and the whole suite (`undefined`), or files no graph can be built for, by the full width
// a direct unit run holds.
async function claim_weight(files: ReadonlyArray<string> | undefined): Promise<number> {
	const tests = files === undefined ? undefined : await test_pinned_reach.reached_test_count(files)

	return tests === undefined ? gate_plan.direct_unit_weight() : gate_plan.scoped_unit_weight(tests)
}

// **Each vitest pass takes its claim here, not on the command entry**: the entry is reserved before
// the scope resolves, so it could only ever claim the whole width. `vitest_share` reads this claim
// back as the `--maxWorkers` bound. Under `josh gate` the gate's claim covers the run, so none is
// sized.
async function with_unit_claim(
	files: ReadonlyArray<string> | undefined,
	run: () => Promise<number>,
): Promise<number> {
	if (core_budget.is_covered()) return await run()

	const weight = await claim_weight(files)

	return await core_budget.with_command_reservation(weight, run, {
		memory_mb: gate_plan.unit_memory(weight),
		command: related_scope.COMMAND_NAME,
		is_unit: true,
	})
}

const test_related_claim = { with_unit_claim }

export { test_related_claim }
