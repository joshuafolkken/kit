import { init_logic } from '#scripts/init/init-logic'

// **`josh sync` distributes more than the three `AI_COPY_*` lists**, and a gate that reads only
// those is narrower than the instruction it replaced (joshuafolkken/kit#1578). The prose that
// instruction lived in named `playwright.config.ts` as its own worked example — a file no `AI_COPY_*`
// list holds — so a matcher built from those lists alone would have answered "not distributed" for
// the very file the rule was written about.
//
// These are the consumer-root-relative destinations `sync_project_artifacts` and `sync_config_files`
// write, in `scripts/sync/sync.ts`. `synced-paths.test.ts` reads that file and fails when a
// destination appears there that is not listed here, so the two cannot drift apart the way a
// hand-copied list would.

// Written by `sync_project_artifacts` before it reaches the config files.
const SYNCED_ARTIFACT_PATHS: ReadonlyArray<string> = [
	'prettier.config.js',
	'playwright.config.ts',
	'.github/workflows/deploy-vps.yml',
]

// Written by `sync_config_files`, one call per entry.
const SYNCED_CONFIG_PATHS: ReadonlyArray<string> = [
	'.npmrc',
	'.gitignore',
	'eslint.config.js',
	'tsconfig.json',
	'cspell.config.yaml',
	'lefthook.yml',
	'.secretlintrc.json',
	'.vscode/extensions.json',
	'.vscode/settings.json',
]

// **`package.json` is deliberately absent.** `sync` does not overwrite it — it realigns one field,
// `devEngines.packageManager.version`, with the `packageManager` pin. Listing it would fire the gate
// on every dependency change in every repository, which is noise rather than a confirmation, and the
// pin itself is already protected by its own prohibition in `CLAUDE.md`.
const EXCLUDED_SYNC_TARGETS: ReadonlyArray<string> = ['package.json']

// The Sonar destination is read from `init_logic` rather than repeated, because it is already a
// single source there and `sync.ts` reaches it the same way.
function get_synced_paths(): Array<string> {
	return [
		...SYNCED_ARTIFACT_PATHS,
		...SYNCED_CONFIG_PATHS,
		init_logic.get_sonar_template_destination(),
	]
}

const synced_paths = { get_synced_paths }

export { synced_paths, SYNCED_ARTIFACT_PATHS, SYNCED_CONFIG_PATHS, EXCLUDED_SYNC_TARGETS }
