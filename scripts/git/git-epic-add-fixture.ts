import type { EpicChild } from '#scripts/epic/epic-graph'
import type { AddPlan, PlanOutcome } from './git-epic-add-plan'

// The pieces every `josh epic --add` test builds its epic from.
//
// `build_plan` takes the epic's children as `epic:next` reads them, so each test needs the same
// `EpicChild` construction and the same unwrap of a `PlanOutcome`. Three test files were writing them
// out identically, which is the clone `CLAUDE.md` prohibits — so they live here and every caller
// imports them (joshuafolkken/kit#1253).

const EPIC_FIXTURE_REPO = 'joshuafolkken/kit'

// One child of the epic, with the relations it actually records. `blocked_by` defaults to none, since
// most children of a fixture epic carry no relation at all.
function child(number: number, blocked_by: ReadonlyArray<number> = []): EpicChild {
	return {
		number,
		repo: EPIC_FIXTURE_REPO,
		state: 'OPEN',
		labels: [],
		blocked_by: blocked_by.map((blocker) => ({ repo: EPIC_FIXTURE_REPO, number: blocker })),
	}
}

// The plan, or a thrown refusal. A test that expected a plan and got an error wants the error's own
// text in the failure, not `undefined` several assertions later.
function plan_of(outcome: PlanOutcome): AddPlan {
	if ('error' in outcome) throw new Error(outcome.error)

	return outcome.plan
}

const git_epic_add_fixture = {
	child,
	plan_of,
}

export { EPIC_FIXTURE_REPO, git_epic_add_fixture }
