import { git_epic_parse } from './git-epic-parse'
import { to_issue_reference } from './git-epic-reference'
import { EPIC_LABEL } from './issue-labels'

// Whether an issue is an epic this repository's writers may edit, and why it is not when it is not.
//
// Both `josh epic --add` and `josh epic --remove` ask exactly this before they compute anything: the
// label, the absence of a cross-repository child, a task list to place rows in, and a declaration
// their edit can be relative to. It lives in one module rather than in each of them, because the two
// commands must refuse the same inputs for the same reasons — a second copy is where one comes to
// accept an epic the other refuses (joshuafolkken/kit#1712).

// The part of an epic these refusals read. Narrower than either command's own input on purpose: a
// shape check that could see the children being placed would invite conditions that belong to the
// caller.
interface EpicShapeSubject {
	epic_number: number
	body: string | undefined
	labels: ReadonlyArray<string>
}

function missing_declaration_error(epic_number: number): string {
	const check = `josh epic:check ${String(epic_number)}`

	return `${to_issue_reference(epic_number)} has no unambiguous machine-readable \`Dependencies\` declaration; run \`${check}\` first.`
}

// What to do about a target that is not an epic. The refusal is deliberate — neither command ever
// promotes an issue on its own, because promotion rewrites someone's issue into a container and the
// choice between promoting and creating a new epic depends on what the target *is*, which only a
// reader of it knows (`.claude/skills/workflow-commands/split-assessment.md` → promote-or-create).
// Naming both arms is what keeps the refusal one command away from being actionable rather than a
// dead end, which is the whole point of `into <target>` (joshuafolkken/kit#985).
function promote_remedy(epic_number: number): string {
	const promote = `josh epic --promote ${String(epic_number)} <N...>`

	return `Promote it with \`${promote}\` when it is a request, a discussion or a container; create a new epic over both when it is itself one of the deliverables.`
}

// The label and the task list are checked separately from the declaration because they fail
// differently: without rows there is nowhere to put a new one, and without a declaration there is
// nothing for an edit to be relative to.
function find_epic_shape_error(subject: EpicShapeSubject, body: string): string | undefined {
	const reference = to_issue_reference(subject.epic_number)

	if (!subject.labels.includes(EPIC_LABEL)) {
		return `${reference} does not carry the \`${EPIC_LABEL}\` label, so it is not an epic. ${promote_remedy(subject.epic_number)}`
	}

	if (git_epic_parse.has_external_task_list_entry(body)) {
		return `${reference} tracks a child in another repository; editing the declared order of a cross-repository epic is joshuafolkken/kit#864's scope, not this command's.`
	}

	return undefined
}

function find_subject_error(
	subject: EpicShapeSubject,
	tracked: ReadonlyArray<number>,
): string | undefined {
	const reference = to_issue_reference(subject.epic_number)
	if (subject.body === undefined) return `Could not read the body of ${reference}.`
	const shape_error = find_epic_shape_error(subject, subject.body)
	if (shape_error !== undefined) return shape_error

	if (tracked.length === 0) {
		return `${reference} tracks no child as a \`- [ ] #N\` row; there is nowhere to add one.`
	}

	// A declaration an edit can be relative to: exactly one of the two machine-readable forms.
	return git_epic_parse.has_machine_readable_declaration(subject.body)
		? undefined
		: missing_declaration_error(subject.epic_number)
}

const git_epic_shape = {
	find_subject_error,
}

export { git_epic_shape }
export type { EpicShapeSubject }
