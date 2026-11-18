import { session_cite } from '#scripts/issue/session-cite'
import { epic_cli_argv, type EpicArgv } from './epic-cli-argv'
import { chain_links, parse_dependency_chains, type DependencyLink } from './epic-parse'

// `--chain "#A -> #C"`, repeatable: a creation's per-child prerequisites, written in the very chain-line
// form the epic body's `## Dependencies` section holds. Each value is read by the body parser itself,
// so a value is a chain exactly when the same line in the body would be one — joins (`#A -> #C` and
// `#B -> #C`) and branches come from giving several. Lives apart from `epic-cli.ts`, which is near its
// size limit.
//
// **Refused before anything is written.** A value that is not a chain line, a number that is not one of
// the epic's children, a cycle, or `--chain` beside `--ordered` (two declarations of one order) each
// carries the reason, and the entry point prints it and exits without creating or editing an issue.

const CHAIN_FLAG = '--chain'

type Chain = Array<number>

interface ChainRead {
	chains: Array<Chain>
	chain_refusal?: string | undefined
}

interface ChainSubject {
	children: ReadonlyArray<number>
	is_ordered: boolean
}

// The value as one chain, or `undefined` when the body parser would not read it as a chain line.
function to_chain(value: string): Chain | undefined {
	const parsed = parse_dependency_chains(value.trim())

	return parsed.length === 1 ? parsed[0] : undefined
}

// Links whose blocker nothing else blocks can run first; peeling them until none are left is the
// topological order, and a link that never peels sits on a cycle.
function remaining_after_peel(links: ReadonlyArray<DependencyLink>): ReadonlyArray<DependencyLink> {
	const blocked = new Set(links.map((link) => link.blocked))
	const rest = links.filter((link) => blocked.has(link.blocker))

	return rest.length === links.length ? rest : remaining_after_peel(rest)
}

// A number repeated within one chain is a cycle too, and `chain_links` drops a self-link, so it is
// caught before the peel.
function is_cyclic(chains: ReadonlyArray<Chain>): boolean {
	if (chains.some((chain) => new Set(chain).size !== chain.length)) return true

	return remaining_after_peel(chains.flatMap((chain) => chain_links(chain))).length > 0
}

function find_outsider(
	chains: ReadonlyArray<Chain>,
	children: ReadonlyArray<number>,
): number | undefined {
	return chains.flat().find((reference) => !children.includes(reference))
}

function find_shape_refusal(values: ReadonlyArray<string>): string | undefined {
	const malformed = values.find((value) => to_chain(value) === undefined)
	if (malformed === undefined) return undefined

	const expected = '(`#A -> #B`); nothing was written.'

	return `\`${CHAIN_FLAG} ${malformed}\` is not a chain line ${expected}`
}

function find_graph_refusal(
	chains: ReadonlyArray<Chain>,
	subject: ChainSubject,
): string | undefined {
	const outsider = find_outsider(chains, subject.children)

	if (outsider !== undefined) {
		return `\`${CHAIN_FLAG}\` names ${session_cite.issue(outsider)}, which is not a child of this epic; nothing was written.`
	}

	return is_cyclic(chains)
		? `The \`${CHAIN_FLAG}\` declarations form a cycle; nothing was written.`
		: undefined
}

function find_refusal(values: ReadonlyArray<string>, subject: ChainSubject): string | undefined {
	if (values.length > 0 && subject.is_ordered) {
		return `\`${CHAIN_FLAG}\` and \`--ordered\` both declare the order; give one of them. Nothing was written.`
	}

	const shape = find_shape_refusal(values)
	if (shape !== undefined) return shape

	return find_graph_refusal(
		values.map((value) => to_chain(value) ?? []),
		subject,
	)
}

// The declared chains, or the reason they were refused; no chains when `--chain` was not given.
function read_chains(parsed: EpicArgv, subject: ChainSubject): ChainRead {
	const values = epic_cli_argv.values_of_flag(parsed, CHAIN_FLAG)
	const chain_refusal = find_refusal(values, subject)
	if (chain_refusal !== undefined) return { chains: [], chain_refusal }

	return { chains: values.map((value) => to_chain(value) ?? []) }
}

const epic_cli_chain = { CHAIN_FLAG, read_chains }

export { epic_cli_chain }
export type { ChainRead }
