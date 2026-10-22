# T64 Dependabot更新PRのCI失敗調査

## 目的
PR #117（Vitest）、#119（Next.js）の必須Catalog UI browser tests失敗について、既存競合か更新起因かを証拠に基づいて特定する。

## 対応要件ID・参照
QLT系品質要件、AGENTS.md、.github/workflows/ci.yml、tests/e2e/t61-prebuilt-part-selection.spec.ts、playwright.config.ts。

## 依存・対象
T60/T61/T63後のmain 928e2e6を基準とする。初回は失敗時のtest-results artifact保存のみ追加し、製品・テスト挙動を維持する。対象外は業務仕様変更、テスト弱体化、Requiredチェック変更、本番DB操作。

## 調査状況
- #117/#119は同じT61行14で失敗し53/54成功（親担当のActionsログ確認）。
- T53 migrationで旧構成PCは作成・公開される。seedや他E2Eは対象slugを変更しない。
- 管理一覧は検索条件適用後に100件制限するため、追加fixtureの件数だけでは検索行は消えない。
- fullyParallel=trueのE2Eで、T60ログアウトとT61等が同一T36管理者アカウントを使用。signOutはscope指定なしで他セッション干渉の候補。ただし未確定。
- 元CIはtraceをretain-on-failureで生成するがartifactをアップロードしない。まず同じmain依存で診断成果物を保存し、失敗画面・検索URL・認証状態を確認する。

## 受け入れ条件・必要テスト・完了条件
trace/error-contextとActionsログから原因を特定し、最小修正後に関連E2Eと既存品質チェックを通す。#117/#118/#119への適用先・検証結果と推奨マージ順を報告する。証拠不足の段階では完了としない。

## 承認境界
ユーザーの確認前にマージ・本番デプロイを行わない。調査PRを作成してCIで検証する。

CIローカル限定でT36管理者の2セッションを生成し、一方のglobal logout前後で他方のAuth user HTTP statusのみを記録する診断も実施する。既存E2Eログイン前に実行し、秘密値や応答本文は記録しない。
