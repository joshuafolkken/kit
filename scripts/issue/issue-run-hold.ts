import { has_label_name, has_parked_label, IN_PROGRESS_LABEL } from '#scripts/issue/issue-labels'

// **The one answer to "does a run hold this issue now"**: `in-progress` with no park label. A parked
// child keeps `in-progress` on while it waits on a person (`epicrun`), so the label alone reads it
// running. `lane:list` (`epic-busy.ts`), `run:add` and the board each asked it their own way and
// disagreed on the same labels (joshuafolkken/kit#6535), so all three read it here.
function is_held(labels: ReadonlyArray<string>): boolean {
	return has_label_name(labels, IN_PROGRESS_LABEL) && !has_parked_label(labels)
}

const issue_run_hold = { is_held }

export { issue_run_hold }
