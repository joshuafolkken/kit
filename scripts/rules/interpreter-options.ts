import type { ProgramCall } from './git-argv'

// Judge the execution mode, never words in the script: an inline program can construct the
// operation it runs without spelling a network or destructive command in its source.
const INLINE_FLAGS: ReadonlyMap<string, ReadonlySet<string>> = new Map([
	['node', new Set(['-e', '-p', '--eval', '--print'])],
	['python', new Set(['-c'])],
	['python3', new Set(['-c'])],
	['perl', new Set(['-e', '-E'])],
	['ruby', new Set(['-e'])],
	['bun', new Set(['-e', '--eval', '--print'])],
	['deno', new Set(['eval'])],
])
const SHELL_SCRIPT_LETTERS = 'c'
const SHELLS: ReadonlySet<string> = new Set(['bash', 'eval', 'sh', 'zsh'])
const FLAG_PREFIX = '-'
const LONG_FLAG = '--'
const QUOTING = /["'\\]/gu
const SHORT_FLAG = /^-[^-]/u
const WHITESPACE = /\s/u
const NEXT = 1
const AFTER_VALUE = 2
const NODE_VALUES =
	'-r --require --import --loader --experimental-loader -C --conditions --inspect-port --debug-port ' +
	'--input-type --env-file --env-file-if-exists --title --allow-fs-read --allow-fs-write ' +
	'--bench-isolation --bench-name-pattern --bench-reporter --bench-reporter-destination ' +
	'--bench-samples --bench-warmup --build-sea --build-snapshot-config --experimental-config-file ' +
	'--config-file --cpu-prof-dir --cpu-prof-interval --cpu-prof-name --diagnostic-dir --disable-proto ' +
	'--disable-warning --dns-result-order --experimental-package-map --experimental-sea-config ' +
	'--experimental-test-tag-filter --heap-prof-dir --heap-prof-interval --heap-prof-name ' +
	'--heapsnapshot-near-heap-limit --heapsnapshot-signal --icu-data-dir --inspect-publish-uid ' +
	'--localstorage-file --max-http-header-size --max-old-space-size-percentage ' +
	'--network-family-autoselection-attempt-timeout --openssl-config --process-timeout ' +
	'--redirect-warnings --report-directory --report-dir --report-filename --report-signal --run ' +
	'--secure-heap --secure-heap-min --snapshot-blob --test-concurrency --test-coverage-branches ' +
	'--test-coverage-exclude --test-coverage-functions --test-coverage-include --test-coverage-lines ' +
	'--test-global-setup --experimental-test-isolation --test-isolation --test-name-pattern ' +
	'--test-random-seed --test-reporter --test-reporter-destination --test-rerun-failures --test-shard ' +
	'--test-skip-pattern --test-timeout --tls-cipher-list --tls-keylog --trace-event-categories ' +
	'--trace-event-file-pattern --trace-require-module --unhandled-rejections --use-largepages ' +
	'--v8-pool-size --vfs-load --watch-kill-signal --watch-path'
const INTERPRETER_VALUES: ReadonlyMap<string, ReadonlySet<string>> = new Map([
	['node', new Set(NODE_VALUES.split(' '))],
	['python', new Set(['-W', '-X'])],
	['python3', new Set(['-W', '-X'])],
	['perl', new Set(['-I', '-M', '-m', '-F'])],
	['ruby', new Set(['-I', '-r', '-C', '-E', '-F', '-K'])],
	['bun', new Set(['-r', '--require', '--preload', '--cwd', '--config'])],
	[
		'deno',
		new Set([
			'-c',
			'--config',
			'--import-map',
			'--lock',
			'--cert',
			'--location',
			'--v8-flags',
			'--seed',
			'--log-level',
		]),
	],
])
const SHELL_VALUES: ReadonlySet<string> = new Set([
	'-o',
	'+o',
	'-O',
	'+O',
	'--rcfile',
	'--init-file',
])

// Keep quoted or escaped whitespace in its original token when string-based readers parse again.
// In particular, a field's text must never become a separate method flag.
function syntax_word(word: string): string {
	return WHITESPACE.test(word) ? word : word.replaceAll(QUOTING, '')
}

function matches_short_flag(word: string, flag: string): boolean {
	return SHORT_FLAG.test(word) && word.slice(1).includes(flag.slice(1))
}

function matches_inline_flag(word: string, flags: ReadonlySet<string>): boolean {
	return [...flags].some((flag) => {
		if (word === flag) return true
		if (!flag.startsWith(FLAG_PREFIX)) return false

		if (flag.startsWith(LONG_FLAG)) return word.startsWith(`${flag}=`)

		return matches_short_flag(word, flag)
	})
}

function value_index(word: string, values: ReadonlySet<string> | undefined): number {
	for (let index = NEXT; index < word.length; index += NEXT) {
		if (values?.has(`-${word.charAt(index)}`)) return index
	}

	return -1
}

function option_prefix(word: string, values: ReadonlySet<string> | undefined): string {
	if (!SHORT_FLAG.test(word)) return word

	const index = value_index(word, values)

	return index === -1 ? word : word.slice(0, index)
}

function option_width(
	word: string,
	prefix: string,
	values: ReadonlySet<string> | undefined,
): number {
	if (values?.has(word)) return AFTER_VALUE
	if (prefix !== word && word.length === prefix.length + NEXT) return AFTER_VALUE

	return NEXT
}

function value_flags(name: string): ReadonlySet<string> | undefined {
	return SHELLS.has(name) ? SHELL_VALUES : INTERPRETER_VALUES.get(name)
}

function is_script_operand(word: string, values: ReadonlySet<string> | undefined): boolean {
	return !word.startsWith(FLAG_PREFIX) && !values?.has(word)
}

function option_step(word: string, flags: ReadonlySet<string>, name: string): number {
	if (word === LONG_FLAG) return 0

	const values = value_flags(name)
	const prefix = option_prefix(word, values)

	if (matches_inline_flag(prefix, flags)) return -1
	if (is_script_operand(word, values)) return 0

	return option_width(word, prefix, values)
}

function interpreter_word(word: string, name: string): string {
	return SHELLS.has(name) ? word.replace(/^\+/u, '-') : word
}

function found_index(step: number, index: number): number {
	return step === -1 ? index : -1
}

function inline_index(call: ProgramCall, flags: ReadonlySet<string>): number {
	let index = 0

	while (index < call.args.length) {
		const word = interpreter_word(syntax_word(call.args[index] ?? ''), call.name)
		const step = option_step(word, flags, call.name)

		if (step <= 0) return found_index(step, index)

		index += step
	}

	return -1
}

function is_inline_execution(call: ProgramCall): boolean {
	if (call.name === 'eval') return true

	const is_shell = SHELLS.has(call.name)
	const flags = is_shell ? new Set([`-${SHELL_SCRIPT_LETTERS}`]) : INLINE_FLAGS.get(call.name)

	return flags !== undefined && inline_index(call, flags) !== -1
}

function shell_script_index(call: ProgramCall): number {
	return inline_index(call, new Set([`-${SHELL_SCRIPT_LETTERS}`]))
}

const interpreter_options = { SHELLS, is_inline_execution, shell_script_index, syntax_word }

export { interpreter_options }
