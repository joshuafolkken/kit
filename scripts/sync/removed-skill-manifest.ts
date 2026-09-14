import type { RemovedSkillManifest } from './skill-migration'

// Skill directories kit once distributed but has since retired. Unlike PLUGIN_SKILL_DIRECTORIES, a
// retired skill's source no longer ships in the package, so `josh sync` cannot byte-compare a
// consumer's stale copy against a live source. It compares against these hashes instead — the sha256
// of each file's distributed (path-transformed) content, which is consumer-independent, so one hash
// matches every consumer's untouched copy while an edited copy no longer matches and is kept.
//
// `diag` was dropped from distribution in joshuafolkken/kit#1997 because it drives kit's own run
// measurement, and its source was deleted in joshuafolkken/kit#2015; this removes the copy a consumer
// received before then (joshuafolkken/kit#1990). `removed-skill-manifest.test.ts` recomputes these
// from the repo's own skill source and fails on drift where that source still ships; an entry whose
// source has since been deleted has nothing left to recompute against, so its frozen hashes stand as
// the permanent distributed record, guarded only by the test's well-formed-sha256 shape check.
const REMOVED_SKILL_MANIFEST: RemovedSkillManifest = [
	{
		directory: '.claude/skills/diag',
		files: [
			{
				path: 'SKILL.md',
				sha256: '16e5399859fdb99033350ec41c147adf4422f2a76de88ecdfc877c4a24ab7510',
			},
		],
	},
]

export { REMOVED_SKILL_MANIFEST }
