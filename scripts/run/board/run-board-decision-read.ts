import { epic_graph, type EpicChild, type IssueReference } from '#scripts/epic/epic-graph'
import { epic_issue } from '#scripts/epic/epic-issue'
import { git_gh_etag_read } from '#scripts/gh/git-gh-etag-read'
import { git_gh_issue_read } from '#scripts/gh/git-gh-issue-read'
import { has_parked_label } from '#scripts/issue/issue-labels'
import { issue_read, type IssueComment } from '#scripts/issue/issue-read'
import { run_board_decision, type DecisionNode } from './run-board-decision'
import { run_board_decision_graphql, type ViewLoader } from './run-board-decision-graphql'
import { run_board_human } from './run-board-human'
import { run_board_layout, type BoardPlan, type DecisionBlocker } from './run-board-layout'
import { run_board_pause, type PauseRecord } from './run-board-pause'

interface CommentReasons {
	question: string | undefined
	pause: PauseRecord
}

interface DecisionRead {
	plan: BoardPlan
	nodes: Map<string, Promise<DecisionNode | undefined>>
	load_view: ViewLoader
}

// The board re-reads these every two minutes, so a node goes through GraphQL where the transport
// allows (`run-board-decision-graphql.ts`, joshuafolkken/kit#6819), and otherwise the issue and its
// comments go with the previous process's ETag (joshuafolkken/kit#6700): an unchanged answer costs
// no core request. A blocked node's relations follow-up is still read unconditionally. The
// `needs-decision` children's comments go through GraphQL the same way (joshuafolkken/kit#6857).
async function read_node(
	reference: IssueReference,
	load_view: ViewLoader,
): Promise<DecisionNode | undefined> {
	const json =
		(await load_view(reference)) ??
		(await git_gh_issue_read.issue_view_json(
			String(reference.number),
			'number,title,body,state,labels,blockedBy',
			reference.repo,
			git_gh_etag_read.read,
		))
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
	const node = read.nodes.get(key) ?? read_node(reference, read.load_view)

	read.nodes.set(key, node)

	return await node
}

function is_outside(node: DecisionNode, plan: BoardPlan): boolean {
	return node.repo !== plan.context.repo || !run_board_layout.numbers_of(plan).has(node.number)
}

// The one answer to whether a blocker waits on a person (joshuafolkken/kit#8026): a stop the
// human-stop registry names (a decision, a park, a merge) or an issue this run does not run. The walk
// ends there, and the 🙋 decision section draws it.
function stops_at(node: DecisionNode, plan: BoardPlan): boolean {
	return run_board_human.is_human(node.labels) || is_outside(node, plan)
}

function is_eligible(node: DecisionNode | undefined, plan: BoardPlan): node is DecisionNode {
	if (node === undefined || node.state === 'CLOSED') return false

	return stops_at(node, plan) || plan.withheld?.has(node.number) === true
}

function terminal_of(node: DecisionNode): DecisionNode | undefined {
	return node.blocked_by.length === 0 ? node : undefined
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

async function read_comments(
	number: number,
	repo: string,
	answered: ReadonlyMap<number, string>,
): Promise<ReadonlyArray<IssueComment>> {
	const json =
		answered.get(number) ??
		(await git_gh_issue_read.issue_list_comments(String(number), undefined, repo))

	return (await issue_read.parse_comments(json, repo)) ?? []
}

async function comments_of(
	number: number,
	repo: string,
	answered: ReadonlyMap<number, string>,
): Promise<ReadonlyArray<IssueComment>> {
	try {
		return await read_comments(number, repo, answered)
	} catch {
		return []
	}
}

async function question_of(
	number: number,
	repo: string,
	answered: ReadonlyMap<number, string>,
): Promise<readonly [number, CommentReasons]> {
	const comments = await comments_of(number, repo, answered)
	const question = run_board_decision.comment_question(issue_read.trusted_bodies(comments))

	const issue_url = `https://github.com/${repo}/issues/${String(number)}`

	return [number, { question, pause: run_board_pause.from_comments(comments, issue_url) }]
}

function question_pair([number, value]: readonly [number, CommentReasons]): Array<
	readonly [number, string]
> {
	return value.question === undefined ? [] : [[number, value.question]]
}

async function questions_of(
	plan: BoardPlan,
): Promise<Pick<BoardPlan, 'decision_questions' | 'pause_reasons'>> {
	const { repo } = plan.context
	const numbers = [...plan.labels]
		.filter(([, labels]) => has_parked_label(labels))
		.map(([number]) => number)
	const answered = await run_board_decision_graphql.read_comments(numbers, repo)
	const pairs = await Promise.all(
		numbers.map(async (number) => await question_of(number, repo, answered)),
	)

	return {
		decision_questions: new Map(pairs.flatMap((pair) => question_pair(pair))),
		pause_reasons: new Map(pairs.map(([number, value]) => [number, value.pause])),
	}
}

type Wait = readonly [number, DecisionNode]

async function wait_of(child: EpicChild, read: DecisionRead): Promise<Wait | undefined> {
	if (read.plan.withheld?.has(child.number) !== true) return undefined
	const blockers = await Promise.all(
		child.blocked_by.map(async (edge) => await blocker_of(edge, read, new Set())),
	)
	const blocker = blockers.find((node) => node !== undefined)

	return blocker === undefined ? undefined : [child.number, blocker]
}

// One blocker per issue, with every withheld child it holds. A blocker in another repository has no
// row the board can draw by its number, so it is left out.
function blockers_of(waits: ReadonlyArray<Wait>, repo: string): Array<DecisionBlocker> {
	const groups = new Map<number, { node: DecisionNode; blocks: Array<number> }>()
	const own = waits.filter(([, blocker]) => blocker.repo === repo)

	for (const [child, node] of own) {
		const group = groups.get(node.number) ?? { node, blocks: [] }

		group.blocks.push(child)
		groups.set(node.number, group)
	}

	return [...groups.values()].map(({ node, blocks }) => run_board_decision.blocker_of(node, blocks))
}

// The plan's own children are seeded as read, so the walk reads only the nodes outside it.
function read_of(plan: BoardPlan, children: ReadonlyArray<EpicChild>): DecisionRead {
	const nodes = children.map(
		(child) =>
			[
				epic_graph.key_of(child),
				Promise.resolve({ ...child, title: plan.context.titles.get(child.number) ?? '' }),
			] as const,
	)

	return { plan, nodes: new Map(nodes), load_view: run_board_decision_graphql.view_loader() }
}

async function with_decisions(plan: BoardPlan | undefined): Promise<BoardPlan | undefined> {
	if (plan === undefined) return undefined
	const children = [
		...plan.waves.waves.flat(),
		...plan.waves.unreached,
		...(plan.waves.running ?? []),
	]
	const read = read_of(plan, children)
	const [questions, waits] = await Promise.all([
		questions_of(plan),
		Promise.all(children.map(async (child) => await wait_of(child, read))),
	])

	const found = waits.filter((wait) => wait !== undefined)

	return { ...plan, ...questions, decision_blockers: blockers_of(found, plan.context.repo) }
}

const run_board_decision_read = { with_decisions }

export { run_board_decision_read }
