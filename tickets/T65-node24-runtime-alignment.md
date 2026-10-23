# T65 Node.js 24.x 統一とVercel本番反映

## 目的・対応要件
QLT系品質・CI/CD要件。ユーザー2026-10-23依頼を正とし、GitHub、CI、VercelのNode設定不一致警告を解消する。

## 依存・参照設計
main 72d8a70（Next.js 16.4.1）とT64認証テスト分離修正。AGENTS.md、docs/environment-setup.md、package.json、.github/workflows/ci.yml。

## 対象・実装内容
- package enginesとlockのルートmetadata、CIを24.xへ統一し.nvmrcでローカル推奨majorを明示。
- Next.jsの最低要件>=20.9.0とlock依存のengineを確認する。
- Vercel project.nodeVersionを24.xに揃え、Productionの実行設定・commit・Ready・主要ページを確認する。
- @types/node 22は現在使うAPI型を満たし型検査で検証する。Node24専用APIを導入しないため更新しない。

## 対象外
機能・業務仕様変更、依存の無関係更新、本番DB操作、Required check変更。PR #117/#118/#120のマージはしない。

## 受け入れ条件・必要テスト
Node24でnpm ci、TypeScript、Lint、全Vitest、OpenAPI、buildが成功。CIのCatalog UI browser testsとQuality gatesが成功。mainマージ後のVercel Productionが同じSHAでReady、nodeVersionとprojectSettings.nodeVersionが24.x、警告が残れば未完として報告。

## 完了条件
レビュー・CI・PRマージ・最新main確認、Production設定とページ確認、進捗記録を担当SOLへ引き継ぐ。

## 調査根拠
Vercelの旧ProductionはnodeVersion=24.x、projectSettings.nodeVersion=22.x、Project.nodeVersion=22.x。package engines >=20.9.0は22固定ではなく、Vercelのengines優先選択により最新24.xが選ばれていた。CIだけ22.18.0。Node24.xのLTSで統一する。
## 実装検証記録
lock内engine指定340件をsemverでNode24.22.1と機械照合し339件が適合。残る@img/sharp-win32-ia32は^20.9.0だがoptionalのWindows32bit専用であり、対象のWindows x64/Vercel Linux x64ではインストール対象外。依存更新は行わない。
Node24.22.1でnpm CLIを明示起動しnpm ci、typecheck、lint、Vitest 55 files/270 tests、OpenAPI lint、production build成功。既存Lint警告1件（schemas.ts _cause）、npm audit 9件（moderate2/high7）は今回更新せず残す。E2EはDocker依存のためGitHub Actions Node24で実施する。ローカル初回npm.cmdはNode22へ戻ったため、検証結果には明示Node24で再実行した最終結果のみ採用する。