import { existsSync, readdirSync } from 'node:fs'

// A local composite action is one directory under `.github/actions`, and GitHub resolves
// `uses: ./.github/actions/<name>` to that directory's `action.yml` (or `action.yaml`). Workflow
// scanners that read `.github/workflows` read these files too: `.github/actions/setup-pnpm` holds
// the pnpm/setup pin and the safe-chain installer pin kit's workflows used to carry inline.
const ACTIONS_DIRECTORY = '.github/actions'
const ACTION_FILE_NAMES = ['action.yml', 'action.yaml']

function as_is(relative_path: string): string {
	return relative_path
}

// Relative paths, resolved for the file-system calls through `resolve` — the identity for a
// consumer's working directory, `package_path` for kit's own package.
function list(resolve: (relative_path: string) => string = as_is): Array<string> {
	if (!existsSync(resolve(ACTIONS_DIRECTORY))) return []

	return readdirSync(resolve(ACTIONS_DIRECTORY))
		.toSorted((left, right) => left.localeCompare(right))
		.flatMap((name) =>
			ACTION_FILE_NAMES.map((file_name) => `${ACTIONS_DIRECTORY}/${name}/${file_name}`),
		)
		.filter((relative_path) => existsSync(resolve(relative_path)))
}

const composite_actions = { list }

export { composite_actions }
