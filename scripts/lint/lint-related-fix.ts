import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { changed_file_scope, type ChangedFileScope } from '#scripts/git/changed-file-scope'
import { format_steps } from './format-steps'
import { lint_related_scope } from './lint-related-scope'

const DIGEST_ALGORITHM = 'sha256'
const ABSENT = '\0absent'
const SEPARATOR = '\0'
const RECHECK_NOTICE = `${lint_related_scope.COMMAND_LABEL}: the fix pass rewrote a file the checks read — checking the fixed tree again.\n`

function report_scope(argv: ReadonlyArray<string>, scope: ChangedFileScope, root: string): void {
	changed_file_scope.report_unusable_arguments(argv, scope, lint_related_scope.COMMAND_LABEL)
	const flags = changed_file_scope.flags_of(argv)

	if (flags.length > 0) {
		process.stdout.write(
			`${lint_related_scope.COMMAND_LABEL}: ignored — prettier and eslint take different flags: ${flags.join(' ')}\n`,
		)
	}

	process.stdout.write(`${lint_related_scope.describe_scope(scope, root)}\n`)
}

async function stamp_of(file: string): Promise<string> {
	try {
		return `${file}${SEPARATOR}${await readFile(file, 'utf8')}`
	} catch {
		return `${file}${SEPARATOR}${ABSENT}`
	}
}

// What the fix pass can rewrite, as one digest: a narrowed fix pass writes only the files it is given.
async function digest_of(files: ReadonlyArray<string>): Promise<string> {
	const stamps = await Promise.all(files.map(async (file) => await stamp_of(file)))

	return createHash(DIGEST_ALGORITHM).update(stamps.join(SEPARATOR)).digest('hex')
}

interface FixHooks<T> {
	check: () => Promise<T>
	time: (fix: () => Promise<number>) => Promise<number>
}

interface FixedRun<T> {
	result: T
	fix_exit_code: number
}

async function timed_fix<T>(
	scope: ChangedFileScope,
	root: string,
	hooks: FixHooks<T>,
): Promise<number> {
	return await hooks.time(async () => await format_steps.run_scoped(scope, root))
}

async function serial<T>(fix: Promise<number>, hooks: FixHooks<T>): Promise<FixedRun<T>> {
	const fix_exit_code = await fix

	return { result: await hooks.check(), fix_exit_code }
}

// The fix pass runs beside the checks, which read the tree as it was before it. A narrowed pass
// writes only its own file list, so comparing their digests either side of it tells whether the checks
// read what the pass left: when it rewrote one, the checks run again on the fixed tree; when it did
// not, the checks already read that tree and are not run twice on it (joshuafolkken/kit#9122). A
// whole-tree pass can write any file, so it still finishes before the checks start. Its exit code is
// returned rather than dropped: it is the scoped run's only typed eslint, so a residual from a rule
// the warm daemon turns off (`eslint/untyped.js`) is reported by it alone (joshuafolkken/kit#7825).
async function beside<T>(
	scope: ChangedFileScope,
	root: string,
	hooks: FixHooks<T>,
): Promise<FixedRun<T>> {
	if (scope.mode === 'all') return await serial(timed_fix(scope, root, hooks), hooks)
	const before = await digest_of(scope.files)
	const fix = timed_fix(scope, root, hooks)
	const first = await hooks.check()
	const fix_exit_code = await fix

	if ((await digest_of(scope.files)) === before) return { result: first, fix_exit_code }
	process.stdout.write(RECHECK_NOTICE)

	return { result: await hooks.check(), fix_exit_code }
}

const lint_related_fix = { beside, report_scope }

export { lint_related_fix }
