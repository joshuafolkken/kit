import { gate_labels } from '#scripts/gate/gate-labels'
import { lane_paths } from '#scripts/lane/lane-paths'

type LaneEnvironment = Record<string, string | undefined>

// **A lane leaves the whole suite to CI** (joshuafolkken/kit#7014): a changed file every test imports
// sent a lane's gate through every test file on a machine other lanes share. Its direct importers still run here, and the required `Checks` context in `ci.yml` is green
// only when every unit shard is, so the whole suite still runs before the merge. A main checkout's gate
// keeps it.
function is_whole_suite_kept(
	given: ReadonlyArray<string>,
	root: string,
	environment: LaneEnvironment = process.env,
): boolean {
	if (!given.includes(gate_labels.KEEP_WHOLE_SUITE_FLAG)) return false

	return lane_paths.lane_issue_of(root, environment) === undefined
}

const test_related_whole = { is_whole_suite_kept }

export { test_related_whole }
