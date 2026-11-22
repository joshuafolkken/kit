import { session_cite } from '#scripts/issue/session-cite'
import { epic_body, type OrderReason } from './epic-body'
import { epic_chains, type InsertPosition } from './epic-chains'
import { epic_cli_argv, type EpicArgv } from './epic-cli-argv'
import {
	chain_links,
	parse_dependency_chains,
	type DependencyChain as Chain,
	type DependencyLink,
} from './epic-parse'

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
// `--order-reason "#A -> #B: <reason>"`, repeatable: why one declared chain runs in that order, written
// under `### Declared order` in place of the pointer to the split rationale. Its refusals ride on
// `chain_refusal`, so every entry point that stops on a refused `--chain` stops on these too.
const ORDER_REASON_FLAG = '--order-reason'
const REASON_SEPARATOR = ':'

interface ChainRead {
	chains: Array<Chain>
	chain_refusal?: string | undefined
	order_reasons?: Array<OrderReason> | undefined
	placed_chain?: Chain | undefined
}

// `children` is `undefined` where the epic's children are not known yet — `--add` reads them from the
// epic, so its outsider check runs in the plan (`find_outsider_refusal`). `rival_flag` names another flag
// given beside `--chain` that also decides the order (`--before` and its kin under `--add`).
// `placed_chain` is the chain `--before` / `--after` writes (`epic_chains.chain_for`): declared like a
// `--chain`, so it needs its `--order-reason` too.
interface ChainSubject {
	children?: ReadonlyArray<number> | undefined
	is_ordered: boolean
	rival_flag?: string | undefined
	placed_chain?: Chain | undefined
}

// The chain `--add`'s position writes, or `undefined` for none — no position, or an order-only move
// (`--order-before` / `--order-after`), which writes no dependency.
function to_placed_chain(
	additions: ReadonlyArray<number>,
	placed: { position?: InsertPosition | undefined; is_order_only?: boolean | undefined },
): Chain | undefined {
	if (placed.position === undefined || placed.is_order_only === true) return undefined

	return epic_chains.chain_for(additions, placed.position)
}

// Every chain the read declares — the `--chain` values, then the positioned one — as the record of
// orders `## Decisions` gets.
function declared_of(
	read: Pick<ChainRead, 'placed_chain'> & { chains: ReadonlyArray<Chain> },
): ReadonlyArray<Chain> {
	return read.placed_chain === undefined ? read.chains : [...read.chains, read.placed_chain]
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

// A declared number that is none of `children`; `undefined` when every number is one.
function find_outsider_refusal(
	chains: ReadonlyArray<ReadonlyArray<number>>,
	children: ReadonlyArray<number>,
): string | undefined {
	const outsider = find_outsider(chains, children)
	if (outsider === undefined) return undefined

	return `\`${CHAIN_FLAG}\` names ${session_cite.issue(outsider)}, which is not a child of this epic; nothing was written.`
}

// Asked of the whole declaration `--add` would write, so a `--chain` closing a loop through chains
// the epic already declares is refused too.
function find_cycle_refusal(chains: ReadonlyArray<ReadonlyArray<number>>): string | undefined {
	return is_cyclic(chains)
		? `The \`${CHAIN_FLAG}\` declarations form a cycle; nothing was written.`
		: undefined
}

function find_graph_refusal(
	chains: ReadonlyArray<Chain>,
	subject: ChainSubject,
): string | undefined {
	const outsider =
		subject.children === undefined ? undefined : find_outsider_refusal(chains, subject.children)

	return outsider ?? find_cycle_refusal(chains)
}

function find_rival_flag(subject: ChainSubject): string | undefined {
	return subject.is_ordered ? '--ordered' : subject.rival_flag
}

function find_refusal(values: ReadonlyArray<string>, subject: ChainSubject): string | undefined {
	const rival = find_rival_flag(subject)

	if (rival !== undefined && values.length > 0) {
		return `\`${CHAIN_FLAG}\` and \`${rival}\` both declare the order; give one of them. Nothing was written.`
	}

	const shape = find_shape_refusal(values)
	if (shape !== undefined) return shape

	return find_graph_refusal(
		values.map((value) => to_chain(value) ?? []),
		subject,
	)
}

// `<chain>: <reason>` — the chain first, read as `--chain` reads it, so which order the reason is for
// cannot be mistaken. Whitespace is collapsed: the reason is written as one list item.
function to_order_reason(value: string): OrderReason | undefined {
	const separator = value.indexOf(REASON_SEPARATOR)
	if (separator === -1) return undefined
	const chain = to_chain(value.slice(0, separator))
	const reason = value
		.slice(separator + 1)
		.replaceAll(/\s+/gu, ' ')
		.trim()

	return chain === undefined || reason.length === 0 ? undefined : { chain, reason }
}

function is_declared(entry: OrderReason, declared: ReadonlyArray<Chain>): boolean {
	return declared.some((chain) => epic_body.is_same_chain(chain, entry.chain))
}

// Unreadable, naming a chain nobody declared, or naming one an earlier value already gave a reason —
// a record of an order the epic does not hold, or two records disagreeing about one.
function is_unusable(
	read: ReadonlyArray<OrderReason | undefined>,
	at: number,
	declared: ReadonlyArray<Chain>,
): boolean {
	const entry = read[at]
	if (entry === undefined) return true
	const earlier = read.slice(0, at).flatMap((other) => other ?? [])

	return (
		!is_declared(entry, declared) ||
		is_declared(
			entry,
			earlier.map((other) => other.chain),
		)
	)
}

function find_reason_refusal(
	values: ReadonlyArray<string>,
	declared: ReadonlyArray<Chain>,
): string | undefined {
	const read = values.map((value) => to_order_reason(value))
	const index = read.findIndex((_entry, at) => is_unusable(read, at, declared))
	if (index === -1) return undefined
	const expected = `\`<chain>: <reason>\` for a chain \`${CHAIN_FLAG}\`, \`--ordered\`, \`--before\` or \`--after\` declared, once`

	return `\`${ORDER_REASON_FLAG} ${values[index] ?? ''}\` is not ${expected}; nothing was written.`
}

// A declared chain no `--order-reason` explains: an order nobody said why it holds.
function find_missing_reason_refusal(
	reasons: ReadonlyArray<OrderReason>,
	declared: ReadonlyArray<Chain>,
): string | undefined {
	const missing = declared.find((chain) =>
		reasons.every((entry) => !epic_body.is_same_chain(entry.chain, chain)),
	)
	if (missing === undefined) return undefined
	const chain = epic_body.format_chain(missing)

	return `The declared order \`${chain}\` has no \`${ORDER_REASON_FLAG} "${chain}: <reason>"\`; every declared chain needs its reason. Nothing was written.`
}

// The reasons given for the declared chains, or a refusal — a value that does not fit, or a declared
// chain left without its reason.
function read_order_reasons(
	parsed: EpicArgv,
	subject: ChainSubject,
	chains: ReadonlyArray<Chain>,
): Omit<ChainRead, 'chains'> {
	const values = epic_cli_argv.values_of_flag(parsed, ORDER_REASON_FLAG)
	const declared = declared_of({
		chains: epic_body.declared_chains(subject.children ?? [], subject.is_ordered, chains),
		placed_chain: subject.placed_chain,
	})
	const order_reasons = values.flatMap((value) => to_order_reason(value) ?? [])
	const chain_refusal =
		find_reason_refusal(values, declared) ?? find_missing_reason_refusal(order_reasons, declared)
	if (chain_refusal !== undefined) return { chain_refusal }

	return { order_reasons }
}

// The declared chains and their reasons, or the reason they were refused; no chains when `--chain`
// was not given.
function read_chains(parsed: EpicArgv, subject: ChainSubject): ChainRead {
	const values = epic_cli_argv.values_of_flag(parsed, CHAIN_FLAG)
	const chain_refusal = find_refusal(values, subject)
	if (chain_refusal !== undefined) return { chains: [], chain_refusal }
	const chains = values.map((value) => to_chain(value) ?? [])

	const { placed_chain } = subject
	const placed = placed_chain === undefined ? {} : { placed_chain }

	return { chains, ...placed, ...read_order_reasons(parsed, subject, chains) }
}

const epic_cli_chain = {
	CHAIN_FLAG,
	ORDER_REASON_FLAG,
	declared_of,
	find_cycle_refusal,
	find_outsider_refusal,
	read_chains,
	to_placed_chain,
}

export { epic_cli_chain }
export type { ChainRead }
