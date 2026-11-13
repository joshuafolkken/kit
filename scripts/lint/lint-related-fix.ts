import type { GateTree } from '#scripts/gate/gate-tree'
import { scoped_green } from '#scripts/gate/scoped-green'
import { changed_file_scope, type ChangedFileScope } from '#scripts/git/changed-file-scope'
import { format_steps } from './format-steps'
import { lint_related_scope } from './lint-related-scope'

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

// The verification snapshot is taken after every writer finishes. The checks that follow read
// that tree; their normal before/after guard still rejects concurrent edits during verification.
async function prepare(
	argv: ReadonlyArray<string>,
	scope: ChangedFileScope,
	root: string,
): Promise<GateTree | undefined> {
	report_scope(argv, scope, root)
	await format_steps.run_scoped(scope, root)

	return await scoped_green.read_before(argv)
}

const lint_related_fix = { prepare }

export { lint_related_fix }
