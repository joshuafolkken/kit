import { KIT_PACKAGE_NAME } from '#scripts/version/kit-descriptor'
import { fresh_machine_spec, type Scenario } from './fresh-machine-spec'

// kit's own six patterns: three projects (one Lua file, one `index.html`, a minimal TypeScript
// SvelteKit app from `sv`) by two commands (`josh init`, `josh start`), each from the starting state
// joshuafolkken/kit#2848 gave it. `josh init` installs the packed checkout, so a fix is retested
// without a release; `josh start` installs a published version, because its setup pull request
// would carry a tarball path CI cannot resolve.

const KIT = KIT_PACKAGE_NAME
const ALLOW_BUILDS = '--allow-build=esbuild --allow-build=unrs-resolver'
// What `pnpm dlx @joshuafolkken/kit init` writes before it installs kit.
const BARE_MANIFEST = String.raw`printf '{ "private": true }\n' > package.json`
const CREATE_SVELTEKIT =
	'pnpm dlx sv create --template minimal --types ts --no-add-ons --install pnpm .'
// The `sv` that created the project is the one `pnpm dlx` resolved, so its version is recorded.
const SV_VERSION = 'pnpm dlx sv --version'
// The app builds and type-checks before kit is installed and still does after it.
const SVELTEKIT_CHECKS = 'pnpm build && pnpm check'
const INSTALL_TARBALL = `pnpm add -D ${ALLOW_BUILDS} "$PACKAGE_TARBALL"`
// A version published minutes ago is inside pnpm's release-age wait; kit alone is excluded from it
// (joshuafolkken/kit#2869), so every other dependency keeps the wait.
const EXCLUDE_RELEASE_AGE = String.raw`printf 'minimumReleaseAgeExclude:\n  - "${KIT}"\n' >> pnpm-workspace.yaml`
const INSTALL_PUBLISHED = `pnpm add -D ${ALLOW_BUILDS} ${KIT}@"$PACKAGE_VERSION"`
const GATE = 'pnpm josh gate'
const INIT_COMMANDS = [INSTALL_TARBALL, 'pnpm exec josh init', GATE]
// `josh start` leaves the project on its setup branch, where the gate asks for the scoped checks
// first; this is the line its refusal hands back.
const SCOPED_CHECKS = 'pnpm josh lint:related && pnpm josh test:related'
const START = 'pnpm exec josh start --yes --github'

// An agent names the profile rather than leaving it to detection, so a pattern that knows its
// profile passes it.
function start_commands(profile: string | undefined): Array<string> {
	const start = profile === undefined ? START : `${START} --profile ${profile}`

	return [EXCLUDE_RELEASE_AGE, INSTALL_PUBLISHED, start, SCOPED_CHECKS, GATE]
}

// `gh auth login` cannot run without a person, and it is what points git at gh for credentials; with
// the token in the environment this is the same step.
const SIGN_IN = 'gh auth setup-git'
// What the prerequisites guide has a person run once per machine. Only the pattern with no repository
// uses it: `josh start` makes the first commit there, and stops before writing without it (#3754).
const MACHINE_IDENTITY =
	'git config --global user.name kit-test && git config --global user.email kit-test@example.com'
// The identity is the repository's own, so the machine stays one nobody has configured git on.
const FIRST_COMMIT = [
	'git init --initial-branch main',
	'git config user.name kit-test && git config user.email kit-test@example.com',
	'git add --all && git commit --message "Initial commit"',
]
const CREATE_REPOSITORY = 'gh repo create "$RUN_NAME" --private --source . --push'

// The two states #3712 was found in: a shell that reads no rc file, and a PATH with `node` on it and
// no `pnpm`.
const BARE_SHELL =
	'env -i HOME="$HOME" PATH=/usr/local/bin:/usr/bin:/bin bash --noprofile --norc -c'
const NODE_ONLY = '"$HOME/node-only"'
const PATH_PROBES = [
	`${BARE_SHELL} '${GATE}'`,
	`mkdir -p ${NODE_ONLY} && ln -sf "$(command -v node)" ${NODE_ONLY}/node && ${BARE_SHELL} 'PATH="$HOME/node-only:$PATH" ./node_modules/.bin/josh gate'`,
]

// What a `josh start` run is checked against before the PATH states: the profile it recorded, the
// repository's visibility and branch, its labels, and the files the first commit on `main` holds.
const PROFILE = 'pnpm josh profile'
const START_PROBES = [
	PROFILE,
	'gh repo view --json visibility,defaultBranchRef',
	'gh label list --limit 100',
	'git show --name-only --format= "$(git rev-list --max-parents=0 main)"',
]

// What a `josh init` run is checked against after the gate: the profile it chose, the files it left
// (a `./.git` line is a repository it should not have made), and a second run that changes nothing.
const PROJECT_FILES =
	'find . -name node_modules -prune -o -name .git -prune -o -type f -print | sort'
const CHECKSUMS = `${PROJECT_FILES} | xargs sha256sum`
const INIT_PROBES = [
	PROFILE,
	'find . -name node_modules -prune -o -print | sort',
	`${CHECKSUMS} > "$HOME/before-second-init.sha" && pnpm exec josh init && ${CHECKSUMS} | diff "$HOME/before-second-init.sha" -`,
]

const LUA_FILE = 'main.lua'
const HTML_FILE = 'index.html'
const LUA_FILES = { [LUA_FILE]: 'print("Hello")\n' }
const HTML_FILES = { [HTML_FILE]: '<!doctype html><html><body><h1>Hello</h1></body></html>\n' }

function init_pattern(
	project: string,
	files: Record<string, string>,
	setup: ReadonlyArray<string>,
	project_probes: ReadonlyArray<string> = [],
): Scenario {
	return fresh_machine_spec.define({
		name: `kit-test-${project}-init`,
		files,
		commands: [...setup, ...INIT_COMMANDS],
		probes: [...INIT_PROBES, ...project_probes, ...PATH_PROBES],
	})
}

function start_pattern(
	project: string,
	files: Record<string, string>,
	setup: ReadonlyArray<string>,
	profile?: string,
): Scenario {
	return fresh_machine_spec.define({
		name: `kit-test-${project}-start`,
		requires_github: true,
		package_source: 'published',
		files,
		commands: [SIGN_IN, ...setup, ...start_commands(profile)],
		probes: [...START_PROBES, ...PATH_PROBES],
	})
}

const PATTERNS: ReadonlyArray<Scenario> = [
	init_pattern('lua', LUA_FILES, [BARE_MANIFEST]),
	// No Git: `josh start` creates the repository, the first commit and the GitHub repository.
	start_pattern('lua', LUA_FILES, [MACHINE_IDENTITY, BARE_MANIFEST], 'basic'),
	init_pattern('html', HTML_FILES, [BARE_MANIFEST]),
	// Git with a first commit on `main`, no GitHub repository.
	start_pattern('html', HTML_FILES, [...FIRST_COMMIT, BARE_MANIFEST]),
	init_pattern('svelte', {}, [CREATE_SVELTEKIT, SV_VERSION, SVELTEKIT_CHECKS], [SVELTEKIT_CHECKS]),
	// A GitHub repository with `main` already pushed.
	start_pattern('svelte', {}, [CREATE_SVELTEKIT, ...FIRST_COMMIT, CREATE_REPOSITORY]),
]

function names(): Array<string> {
	return PATTERNS.map((pattern) => pattern.name)
}

function find(name: string): Scenario | undefined {
	return PATTERNS.find((pattern) => pattern.name === name)
}

const fresh_machine_patterns = { names, find }

export { fresh_machine_patterns }
