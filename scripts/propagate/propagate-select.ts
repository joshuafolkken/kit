import { propagate_run } from './propagate-run'
import type { PropagateTarget, TargetState } from './propagate-targets'

// Narrowing a run to the one consumer `--target` names.
//
// Every other consumer stays in the list as `not_selected`, so the report still accounts for each
// repository considered and says why it was left alone. A name that matches nothing — or matches a
// candidate that cannot take the release — refuses the whole run before anything is written, rather
// than quietly propagating to nobody.

const SELECTABLE_STATES: ReadonlySet<TargetState> = new Set(['ready', 'up_to_date'])
const REFUSAL_PREFIX = 'Refusing to propagate:'

interface TargetSelection {
	targets: Array<PropagateTarget>
	refusal?: string
}

// A discovery key is `owner/repo`; the bare repository name is accepted too, because that is what a
// person types.
function matches_name(repo: string, name: string): boolean {
	return repo === name || repo.slice(repo.indexOf('/') + 1) === name
}

function refuse_match(name: string, matches: ReadonlyArray<PropagateTarget>): string | undefined {
	const [match] = matches

	if (match === undefined) {
		return `${REFUSAL_PREFIX} no repository named "${name}" is checked out next to this one.`
	}

	if (matches.length > 1) {
		return `${REFUSAL_PREFIX} "${name}" names more than one repository; use the owner/repo form.`
	}

	if (SELECTABLE_STATES.has(match.state)) return undefined

	return `${REFUSAL_PREFIX} ${match.repo}: ${propagate_run.skip_reason(match)}.`
}

// Only a candidate the run would otherwise have processed becomes `not_selected`. One that was never
// going to be — not downstream, no checkout — keeps its own reason, which says more than "not named".
function mark_unselected(
	target: PropagateTarget,
	matches: ReadonlyArray<PropagateTarget>,
): PropagateTarget {
	if (matches.includes(target) || !SELECTABLE_STATES.has(target.state)) return target

	return { ...target, state: 'not_selected' }
}

// The run's targets with every other consumer marked `not_selected`, or the reason `name` cannot be
// targeted. No name leaves the list untouched — the default run still covers every consumer.
function select_target(
	targets: ReadonlyArray<PropagateTarget>,
	name: string | undefined,
): TargetSelection {
	if (name === undefined) return { targets: [...targets] }
	const matches = targets.filter((target) => matches_name(target.repo, name))
	const refusal = refuse_match(name, matches)
	if (refusal !== undefined) return { targets: [], refusal }

	return { targets: targets.map((target) => mark_unselected(target, matches)) }
}

const propagate_select = {
	matches_name,
	select_target,
}

export type { TargetSelection }
export { propagate_select }
