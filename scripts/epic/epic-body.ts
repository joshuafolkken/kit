import {
	chain_links,
	UNORDERED_DEPENDENCIES,
	type DependencyChain as Chain,
	type DependencyLink,
} from './epic-parse'
import { DEPENDENCY_ARROW, to_issue_reference } from './epic-reference'

// The epic body is the machine-readable half of the epic contract: `scripts/epic/epic-close.ts`
// reads the task list to decide when the batch is finished, and the order-unrecorded warning reads
// the `Dependencies` section. Generating both from the same input is what keeps them from
// disagreeing with each other, or with the run command printed next to them.

const RATIONALE_PLACEHOLDER = '<why the work was split this way>'
// Where a creation records its reasoning, including the reasoning for the order `--ordered` declares.
// Exported because `epic:audit`'s unjustified-order check reads it as one of the places a declared
// order's reason may live, and a second spelling of the heading is one that comes to disagree with
// the writer.
const SPLIT_RATIONALE_HEADING = '## Split rationale'
// One child declares no order, so there is nothing for the record below to name.
const CHAIN_MINIMUM_LENGTH = 2
const CREATION_OCCASION = 'when this epic was created'

// Why one declared chain runs in that order — what a later child takes from an earlier one, passed as
// `--order-reason "<chain>: <reason>"`.
interface OrderReason {
	chain: Chain
	reason: string
}

interface EpicBodyInput {
	children: ReadonlyArray<number>
	rationale: string
	is_ordered: boolean
	// The `--chain` lines a creation declared, each a chain of children in the order written.
	chains?: ReadonlyArray<Chain> | undefined
	order_reasons?: ReadonlyArray<OrderReason> | undefined
	origin?: string | undefined
	// Known when an existing issue is being promoted; absent while a new epic's body is built, since
	// the number is only assigned on creation.
	epic_number?: number | undefined
}

// Task-list syntax, never a bare `#N` link: `epic_parse.parse_task_list_issue_numbers` matches
// nothing else, and GitHub only auto-checks a row written this way.
function format_progress(children: ReadonlyArray<number>): string {
	return children.map((child) => `- [ ] ${to_issue_reference(child)}`).join('\n')
}

// The chains a creation declares: `--ordered`'s one chain through every child, else the `--chain`
// lines as given. The body's chain lines and the `blocked-by` pairs are both built from this, so the
// declaration and the relations cannot disagree.
function declared_chains(
	children: ReadonlyArray<number>,
	is_ordered: boolean,
	chains: ReadonlyArray<Chain> = [],
): ReadonlyArray<Chain> {
	const declared = is_ordered ? [children] : chains

	return declared.filter((chain) => chain.length >= CHAIN_MINIMUM_LENGTH)
}

function format_chain(chain: Chain): string {
	return chain.map((child) => to_issue_reference(child)).join(DEPENDENCY_ARROW)
}

function format_dependencies(chains: ReadonlyArray<Chain>): string {
	if (chains.length === 0) return UNORDERED_DEPENDENCIES

	return chains.map((chain) => format_chain(chain)).join('\n')
}

// The command that runs the batch, in the form a terminal runs as typed: a `#` would start a shell
// comment, and `backlogrun-args.ts` reads a bare number as `#N`. `backlogrun E --only` takes the epic
// itself rather than a list of children: it re-reads the state from GitHub each round, so an
// interrupted run resumes without anyone retyping the remaining numbers, and a child that needs a
// decision is parked rather than ending the run. `--only` runs exactly the epic's children and
// stops, which is the scope the removed `epicrun #E` keyword had.
//
// The epic number is not known while its own body is being built, so the placeholder is filled in by
// `format_run_command` once the issue exists. Bodies written before this change still say
// `epicrun …` or `queue …`; nothing reads the `Execution` section — the auto-close reads the task
// list and `epic:check` never looks at it — so those epics are unaffected.
const EPIC_PLACEHOLDER = '<this epic>'

function format_run_command(epic_number: number | undefined): string {
	const epic = epic_number === undefined ? EPIC_PLACEHOLDER : String(epic_number)

	return `pnpm josh backlogrun ${epic} --only`
}

// A backlink to the Issue this split came from, when the split originated in another repository.
// Written as prose rather than a checkbox row — a checkbox referencing another repository disables
// the auto-close by design, which is right for a real cross-repo child and a trap for a backlink.
function format_origin_section(origin: string | undefined): string {
	if (origin === undefined || origin.length === 0) return ''

	return `\n## Origin\n\n${origin}\n`
}

function to_rationale(rationale: string): string {
	const trimmed = rationale.trim()

	return trimmed.length > 0 ? trimmed : RATIONALE_PLACEHOLDER
}

// The record that `--ordered` itself is the decision behind the chain it writes.
//
// **Without it every `--ordered` epic is born failing its own audit.** `epic:audit`'s
// unjustified-order check asks where a declared order's reason was recorded, and the split rationale
// explains the split in prose that need not name a single issue number — so without this record the
// check finds nothing for any of the links and `backlogrun #E` stops at its audit on a brand-new
// epic created exactly as documented.
//
// **It is a real record, not a formality.** `--ordered` is a person stating the order deliberately,
// and this says so, when, and where the reasoning is — which is exactly what the check exists to
// find. It does not make the check vacuous: it names the chain the creation declared, so a link
// typed into the body by hand afterwards is still reported, which is the case the check was filed
// for.
//
// **The chain goes inside backticks.** A line that is *nothing but* a chain is read as part of the
// declaration wherever it sits in the body, so an unquoted one here would declare the order twice.
function format_order_line(chain: Chain, flag: string, occasion: string): string {
	const declared = `declared by \`josh epic ${flag}\` ${occasion}.`

	return `- Order: \`${format_chain(chain)}\`, ${declared}`
}

function is_same_chain(left: Chain, right: Chain): boolean {
	return left.length === right.length && left.every((child, index) => child === right[index])
}

function find_reason(chain: Chain, reasons: ReadonlyArray<OrderReason>): string | undefined {
	return reasons.find((entry) => is_same_chain(entry.chain, chain))?.reason
}

// Each chain's order line, then the reason given for it. Every entry point refuses a declared chain
// without its reason (`epic-cli-chain.ts`), so no stand-in is ever written: a chain reaching here
// without one gets no reasoning line.
function format_chain_record(
	chain: Chain,
	flag: string,
	reasons: ReadonlyArray<OrderReason>,
	occasion = CREATION_OCCASION,
): Array<string> {
	const reasoning = find_reason(chain, reasons)
	const order = format_order_line(chain, flag, occasion)

	return reasoning === undefined ? [order] : [order, `- Reasoning: ${reasoning}`]
}

// The record `epic --add` folds into its decision for the chains its `--chain`, `--before` or `--after`
// declared, so an order added later carries its reason as one declared at creation does; `undefined`
// with no chain.
function format_added_order(
	chains: ReadonlyArray<Chain>,
	reasons: ReadonlyArray<OrderReason>,
): string | undefined {
	const records = chains.flatMap((chain) =>
		format_chain_record(chain, '--add', reasons, 'when these children were added'),
	)

	return records.length === 0 ? undefined : records.join('\n')
}

function format_decisions_section(
	chains: ReadonlyArray<Chain>,
	is_ordered: boolean,
	reasons: ReadonlyArray<OrderReason> = [],
): string {
	if (chains.length === 0) return ''

	const flag = is_ordered ? '--ordered' : '--chain'

	return [
		'',
		'## Decisions',
		'',
		'### Declared order',
		'',
		...chains.flatMap((chain) => format_chain_record(chain, flag, reasons)),
		'',
	].join('\n')
}

function build_epic_body(input: EpicBodyInput): string {
	const chains = declared_chains(input.children, input.is_ordered, input.chains)

	return [
		SPLIT_RATIONALE_HEADING,
		'',
		to_rationale(input.rationale),
		format_origin_section(input.origin),
		'## Dependencies',
		'',
		format_dependencies(chains),
		'',
		'## Execution',
		'',
		format_run_command(input.epic_number),
		'',
		'## Progress',
		'',
		format_progress(input.children),
		format_decisions_section(chains, input.is_ordered, input.order_reasons),
	].join('\n')
}

// The pairs the relations are applied to are the links the written chain lines name, through the
// parser's own `chain_links`. A link two chains share is recorded once.
function build_dependency_pairs(
	children: ReadonlyArray<number>,
	is_ordered: boolean,
	chains: ReadonlyArray<Chain> = [],
): Array<DependencyLink> {
	const links = declared_chains(children, is_ordered, chains).flatMap((chain) => chain_links(chain))

	return links.filter(
		(link, index) =>
			links.findIndex(
				(other) => other.blocker === link.blocker && other.blocked === link.blocked,
			) === index,
	)
}

const epic_body = {
	EPIC_PLACEHOLDER,
	build_epic_body,
	build_dependency_pairs,
	declared_chains,
	format_added_order,
	format_chain,
	format_run_command,
	is_same_chain,
}

export { epic_body, SPLIT_RATIONALE_HEADING }
export type { EpicBodyInput, OrderReason }
