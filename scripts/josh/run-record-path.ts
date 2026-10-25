// The run's own records — observations, accepted metrics — josh writes under the root `.josh/`
// directory. `defect-report.ts` and `scoped-green.ts` read such a path as bookkeeping, not as a
// change to the code.
const RUN_RECORD_ROOT = '.josh/'

function is_run_record(relative: string): boolean {
	return relative.startsWith(RUN_RECORD_ROOT)
}

const run_record_path = {
	is_run_record,
}

export { run_record_path }
