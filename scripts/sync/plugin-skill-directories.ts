// The five skill directories kit ships as the `kit` Claude Code plugin (joshuafolkken/kit#1879). A
// consumer receives them through the plugin rather than as a copy, so this is the single source two
// places read: `skill-migration.ts` removes a consumer's stale copy of one, and
// `managed-config-scope.ts` flags a change to one as reaching consumers. It is deliberately separate
// from `init-logic.ts`'s `AI_COPY_DIRECTORIES` — which is now empty — because these directories are
// distributed but no longer copied.
const PLUGIN_SKILL_DIRECTORIES: ReadonlyArray<string> = [
	'.claude/skills/workflow-commands',
	'.claude/skills/epic-commands',
	'.claude/skills/dependency-update',
	'.claude/skills/verify-ui',
	'.claude/skills/diag',
]

export { PLUGIN_SKILL_DIRECTORIES }
