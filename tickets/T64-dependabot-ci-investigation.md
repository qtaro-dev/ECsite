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

## 2026-10-23時点の比較根拠
- #117/#119: Quality gatesとVercel Preview成功、Catalog UI browser testsは54件中53件成功・T61行14のみ失敗（親担当のActionsログ照合）。異なる更新の同一失敗なので更新起因とは未確定。
- #118: 全4チェック成功。直前main/PR #116のCI run36993051969も両job成功（親担当確認）。常時発生するseed欠落とは考えにくく、実行タイミング依存も調べる。
- #117/#119にはActions artifactsがなく、失敗時trace/error-contextを回収できない（親担当確認）。診断PR #120で保存を追加した。
- Supabase auth-jsのsignOut既定scopeはglobal（GoTrueClient.ts、親担当確認）。ただしJWTのuser検査まで失敗するかはローカルCIのHTTP診断で確認する。仮説を根本原因と扱わない。
- 調査PR #120 run39815409343はrunner割当待ちのqueued。未実行を合格・再現なしと扱わない。

## 残検証
1. 共用管理者のlogout前後HTTP statusをCIログで確認。
2. main依存でT61失敗を再現した場合、artifactの検索URL・ログイン状態・画面DOM・ネットワークを確認。
3. 原因確定後のみ最小修正を行い、同じテスト条件と品質ゲートで再検証。
4. #117/#119へはブランチ別に修正適用・チェック成功を確認する。#118は現在成功しているが、マージ後の再評価を含め利用者へ推奨順を提示する。

## 原因確定と最小修正
PR120 run39816027068はmainと同じ依存で同じT61行14のみ失敗（53/54）。Auth診断は別セッションuser200→global logout204→別セッションuser403。artifact12443121478のerror-contextは商品一覧ではなく「管理画面を利用できません」「管理者権限が必要です」であり、T60の共有アカウントglobal logoutによる認証失効に一致する。更新固有ではない既存テストfixture競合と判定する。

T60に専用管理者t60-admin@example.testを作成し、SQLでT36/T60両方の有効な管理権限と一般会員の無権限を検証する。T60は専用資格情報を使用し、logout後も別T36管理者の画面とAPIが200であることを追加検証する。製品signOut・テスト期待・timeout・Requiredチェックは変更しない。一時HTTP診断scriptは除去し、失敗artifact保存は維持する。

修正CI成功後、同じ修正commitを#117/#119各更新ブランチへ適用し、それぞれのRequiredチェックを確認する。mainとDependabot PRはいずれもユーザー確認までマージしない。
