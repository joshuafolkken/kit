import { createRequire } from 'node:module'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { z } from 'zod'

// joshuafolkken/kit#1454: `pnpm josh lines` asked the project's own eslint how many code lines a file
// has, and then explained that answer against **kit's** `max-lines` entry. In kit the two are the same
// object, so nothing showed; in a consumer whose `eslint.config.js` overrides the rule after
// `create_base_config`, the report and the gate described different limits — and the report was the one
// that was wrong, while `line-budget.ts` opens by declaring that agreeing with the gate is the whole of
// its purpose.
//
// **The limit is therefore asked of the configuration the gate actually applies, per file.** A flat
// config block can key an override on a `files` pattern, so "the project's limit" is not one number: a
// consumer that raises `max-lines` for generated code and leaves it alone elsewhere enforces two, and a
// report that picked either would be wrong about the other set.
//
// **The counting options travel with it, and that is not a widening of the subject.** `skipBlankLines`
// and `skipComments` decide what a code line *is*, and taking them from kit while taking the count from
// the consumer's eslint is the same defect wearing a different number. Both now come from the same
// resolved entry, so there is one source rather than two that can disagree.
//
// **This is the resolution `eslint --print-config` performs, not a second linter.** `line-budget.ts`
// refuses eslint's in-process linting API because it counts a file beginning with `#!` one line lower
// than the CLI does — and that objection is about *counting*, which nothing here does. Keeping the CLI
// for this would cost one process per path, because `--print-config` takes a single file, and one
// process per path is the one cost `line-budget.ts` is written to avoid.
//
// **The eslint that is loaded is the project's own**, resolved upward from the project root exactly as
// the CLI shim is — so a consumer's report is calculated by the consumer's eslint against the
// consumer's config, never by whichever copy happens to sit beside this file.

const ESLINT_MODULE = 'eslint'
const PACKAGE_JSON = 'package.json'
const MAX_LINES_RULE = 'max-lines'
// A rule turned off enforces nothing, so there is no limit to report and no headroom to subtract from.
// Both spellings occur: `calculateConfigForFile` normalizes severity to a number, but a config read by
// some other route can still carry the word.
const SEVERITY_OFF = 0
const SEVERITY_OFF_NAME = 'off'

interface ConfigResolver {
	calculateConfigForFile: (file_path: string) => Promise<unknown>
}

type ResolverConstructor = new (options: { cwd: string }) => ConfigResolver

// The module is imported from a path computed at runtime, so its shape is checked rather than assumed:
// a build that no longer exports `ESLint` must answer "no limit" instead of throwing past the caller.
const module_schema = z.object({
	ESLint: z.custom<ResolverConstructor>((value) => typeof value === 'function'),
})

// Exactly the object `line-budget.ts` hands back to eslint as `--rule`, `max` apart. Read through a
// schema for the same reason the probe's own entry is: the options are forwarded to eslint, so a shape
// that drifted would otherwise arrive at the probe as a silently different counting method.
const options_schema = z.looseObject({ max: z.number().int().positive() })
// **The rule takes a bare integer too, and refusing that spelling is the same defect wearing a third
// face.** eslint's own schema for `max-lines` is `oneOf: [integer, object]`, so a consumer may write
// `['error', 200]`; and because the rule declares `defaultOptions: [300]`, a bare `'max-lines': 'error'`
// resolves to `[2, 300]` before it reaches here — eslint fills its own default in, which is why no
// number is written into this file. Read only the object form and both of those report "no limit" for a
// file the gate fails at 200 or 301 lines.
const max_schema = z.number().int().positive()
const severity_schema = z.union([z.number(), z.string()])
const entry_schema = z.tuple([severity_schema, z.union([max_schema, options_schema])])
const config_schema = z.object({ rules: z.record(z.string(), z.unknown()).optional() })

// The integer spelling carries no skip options, and `max-lines` reads them as `option && option.skip…`
// — so it counts every physical line. Filling in kit's `skipBlankLines` / `skipComments` here instead
// would forward this package's counting method to a project that asked for none of it.
const INTEGER_SKIPS = { skipBlankLines: false, skipComments: false }

type LineRuleOptions = z.infer<typeof options_schema>
type LimitEntry = [string, LineRuleOptions]

function is_off(severity: number | string): boolean {
	return severity === SEVERITY_OFF || severity === SEVERITY_OFF_NAME
}

function normalized(option: number | LineRuleOptions): LineRuleOptions {
	return typeof option === 'number' ? { max: option, ...INTEGER_SKIPS } : option
}

// A configuration that names no `max-lines`, one that names it with no options, and one that turns it
// off are all the same answer here — this project enforces no line limit on this path — and the caller
// reports the count without a budget rather than inventing a number to subtract it from.
function options_in(config: unknown): LineRuleOptions | undefined {
	const rules = config_schema.safeParse(config).data?.rules ?? {}
	const entry = entry_schema.safeParse(rules[MAX_LINES_RULE])

	if (!entry.success) return undefined

	const [severity, option] = entry.data

	return is_off(severity) ? undefined : normalized(option)
}

// Resolved from the project root rather than from this file, so a consumer's config is calculated by
// the consumer's own eslint. Every failure — no eslint there, a build without the export, a config that
// throws while loading — is the same answer, and it is "no limit" rather than kit's number: falling
// back to kit's is precisely the defect this file exists to remove, and it would be silent.
async function resolver_for(project_root: string): Promise<ConfigResolver | undefined> {
	try {
		const require_from = createRequire(path.join(project_root, PACKAGE_JSON))
		const loaded: unknown = await import(pathToFileURL(require_from.resolve(ESLINT_MODULE)).href)
		const eslint_module = module_schema.parse(loaded)

		return new eslint_module.ESLint({ cwd: project_root })
	} catch {
		return undefined
	}
}

async function entry_for(
	resolver: ConfigResolver,
	file_path: string,
): Promise<LimitEntry | undefined> {
	try {
		const options = options_in(await resolver.calculateConfigForFile(file_path))

		return options === undefined ? undefined : [path.resolve(file_path), options]
	} catch {
		return undefined
	}
}

// One resolver for the whole call: the configuration is loaded and cached once, and every path after
// the first is a lookup rather than a load. That is what makes a per-file limit affordable at all.
// Keyed by the absolute path, so the caller's spelling of a path does not have to match.
async function options_for(
	file_paths: ReadonlyArray<string>,
	project_root: string,
): Promise<ReadonlyMap<string, LineRuleOptions>> {
	const found = new Map<string, LineRuleOptions>()
	const resolver = file_paths.length === 0 ? undefined : await resolver_for(project_root)

	if (resolver === undefined) return found

	const entries = await Promise.all(
		file_paths.map(async (file_path) => await entry_for(resolver, file_path)),
	)
	const resolved = entries.filter((entry) => entry !== undefined)

	for (const [file_path, options] of resolved) found.set(file_path, options)

	return found
}

const effective_limit = {
	options_for,
	options_in,
}

export { effective_limit }
export type { LineRuleOptions }
