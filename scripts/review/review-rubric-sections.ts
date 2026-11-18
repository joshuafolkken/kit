import { review_round } from './review-round'

// The rubric sections a diff needs (joshuafolkken/kit#7884). The whole rubric was read on every
// review, the categories no changed file can trigger included, and it was 17% of every Read result.
// Each changed path gets a kind; a category whose kinds the diff carries none of is left out, and
// round 1 leaves out round 2's section.
//
// **The safe side is every section.** A path with no recognizable kind, or no paths at all, keeps the
// whole rubric: a reviewer missing a category it needed would stop checking it without a word.

type DiffKind = 'code' | 'config' | 'doc' | 'test' | 'ui'

// First match wins, so a test file is `test` before its extension makes it `code`, and a `src/`
// module is `ui` because it can carry a user-visible string.
const KIND_RULES: ReadonlyArray<{ kind: DiffKind; pattern: RegExp }> = [
	{ kind: 'test', pattern: /(?:^|\/)(?:tests?|e2e)\//u },
	{ kind: 'test', pattern: /\.(?:test|spec)\.[cm]?[jt]sx?$/u },
	{ kind: 'ui', pattern: /\.svelte$/u },
	{ kind: 'ui', pattern: /(?:^|\/)(?:messages|locales?|i18n)\//u },
	{ kind: 'ui', pattern: /^src\/.*\.[cm]?[jt]sx?$/u },
	{ kind: 'doc', pattern: /\.(?:md|mdx|txt)$/u },
	{ kind: 'config', pattern: /\.(?:json|jsonc|ya?ml|toml)$/u },
	{ kind: 'config', pattern: /(?:^|\/)\.[^./][^/]*$/u },
	{ kind: 'code', pattern: /\.(?:[cm]?[jt]sx?|sh|py|css|html)$/u },
]

// Only the categories some diff can do without; the rest apply to every change.
const CATEGORY_NEEDS: ReadonlyArray<{ heading: string; kinds: ReadonlyArray<DiffKind> }> = [
	{ heading: '### 2. Security', kinds: ['code', 'config', 'ui'] },
	{ heading: '### 3. Performance', kinds: ['code', 'ui'] },
	{ heading: '### 5. i18n', kinds: ['ui'] },
	{ heading: '### 6. Tests', kinds: ['code', 'config', 'test', 'ui'] },
]

const ROUND_TWO_SECTION = '## The second round is a verification pass, not a second full review'
const FENCE = '```'
const HEADING_PATTERN = /^(#{2,3}) /u

function kind_of(file: string): DiffKind | undefined {
	return KIND_RULES.find((rule) => rule.pattern.test(file))?.kind
}

function is_kind(kind: DiffKind | undefined): kind is DiffKind {
	return kind !== undefined
}

// `undefined` is the undecidable diff — empty, or one path of no known kind — and keeps every section.
function diff_kinds(paths: ReadonlyArray<string>): ReadonlySet<DiffKind> | undefined {
	const kinds = paths.map((file) => kind_of(file)).filter((kind) => is_kind(kind))

	if (kinds.length === 0 || kinds.length < paths.length) return undefined

	return new Set(kinds)
}

function omitted_headings(paths: ReadonlyArray<string>, round: number): ReadonlyArray<string> {
	const kinds = diff_kinds(paths)

	if (kinds === undefined) return []

	const categories = CATEGORY_NEEDS.filter((need) =>
		need.kinds.every((kind) => !kinds.has(kind)),
	).map((need) => need.heading)

	return round < review_round.SECOND_ROUND ? [ROUND_TWO_SECTION, ...categories] : categories
}

function heading_level(line: string): number {
	return HEADING_PATTERN.exec(line)?.[1]?.length ?? 0
}

// The level of the heading being skipped, `0` when keeping. A skipped section ends at the next
// heading of its own level or above; a deeper one belongs to it.
function next_skip(line: string, omitted: ReadonlyArray<string>, skipping: number): number {
	const level = heading_level(line)

	if (level === 0) return skipping
	if (skipping !== 0 && level > skipping) return skipping

	return omitted.includes(line) ? level : 0
}

interface Walk {
	fence: boolean
	skipping: number
	kept: ReadonlyArray<string>
}

// A heading inside a code fence is an example of output, not a section boundary.
function step(walk: Walk, line: string, omitted: ReadonlyArray<string>): Walk {
	const skipping = walk.fence ? walk.skipping : next_skip(line, omitted, walk.skipping)

	return {
		fence: line.startsWith(FENCE) ? !walk.fence : walk.fence,
		skipping,
		kept: skipping === 0 ? [...walk.kept, line] : walk.kept,
	}
}

function omission_note(omitted: ReadonlyArray<string>): string {
	const titles = omitted.map((heading) => `"${heading.replace(HEADING_PATTERN, '')}"`).join(', ')

	return `This copy leaves out ${titles}: \`josh review:brief\` found nothing of their kind in this diff's paths. An omitted category still gets its heading and a one-line verdict, e.g. \`No issues — no code changed\`.`
}

// The rubric with every section this diff cannot trigger removed, and a closing line naming them; the
// text unchanged when none can go.
function trim(text: string, paths: ReadonlyArray<string>, round: number): string {
	const omitted = omitted_headings(paths, round)

	if (omitted.length === 0) return text

	let walk: Walk = { fence: false, skipping: 0, kept: [] }

	for (const line of text.split('\n')) walk = step(walk, line, omitted)

	return [...walk.kept, '', omission_note(omitted), ''].join('\n')
}

const review_rubric_sections = {
	omitted_headings,
	ROUND_TWO_SECTION,
	trim,
}

export { review_rubric_sections }
