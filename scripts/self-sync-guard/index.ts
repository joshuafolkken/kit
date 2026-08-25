// The public surface a downstream distribution package imports to refuse a sync aimed at its own
// repository. Exported rather than left internal because app-kit and game-kit run the same kind of
// copy and would otherwise each re-implement the detection (joshuafolkken/kit#868), which is the
// duplication `managed-marker` was extracted to avoid for the workflow stamp.
export { self_sync_guard } from './self-sync-guard-logic'
