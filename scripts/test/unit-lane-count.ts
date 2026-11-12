import { readdirSync } from 'node:fs'
import path from 'node:path'
import { git_directory } from '#scripts/discovery/git-directory'
import { issue_number_shape } from '#scripts/issue/issue-number-shape'
import { durable_state_root } from '#scripts/josh/durable-state-root'
import { platform_temporary } from '#scripts/josh/platform-temporary'
import { lane_paths, type LaneEnvironment } from '#scripts/lane/lane-paths'
import { lane_state_record } from '#scripts/lane/lane-state-record'

// The lanes open on this machine, which divide the unit worker share beside the runs in flight.
//
// **Kept apart from `unit-run-marker.ts` because the vitest config must not import it**
// (joshuafolkken/kit#7254). Every module the config imports is a whole-suite file
// (`whole-suite-files.ts`), and the lane reading has changed often; the config reads this count through
// a child process instead (`vitest-config-workers.ts`), so a change here narrows to its own tests.

// A lane whose lane-state record says it opens no suite — paused, human-review or ended — read from the
// common git directory its `.git` file names, without asking git (joshuafolkken/kit#6916). A directory
// with no work tree or no readable record is not idle, so it keeps the place the directory gave it —
// as does a common directory spelled otherwise than `git rev-parse` spells it (a symlinked path), whose
// record key then names no file.
function is_idle_lane(lanes_root: string, issue: string, environment: LaneEnvironment): boolean {
	const common = git_directory.resolve_git_directory(path.join(lanes_root, issue))

	if (common === undefined) return false

	const override = environment[platform_temporary.TEMP_ROOT_KEY]
	const state_root = durable_state_root.state_root(override, () => common)

	return lane_state_record.is_idle(state_root, common, issue)
}

// The lane `checkout` sits in, if any: it is about to open a suite, whatever its record says.
function own_lane(checkout: string, environment: LaneEnvironment): string | undefined {
	return lane_paths.lane_issue_of(lane_paths.checkout_of(path.resolve(checkout)), environment)
}

// The lanes open on this machine: the issue-number directories under the lanes root `checkout`
// belongs to (joshuafolkken/kit#6682), less those whose lane-state record says they are idle — never
// the asking lane itself, which a person may gate while its record still says `human-review`. A stray
// directory or one with no record is still counted, an upper bound. **Unreadable counts none**, which
// leaves the division to the run count as it was — a lanes root that does not exist, as on CI, among them.
function live_lane_count(
	checkout: string = process.cwd(),
	environment: LaneEnvironment = process.env,
): number {
	try {
		const lanes_root = lane_paths.lanes_root_of(checkout, environment)
		const own = own_lane(checkout, environment)
		const issues = readdirSync(lanes_root).filter((name) =>
			issue_number_shape.ISSUE_NUMBER_PATTERN.test(name),
		)

		return issues.filter((issue) => issue === own || !is_idle_lane(lanes_root, issue, environment))
			.length
	} catch {
		return 0
	}
}

const unit_lane_count = { live_lane_count }

export { unit_lane_count }
