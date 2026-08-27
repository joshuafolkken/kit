## 配布ドキュメント・設定の変更は kit に上流化する

`CLAUDE.md` および kit が配布する他のドキュメント／設定は、kit から単一ソースで配布される。

- **消費者リポジトリ（app-kit / game-kit）ではこれらをローカル編集しない**: `josh sync` が編集を上書きするうえ、変更は本来上流（kit）に属する。ドキュメント／設定を編集する前に、それが配布物かどうかを確認し、配布物なら kit 側に変更を提案（Issue／PR）する
- **kit リポジトリ自身ではあなたが配布元**なので、ここでは編集してよい。編集先は `CLAUDE.md` 1 本である（次節）
- このルールは横断ドキュメント（CLAUDE.md「Route distributed-doc / config changes upstream to kit」）のカノニカル参照
