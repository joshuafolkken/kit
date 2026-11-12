// **The environment mark that puts a claim ahead of the claims waiting without it**
// (joshuafolkken/kit#5767). `josh ship` sets it on the children of its commit and review stages
// (joshuafolkken/kit#5819): the commit's hooks and a round's checks waited behind other lanes' heavy
// checks (joshuafolkken/kit#5630's ship) for cores they hold only briefly. Every child inherits it
// through the environment, so the hooks claim with it without each caller knowing. **A whole test suite
// is never lifted**: the push's unit or e2e suite, run when the gate's record does not cover it, would
// hold its place ahead of other lanes for minutes. Nor is a check left running in the background — the
// gate a round opens — which `UNMARKED_ENVIRONMENT` clears at its launch.
const PRIORITY_KEY = 'JOSH_CORE_PRIORITY'
const PRIORITY_VALUE = '1'
const PRIORITY_ENVIRONMENT: Readonly<Record<string, string>> = { [PRIORITY_KEY]: PRIORITY_VALUE }
const UNMARKED_ENVIRONMENT: Readonly<Record<string, undefined>> = { [PRIORITY_KEY]: undefined }

interface ClaimKind {
	is_unit?: boolean | undefined
	is_suite?: boolean | undefined
}

// The marker field: absent rather than `false`, so a claim without the mark writes the marker it always did.
function marker_field({ is_unit, is_suite }: ClaimKind): true | undefined {
	const is_marked = process.env[PRIORITY_KEY] === PRIORITY_VALUE

	return is_marked && is_unit !== true && is_suite !== true ? true : undefined
}

const core_priority = { PRIORITY_ENVIRONMENT, PRIORITY_KEY, UNMARKED_ENVIRONMENT, marker_field }

export { core_priority }
