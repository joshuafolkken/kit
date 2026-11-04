import { epic_graph, type EpicChild, type IssueReference } from '#scripts/epic/epic-graph'
import { epic_issue } from '#scripts/epic/epic-issue'
import { git_gh_issue_read } from '#scripts/gh/git-gh-issue-read'
import { has_label_name, NEEDS_DECISION_LABEL } from '#scripts/issue/issue-labels'
import { issue_read } from '#scripts/issue/issue-read'
import { run_board_decision } from './run-board-decision'
import { run_board_layout, type BoardPlan } from './run-board-layout'

interface DecisionNode extends EpicChild {
	title: string
}

interface DecisionRead {
	plan: BoardPlan
	nodes: Map<string, Promise<DecisionNode | undefined>>
}

async function read_node(reference: IssueReference): Promise<DecisionNode | undefined> {
	const json = await git_gh_issue_read.issue_view_json(
		String(reference.number),
		'number,title,body,state,labels,blockedBy',
		reference.repo,
	)
	const issue = epic_issue.parse_epic_issue(json)

	if (issue === undefined) return undefined

	return {
		...reference,
		title: issue.title,
		body: issue.body,
		state: epic_issue.normalize_state(issue.state),
		labels: epic_issue.label_names(issue),
		blocked_by: epic_issue.blocker_references_of(issue, reference.repo),
	}
}

async function node_of(
	reference: IssueReference,
	read: DecisionRead,
): Promise<DecisionNode | undefined> {
	const key = epic_graph.key_of(reference)
	const node = read.nodes.get(key) ?? read_node(reference)

	read.nodes.set(key, node)

	return await node
}

function is_outside(node: DecisionNode, plan: BoardPlan): boolean {
	return node.repo !== plan.context.repo || !run_board_layout.numbers_of(plan).has(node.number)
}

function is_human(node: DecisionNode, plan: BoardPlan): boolean {
	return (
		has_label_name(node.labels, NEEDS_DECISION_LABEL) ||
		is_outside(node, plan) ||
		plan.withheld?.has(node.number) === true
	)
}

function is_eligible(node: DecisionNode | undefined, plan: BoardPlan): node is DecisionNode {
	return node !== undefined && node.state !== 'CLOSED' && is_human(node, plan)
}

function terminal_of(node: DecisionNode): DecisionNode | undefined {
	return node.blocked_by.length === 0 ? node : undefined
}

function stops_at(node: DecisionNode, plan: BoardPlan): boolean {
	return has_label_name(node.labels, NEEDS_DECISION_LABEL) || is_outside(node, plan)
}

function is_seen(reference: IssueReference, seen: ReadonlySet<string>): boolean {
	return seen.has(epic_graph.key_of(reference)) || reference.state === 'CLOSED'
}

async function blocker_of(
	reference: IssueReference,
	read: DecisionRead,
	seen: Set<string>,
): Promise<DecisionNode | undefined> {
	const key = epic_graph.key_of(reference)

	if (is_seen(reference, seen)) return undefined
	seen.add(key)
	const node = await node_of(reference, read)

	if (!is_eligible(node, read.plan)) return undefined
	if (stops_at(node, read.plan)) return node
	const blockers = await Promise.all(
		node.blocked_by.map(async (edge) => await blocker_of(edge, read, seen)),
	)

	return blockers.find((blocker) => blocker !== undefined) ?? terminal_of(node)
}

async function question_of(
	number: number,
	repo: string,
): Promise<readonly [number, string] | undefined> {
	const json = await git_gh_issue_read.issue_list_comments(String(number), undefined, repo)
	const comments = await issue_read.parse_comments(json, repo)
	const question = run_board_decision.comment_question(issue_read.trusted_bodies(comments ?? []))

	return question === undefined ? undefined : [number, question]
}

async function questions_of(plan: BoardPlan): Promise<ReadonlyMap<number, string>> {
	const numbers = [...plan.labels].filter(([, labels]) =>
		has_label_name(labels, NEEDS_DECISION_LABEL),
	)
	const pairs = await Promise.all(
		numbers.map(async ([number]) => await question_of(number, plan.context.repo)),
	)

	return new Map(pairs.filter((pair) => pair !== undefined))
}

async function wait_of(
	child: EpicChild,
	read: DecisionRead,
): Promise<readonly [number, string] | undefined> {
	if (read.plan.withheld?.has(child.number) !== true) return undefined
	const blockers = await Promise.all(
		child.blocked_by.map(async (edge) => await blocker_of(edge, read, new Set())),
	)
	const blocker = blockers.find((node) => node !== undefined)

	if (blocker === undefined) return undefined
	const reference = epic_graph.format_reference(blocker, read.plan.context.repo)

	return [child.number, run_board_decision.waiting_tail(reference, blocker.title, blocker.body)]
}

async function with_decisions(plan: BoardPlan | undefined): Promise<BoardPlan | undefined> {
	if (plan === undefined) return undefined
	const children = [
		...plan.waves.waves.flat(),
		...plan.waves.unreached,
		...(plan.waves.running ?? []),
	]
	const nodes = children.map(
		(child) =>
			[
				epic_graph.key_of(child),
				Promise.resolve({ ...child, title: plan.context.titles.get(child.number) ?? '' }),
			] as const,
	)
	const read = { plan, nodes: new Map(nodes) }
	const [decision_questions, waits] = await Promise.all([
		questions_of(plan),
		Promise.all(children.map(async (child) => await wait_of(child, read))),
	])

	return {
		...plan,
		decision_questions,
		decision_waits: new Map(waits.filter((pair) => pair !== undefined)),
	}
}

const run_board_decision_read = { with_decisions }

export { run_board_decision_read }
