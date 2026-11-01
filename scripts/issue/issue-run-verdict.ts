import { git_gh_command } from '#scripts/gh/git-gh-command'
import { RUN_LANE_LABEL, RUN_SOLO_LABEL } from './issue-labels'

// The run-label half both of backlogrun's verdicts share — `josh auto-ok:judge --apply` and
// `josh backlog:triage --apply` (joshuafolkken/kit#5636): the `--lane | --solo` flags, the label they
// name, and the labels written in order, stopping at the first that fails.

const RUN_LABEL_OPTIONS = {
	lane: { type: 'boolean' },
	solo: { type: 'boolean' },
} as const

interface RunLabelFlags {
	lane?: boolean | undefined
	solo?: boolean | undefined
}

// Exactly one of the two names a label; neither or both is no answer.
function run_label_of(flags: RunLabelFlags): string | undefined {
	if (flags.lane === flags.solo) return undefined

	return flags.lane === true ? RUN_LANE_LABEL : RUN_SOLO_LABEL
}

async function apply_labels(
	issue: string,
	labels: ReadonlyArray<string>,
): Promise<string | undefined> {
	for (const label of labels) {
		// eslint-disable-next-line no-await-in-loop -- each label must land before the next
		const write = await git_gh_command.issue_apply_label(issue, label)

		if (!write.is_applied) return `could not apply \`${label}\`: ${write.reason}`
	}

	return undefined
}

const issue_run_verdict = { RUN_LABEL_OPTIONS, run_label_of, apply_labels }

export { issue_run_verdict }
