import { session_language } from '#scripts/josh/session-language'

// `josh cases`' two interaction boundaries (joshuafolkken/kit#4491), read off the changed source with
// no I/O: the persistent state paths it names (`state`) and the environment it reads (`env`). The four
// I/O boundaries in `cases-logic.ts` name what a call can return; these name who else shares the
// state or the environment — the breakages found only after a merge, in another component's run.

type Interaction = 'state' | 'env'

interface StatePath {
	// The literal as written, cut before a template placeholder so a search finds its fixed head.
	path: string
	// The constants this source binds the literal to — the names another module reaches it through.
	constants: ReadonlyArray<string>
}

interface Environment {
	variables: ReadonlyArray<string>
	residents: ReadonlyArray<string>
}

interface Binding {
	name: string
	value: string
}

interface Wording {
	state: string
	variable: string
	resident: string
	others: string
	no_others: string
	search_failed: string
	state_cases: ReadonlyArray<string>
	variable_cases: ReadonlyArray<string>
	resident_cases: ReadonlyArray<string>
}

const INTERACTIONS: ReadonlyArray<Interaction> = ['state', 'env']
const QUOTED_LITERAL = /(?<quote>['"`])(?<literal>[^'"`\s]+)\k<quote>/gu
// A path under `.josh/` with something after the slash, a named lock file, or a `josh-<name>-` file
// prefix — the temporary-directory records (lane state, ledger, run events) are named that way. The
// bare `.josh/` root names every state at once, and a bare `.lock` suffix matches every lock in the
// repository; a `josh-` name with no trailing hyphen is a tag or a keychain service, not a file.
const STATE_PATH = /(?:\.josh\/[^/])|(?:[^/]\.lock$)|(?:^josh-[a-z][\w-]*-$)/u
const PLACEHOLDER = /\$\{|<|\*/u
const CONSTANT_BINDING =
	/\b(?:const|let)\s+(?<name>[A-Za-z_]\w*)\s*(?::[^=\n]+)?=\s*(?<quote>['"`])(?<value>[^'"`\n]+)\k<quote>/gu
const ENV_MARK = 'process.env'
const ENV_LITERAL_KEY =
	/\bprocess\.env\.(?<dotted>[A-Za-z_]\w*)|\b(?:process\.env|environment)\[\s*['"](?<quoted>\w+)['"]\s*\]/gu
// The `environment: X = process.env` default-parameter form reads `environment[KEY]` through a
// constant, so a key held in a constant is resolved against this source's own bindings.
const ENV_CONSTANT_KEY = /\b(?:process\.env|environment)\[\s*(?<key>[A-Za-z_]\w*)\s*\]/gu
const ENV_NAME = /^[A-Z][A-Z0-9_]*$/u
// A daemon or a beacon named as an identifier or a module (`eslint-daemon`, `daemon_status`), never
// the bare word, so prose about "the daemon" does not fire the boundary.
const RESIDENT = /\b[\w-]*(?:[_-](?:daemon|beacon)|(?:daemon|beacon)[_-])[\w-]*/giu
// A source names one daemon in many identifiers (`spawn_daemon`, `DAEMON_STOP`); its cases are the
// kind's, so the kind is the subject.
const RESIDENT_KIND = /daemon|beacon/iu
const SLASH = '/'

const JAPANESE: Wording = {
	state: '共有状態',
	variable: '環境変数',
	resident: '常駐プロセス',
	others: '他の読み書き',
	no_others: 'なし',
	search_failed: '検索失敗',
	state_cases: [
		'他の書き手との並行書き込み',
		'他の読み手が古い形式・途中の状態を読む',
		'自分が書く前に他の書き手が消す',
	],
	variable_cases: [
		'未設定',
		'親プロセスから継承した値（例 GIT_DIR）',
		'lane の work tree と main で値が違う',
	],
	resident_cases: [
		'常駐プロセスが古い',
		'常駐プロセスが不在',
		'lane の work tree と main で別のプロセスに繋がる',
	],
}

const ENGLISH: Wording = {
	state: 'shared state',
	variable: 'environment variable',
	resident: 'resident process',
	others: 'also read or written by',
	no_others: 'none',
	search_failed: 'search failed',
	state_cases: [
		'concurrent write by another writer',
		'another reader reads an old format or a partial state',
		'another writer deletes it before this write',
	],
	variable_cases: [
		'unset',
		'value inherited from the parent process (e.g. GIT_DIR)',
		'differs between the lane work tree and main',
	],
	resident_cases: [
		'resident process is stale',
		'resident process is absent',
		'the lane work tree and main reach different processes',
	],
}

function fixed_head(literal: string): string {
	const placeholder = PLACEHOLDER.exec(literal)

	const head = placeholder === null ? literal : literal.slice(0, placeholder.index)

	// `.josh/observations/` and `.josh/observations` name one state, so both search as the latter.
	return head.endsWith(SLASH) ? head.slice(0, -1) : head
}

function bindings(content: string): ReadonlyArray<Binding> {
	return [...content.matchAll(CONSTANT_BINDING)].map((match) => ({
		name: match.groups?.['name'] ?? '',
		value: match.groups?.['value'] ?? '',
	}))
}

function state_literals(content: string): ReadonlyArray<string> {
	const heads = [...content.matchAll(QUOTED_LITERAL)].map((match) =>
		fixed_head(match.groups?.['literal'] ?? ''),
	)

	return [...new Set(heads.filter((head) => STATE_PATH.test(head)))]
}

function state_paths_in(content: string): ReadonlyArray<StatePath> {
	const declared = bindings(content)

	return state_literals(content).map((path) => ({
		path,
		constants: declared
			.filter((binding) => fixed_head(binding.value) === path)
			.map((binding) => binding.name),
	}))
}

function constant_keys(content: string): ReadonlyArray<string> {
	const values = new Map(bindings(content).map((binding) => [binding.name, binding.value]))
	const keys = [...content.matchAll(ENV_CONSTANT_KEY)].map((match) =>
		values.get(match.groups?.['key'] ?? ''),
	)

	return keys.filter((name): name is string => name !== undefined && ENV_NAME.test(name))
}

// A source that hands `process.env` on whole, naming no variable, still reads the environment.
function variables_in(content: string): ReadonlyArray<string> {
	if (!content.includes(ENV_MARK)) return []

	const literal = [...content.matchAll(ENV_LITERAL_KEY)].map(
		(match) => match.groups?.['dotted'] ?? match.groups?.['quoted'] ?? '',
	)
	const names = [...new Set([...literal, ...constant_keys(content)])]

	return names.length === 0 ? [ENV_MARK] : names
}

function environment_in(content: string): Environment {
	const residents = [...content.matchAll(RESIDENT)].map((match) =>
		(RESIDENT_KIND.exec(match[0])?.[0] ?? '').toLowerCase(),
	)

	return { variables: variables_in(content), residents: [...new Set(residents)] }
}

function wording(lang: string = session_language.DEFAULT_SESSION_LANG): Wording {
	return session_language.is_japanese(lang) ? JAPANESE : ENGLISH
}

const cases_interaction = { INTERACTIONS, state_paths_in, environment_in, wording }

export type { Environment, Interaction, StatePath, Wording }
export { cases_interaction }
