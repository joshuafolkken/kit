import type { EpicChild } from '#scripts/epic/epic-graph'
import type { AddPlan, PlanOutcome } from './git-epic-add-plan'
import { git_epic_chains } from './git-epic-chains'
import { git_epic_parse, type DependencyLink } from './git-epic-parse'

// The pieces every `josh epic --add` test builds its epic from.
//
// `build_plan` takes the epic's children as `epic:next` reads them, so each test needs the same
// `EpicChild` construction and the same unwrap of a `PlanOutcome`. Three test files were writing them
// out identically, which is the clone `CLAUDE.md` prohibits — so they live here and every caller
// imports them (joshuafolkken/kit#1253).
//
// The body builder and the three readings of a rewritten body joined them for the same reason
// (joshuafolkken/kit#1738): a second placement suite would otherwise have started by copying them out
// of the first, and two copies of "what the task list says afterwards" can come to disagree.

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

// The refusal, or a thrown "expected a refusal". The mirror of `plan_of`, for the tests that assert
// what the command declines to write.
function error_of(outcome: PlanOutcome): string {
	if ('plan' in outcome) throw new Error('expected a refusal')

	return outcome.error
}

const DEPENDENCIES_HEADING = '## Dependencies'
const PROGRESS_HEADING = '## Progress'
const BLANK = ''

function rows(...numbers: ReadonlyArray<number>): Array<string> {
	return numbers.map((issue_number) => `- [ ] #${String(issue_number)}`)
}

// An epic body in the shape `build_plan` reads: a declaration under `## Dependencies` and a task list
// under `## Progress`.
function body_of(declaration: ReadonlyArray<string>, tracked: ReadonlyArray<number>): string {
	return [
		DEPENDENCIES_HEADING,
		BLANK,
		...declaration,
		BLANK,
		PROGRESS_HEADING,
		BLANK,
		...rows(...tracked),
		BLANK,
	].join('\n')
}

// The three readings a placement test makes of a rewritten body: the task-list order, the declaration
// as rendered, and a link list as `blocker->blocked` strings.
function tracked_of(outcome: PlanOutcome): Array<number> {
	return git_epic_parse.parse_task_list_issue_numbers(plan_of(outcome).body)
}

function declared_of(outcome: PlanOutcome): Array<string> {
	const { body } = plan_of(outcome)

	return git_epic_chains.render_chains(git_epic_parse.parse_dependency_chains(body))
}

function links_of(links: ReadonlyArray<DependencyLink>): Array<string> {
	return links.map((link) => `${String(link.blocker)}->${String(link.blocked)}`)
}

const git_epic_add_fixture = {
	child,
	plan_of,
	error_of,
	rows,
	body_of,
	tracked_of,
	declared_of,
	links_of,
}

export { BLANK, DEPENDENCIES_HEADING, EPIC_FIXTURE_REPO, PROGRESS_HEADING, git_epic_add_fixture }
