// The path transform that makes kit's distributed AI documents resolve in a consumer, and the
// one-line CLAUDE.md import that replaces the old byte-copy (joshuafolkken/kit#1878). Applied at
// publish time to CLAUDE.md (scripts/build/build-claude-md.ts) and at copy time to the pointer files kit
// still ships whole (AGENTS.md / GEMINI.md / .cursorrules, via init-copy-content.ts).

// Where kit's own published files sit once a consumer has installed the package. Backtick-quoted
// references to anything kit ships are rewritten to this location so a consumer opens the installed
// copy rather than a path that exists only in the kit repository.
const KIT_PACKAGE_PATH_PREFIX = 'node_modules/@joshuafolkken/kit/'

const PROMPTS_PACKAGE_PREFIX = `${KIT_PACKAGE_PATH_PREFIX}prompts/`
const ESLINT_PACKAGE_PREFIX = `${KIT_PACKAGE_PATH_PREFIX}eslint/`

// kit files that are NOT published (tests, docs/) cannot be rewritten to a node_modules path — the
// consumer never receives them — so their backtick references become full GitHub URLs instead. A
// directory reference (trailing slash) points at the tree view, a file at the blob view.
const GITHUB_REPO_BLOB_BASE = 'https://github.com/joshuafolkken/kit/blob/main/'
const GITHUB_REPO_TREE_BASE = 'https://github.com/joshuafolkken/kit/tree/main/'

// The consumer imports kit's published, already path-transformed rules. A tracked bootstrap note
// remains readable before installation, while the rule body stays in the package (kit#1878).
const CLAUDE_MD_IMPORT_LINE = '@node_modules/@joshuafolkken/kit/dist/CLAUDE.md'
const CLAUDE_MD_BOOTSTRAP =
	'> Fresh checkout: if kit is not installed, run `pnpm install` first, then reread this file before doing any other work.'

// A span containing `*` is excluded: it is a **glob**, not a reference to a file a consumer can
// open. A distributed document that writes a directory set as `prompts/**` means "anything beneath
// it", and rewriting that to `node_modules/@joshuafolkken/kit/prompts/**` would print a path that can
// never appear in a consumer's diff and is not what the set matches (joshuafolkken/kit#907).
function transform_prompt_paths(content: string): string {
	return content.replaceAll(
		/`prompts\/([^`*]+)`/gu,
		(_match, prompt_path: string) => `\`${PROMPTS_PACKAGE_PREFIX}${prompt_path}\``,
	)
}

// The eslint/ directory is published (package.json `files`), so its backtick references — the
// distributed lint rules such as `eslint/rules/test-filename.js` — resolve in a consumer once
// rewritten to the installed location. Globs are skipped for the same reason prompts globs are.
function transform_eslint_paths(content: string): string {
	return content.replaceAll(
		/`eslint\/([^`*]+)`/gu,
		(_match, eslint_path: string) => `\`${ESLINT_PACKAGE_PREFIX}${eslint_path}\``,
	)
}

// Test files are excluded from the package (`files` carries `!**/*.test.ts`), so a backtick
// reference to one would be dead in a consumer. Rewrite it to the GitHub source instead, wherever in
// the tree it lives.
function transform_test_file_paths(content: string): string {
	return content.replaceAll(
		/`([^`*]+\.(?:test|spec)\.ts)`/gu,
		(_match, test_path: string) => `\`${GITHUB_REPO_BLOB_BASE}${test_path}\``,
	)
}

function github_url_base(reference_path: string): string {
	return reference_path.endsWith('/') ? GITHUB_REPO_TREE_BASE : GITHUB_REPO_BLOB_BASE
}

// docs/ is not published, so its backtick references become GitHub URLs too. A bare `docs/` points at
// the tree view; a file underneath it at the blob view.
function transform_documentation_paths(content: string): string {
	return content.replaceAll(
		/`(docs\/[^`*]*)`/gu,
		(_match, documentation_path: string) =>
			`\`${github_url_base(documentation_path)}${documentation_path}\``,
	)
}

// Every rewrite applied to a file kit distributes verbatim, so its backtick path references resolve
// in a consumer: bundled paths (prompts/, eslint/) point into node_modules, unbundled ones (tests,
// docs/) point at GitHub.
function transform_distributed_paths(content: string): string {
	const with_prompts = transform_prompt_paths(content)
	const with_eslint = transform_eslint_paths(with_prompts)
	const with_tests = transform_test_file_paths(with_eslint)

	return transform_documentation_paths(with_tests)
}

// Keep the bootstrap note ahead of the import so an agent can read it in a fresh checkout. Preserve
// project additions and update older one-line files without duplicating either line.
function ensure_claude_md_import(existing: string | undefined): string {
	if (existing === undefined) return `${CLAUDE_MD_BOOTSTRAP}\n\n${CLAUDE_MD_IMPORT_LINE}\n`

	if (existing.includes(CLAUDE_MD_IMPORT_LINE)) {
		if (existing.includes(CLAUDE_MD_BOOTSTRAP)) return existing

		return `${CLAUDE_MD_BOOTSTRAP}\n\n${existing}`
	}

	return `${CLAUDE_MD_BOOTSTRAP}\n\n${CLAUDE_MD_IMPORT_LINE}\n\n${existing}`
}

const distributed_paths = {
	transform_prompt_paths,
	transform_distributed_paths,
	ensure_claude_md_import,
	CLAUDE_MD_IMPORT_LINE,
}

export { distributed_paths }
