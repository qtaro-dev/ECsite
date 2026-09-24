# 自作PCパーツECサイト マルチエージェント担当割当・実行計画（レビュー版）

**版** 0.9 ／ **作成日** 2026年9月25日 ／ **状態** 計画のみ。LUNA-A・LUNA-Bの製品実装は未開始。  
**対象GitHubリポジトリ** [qtaro-dev/ECsite](https://github.com/qtaro-dev/ECsite)  
**チケットの正本** [ルート直下の47件](../tickets/) と[チケット索引](implementation-tickets.md)。[進捗一覧](implementation-status.html)は実装状態を表示する。本書は担当と実行順を指定し、個別チケットの仕様・依存・受け入れ条件は変更しない。

## 1. 前提と割当方針

LUNA-AはDB、RLS、カートのサーバー処理、送料・税、注文、在庫、Stripe、管理側の在庫・注文・送料、横断セキュリティ、最終CI/CDを継続担当する。LUNA-Bはワイヤー、API契約、共通UI、商品探索・表示、Supabase Auth/Google/メール/SMS、会員・構成画面、管理側の商品・SMTP、デモ、画面品質、E2E、公開説明を継続担当する。LUNA-Aが22件、LUNA-Bが25件を担当する。件数の均等化より、状態変更と秘密の境界を一人が追えることを優先した。

既存の推奨順序は直列作業の基準である。本書では**番号と依存関係を一切変更せず**、依存が完了し、変更ファイルが分離できるチケットだけ前倒しして並行させる。1エージェントが同時に扱うチケットは常に1件。空き時間があっても、依存未完了や競合する仕事を無理に開始しない。フェーズF0–F7とWave W01–W35は計画上の実行枠であり、所要時間の見積ではない。

このワークスペースには現時点で`.git`がなく、指定リポジトリへの接続も確認できていない。T01で利用者の権限・既存リポジトリ状態を確認し、既存内容を上書きせず接続する。接続に認証やアカウント操作が必要な場合は利用者へ具体的に提示する。本書はリポジトリの中身を確認済みと仮定しない。

## 2. 実行フェーズと並行枠

| フェーズ | Wave | LUNA-A | LUNA-B | 進行ゲート |
| --- | --- | --- | --- | --- |
| F0 接続と契約 | W01–W03 | T01 | T02→T03 | T01の共通土台をマージ後、ワイヤーとOpenAPIを確定。 |
| F1 共通基盤 | W04–W05 | T04→T06 | T12→T05 | T04とT12、T06とT05はファイル領域が独立。 |
| F2 DB・権限 | W06–W10 | T07→T08→T09→T10 | T11（T10後） | SQLマイグレーションとRLSは並列編集しない。T11は全DB権限確定後。 |
| F3 カタログと計算 | W11–W14 | T27→T23 | T13→T14→T15→T16 | 検索と送料の別モジュールを並行。T23はT13確定後。 |
| F4 認証・会員・管理入口 | W15–W19 | T25→T36→T40 | T17→T18→T20→T19→T21 | T17の認証共通部を先にマージ。並行時は認証ヘルパー・SQLを共有編集しない。 |
| F5 購入と決済 | W20–W26 | T28→T29→T30→T31→T32→T34 | T24→T26→T37→T33 | 注文トランザクション・Webhook・CronはAが直列。構成UIを確定してから注文確認を作る。 |
| F6 削除・管理・統合 | W27–W31 | T38→T39 | T22→T35→T42→T41 | T22とT35は単独検証。T38のDB変更中にT41のVault変更を走らせない。 |
| F7 横断検証・公開 | W32–W35 | T44→T46 | T43→T45→T47 | CSS/UIとRLS/API監査のみ条件付き並行。E2E、CI/CD、公開は直列ゲート。 |

**表の読み方**：同じWaveにAとBがあれば同時着手の候補である。両方の依存PRがマージ済みで、予定変更ファイルが重ならないことを開始直前に確認する。片方が完了しても、相方の未確定変更を前提に次のチケットへ進まない。Wave内のPRも1件ずつレビュー・マージ・再検証する。

## 3. 47件の担当表

**開始条件**は個別チケットの直接依存をすべて列挙し、すべてがマージ済みであることを意味する。**並行可能**は同じWaveに配置した候補であり、実際のファイル差分に重複があれば単独実行へ切り替える。**完了後に解放**は、そのWaveの両担当がマージ済みになった時点で全依存を満たす直接後続のみを示す。空欄相当の「—」は別の依存が残るか、後続がないことを示す。

| 実行フェーズ / Wave | チケット | 担当 | 主変更対象 | 開始条件となる依存チケット | 並行実行可能なチケット | 競合注意事項 | 完了後に次に解放されるチケット |
| --- | --- | --- | --- | --- | --- | --- | --- |
| F0 / W01 | [T01](../tickets/T01-github-repository-scaffold.md) | LUNA-A | ルート設定、README、Git接続 | — | — | 共通土台。単独で確定 | T02 |
| F0 / W02 | [T02](../tickets/T02-screen-wireframes.md) | LUNA-B | 画面ワイヤー、遷移図 | T01 | — | T01の構成確定後 | T03、T12 |
| F0 / W03 | [T03](../tickets/T03-openapi-contract.md) | LUNA-B | OpenAPI、API契約 | T02 | — | OpenAPI契約を先に固定 | T04 |
| F1 / W04 | [T04](../tickets/T04-shared-zod-schemas.md) | LUNA-A | 共通Zod・エラー型 | T03 | T12 | BのCSS/シェルと共通型を分離 | T05、T06 |
| F1 / W04 | [T12](../tickets/T12-design-system-shell.md) | LUNA-B | CSSトークン・共通シェル | T01、T02 | T04 | AのZodと共通型を分離 | — |
| F1 / W05 | [T06](../tickets/T06-member-product-schema.md) | LUNA-A | 会員・商品SQL | T01、T04 | T05 | BのCIとSQLを分離 | T07 |
| F1 / W05 | [T05](../tickets/T05-ci-baseline.md) | LUNA-B | Actions初期CI | T01、T03、T04 | T06 | AのSQLとActionsを分離 | — |
| F2 / W06 | [T07](../tickets/T07-inventory-order-payment-schema.md) | LUNA-A | 在庫・注文・決済SQL | T06 | — | SQL直列 | T08、T09 |
| F2 / W07 | [T08](../tickets/T08-settings-notification-audit-schema.md) | LUNA-A | 設定・通知・監査SQL | T06、T07 | — | SQL直列 | — |
| F2 / W08 | [T09](../tickets/T09-public-storage-rls.md) | LUNA-A | 公開/Storage RLS | T06、T07 | — | RLS/SQL直列 | T10 |
| F2 / W09 | [T10](../tickets/T10-member-admin-rls.md) | LUNA-A | 会員・管理RLS | T07、T08、T09 | — | RLS/SQL直列 | T11、T17 |
| F2 / W10 | [T11](../tickets/T11-test-data-fixtures.md) | LUNA-B | seed・fixture | T06、T07、T08、T09、T10 | — | DB・RLS確定後にseed | T13、T27 |
| F3 / W11 | [T27](../tickets/T27-shipping-tax-calculator.md) | LUNA-A | 送料・税計算 | T04、T08、T11 | T13 | Bの商品検索APIと分離 | — |
| F3 / W11 | [T13](../tickets/T13-product-search-api.md) | LUNA-B | 商品検索API | T03、T04、T09、T11 | T27 | Aの送料モジュールと分離 | T14、T23 |
| F3 / W12 | [T23](../tickets/T23-compatibility-engine-api.md) | LUNA-A | 互換性API/判定 | T06、T09、T11、T13 | T14 | Bの商品検索契約マージ後 | — |
| F3 / W12 | [T14](../tickets/T14-home-category-search-ui.md) | LUNA-B | トップ・一覧UI | T12、T13 | T23 | Aの互換性APIとUIを分離 | T15 |
| F3 / W13 | [T15](../tickets/T15-product-detail-image.md) | LUNA-B | 商品詳細・画像 | T09、T12、T13、T14 | — | 単独。画像/一覧連携を確定 | T16 |
| F3 / W14 | [T16](../tickets/T16-catalog-exceptions.md) | LUNA-B | カタログ異常系 | T13、T14、T15 | — | 単独。商品データとの整合 | — |
| F4 / W15 | [T17](../tickets/T17-supabase-email-auth.md) | LUNA-B | Supabase Auth・認証画面 | T06、T10、T12 | — | 認証共通部を単独確定 | T18、T20、T21、T25、T36 |
| F4 / W16 | [T25](../tickets/T25-anonymous-member-cart-api.md) | LUNA-A | カートAPI | T07、T10、T15、T17 | T18 | BのOAuthと認証共通部を分離 | T24、T26 |
| F4 / W16 | [T18](../tickets/T18-google-oauth.md) | LUNA-B | Google OAuth | T17 | T25 | AのカートAPIは認証共通部を編集しない | — |
| F4 / W17 | [T36](../tickets/T36-admin-auth-shell.md) | LUNA-A | 管理認可・シェル | T10、T12、T17 | T20 | BのメールHookと認証共通部を分離 | T37、T40、T41 |
| F4 / W17 | [T20](../tickets/T20-auth-email-hook-smtp.md) | LUNA-B | メールHook・送信 | T08、T17 | T36 | Aの管理シェルは認証共通部を編集しない | T19、T41 |
| F4 / W18 | [T19](../tickets/T19-mock-sms-password-reset.md) | LUNA-B | 模擬SMS・再設定 | T08、T17、T20 | — | T20のメールHook確定後 | — |
| F4 / W19 | [T40](../tickets/T40-admin-shipping-settings.md) | LUNA-A | 送料管理画面 | T08、T27、T36 | T21 | Bの配送先ルートと管理ルートを分離 | — |
| F4 / W19 | [T21](../tickets/T21-member-address-ui-api.md) | LUNA-B | 配送先・会員画面 | T10、T12、T17 | T40 | Aの送料管理と会員ルートを分離 | T28 |
| F5 / W20 | [T24](../tickets/T24-pc-build-check-ui.md) | LUNA-B | 構成チェックUI | T12、T15、T23、T25 | — | 構成UIを単独確定 | — |
| F5 / W21 | [T28](../tickets/T28-checkout-quote-review.md) | LUNA-A | 購入確認・見積 | T21、T23、T25、T27 | T26 | BのカートUIと共通UIを同時編集しない | T29 |
| F5 / W21 | [T26](../tickets/T26-cart-ui-estimated-shipping.md) | LUNA-B | カートUI | T12、T25、T27 | T28 | Aの購入画面と共通UIを同時編集しない | — |
| F5 / W22 | [T29](../tickets/T29-atomic-order-stock-allocation.md) | LUNA-A | 注文・在庫引当SQL | T07、T10、T27、T28 | — | 注文SQL・在庫を単独確定 | T30、T38 |
| F5 / W23 | [T30](../tickets/T30-stripe-test-checkout-session.md) | LUNA-A | Stripe Session | T29 | T37 | Bの商品管理とSQLを同時編集しない | T31 |
| F5 / W23 | [T37](../tickets/T37-admin-products-specs-images.md) | LUNA-B | 商品管理画面/API | T06、T09、T15、T36 | T30 | AのStripe SessionとSQLを同時編集しない | — |
| F5 / W24 | [T31](../tickets/T31-stripe-webhook-state.md) | LUNA-A | Webhook・決済状態 | T29、T30 | — | Webhook・決済状態を単独確定 | T32、T34 |
| F5 / W25 | [T32](../tickets/T32-payment-expiry-reconciliation.md) | LUNA-A | 期限切れ・照合 | T31 | — | Cron/照合を単独確定 | T33 |
| F5 / W26 | [T34](../tickets/T34-order-notification-jobs.md) | LUNA-A | 注文通知ジョブ | T08、T20、T31 | T33 | Bの結果UIと通知ジョブを分離 | T22、T35、T39 |
| F5 / W26 | [T33](../tickets/T33-checkout-result-order-history.md) | LUNA-B | 決済結果・履歴 | T12、T17、T31、T32 | T34 | Aの通知ジョブと注文画面を分離 | T35、T39 |
| F6 / W27 | [T22](../tickets/T22-account-retention-deletion.md) | LUNA-B | 削除・30日保持 | T17、T21、T31、T32、T34 | — | 削除SQL・共用DBを単独検証 | — |
| F6 / W28 | [T35](../tickets/T35-checkout-integration-acceptance.md) | LUNA-B | 購入E2E/統合 | T26、T28、T29、T30、T31、T32、T33、T34 | — | 共用テストDBを単独占有 | T42 |
| F6 / W29 | [T38](../tickets/T38-admin-inventory-adjustment.md) | LUNA-A | 在庫管理画面/API | T07、T29、T36 | — | 在庫SQL・管理を単独確定 | — |
| F6 / W30 | [T39](../tickets/T39-admin-orders-payments-readonly.md) | LUNA-A | 注文管理参照画面 | T31、T32、T33、T34、T36 | T42 | Bのデモfixtureと共用DB試験を分離 | — |
| F6 / W30 | [T42](../tickets/T42-abnormal-demo-paths.md) | LUNA-B | 異常系デモ導線 | T11、T23、T25、T27、T24、T26、T28、T29、T30、T31、T32、T33、T34、T35 | T39 | Aの注文管理とfixture/共用DB試験を分離 | — |
| F6 / W31 | [T41](../tickets/T41-admin-smtp-settings.md) | LUNA-B | SMTP管理画面 | T08、T20、T36 | — | Vault/秘密設定SQLを単独確定 | T43、T44 |
| F7 / W32 | [T44](../tickets/T44-security-rls-retention-audit.md) | LUNA-A | 横断セキュリティ監査 | T09、T10、T17、T18、T20、T19、T21、T29、T30、T31、T32、T33、T34、T22、T36、T37、T38、T39、T40、T41 | T43 | BのUI改修と同一ファイルを同時編集しない | T45 |
| F7 / W32 | [T43](../tickets/T43-responsive-accessibility-final.md) | LUNA-B | レスポンシブ・a11y | T14、T15、T16、T21、T24、T26、T28、T33、T36、T37、T38、T39、T40、T41 | T44 | Aの監査と同一画面を同時編集しない | T45 |
| F7 / W33 | [T45](../tickets/T45-full-e2e-performance.md) | LUNA-B | 全体E2E・性能 | T35、T42、T43、T44 | — | 全体E2Eを単独実行 | T46 |
| F7 / W34 | [T46](../tickets/T46-cicd-vercel-supabase-release.md) | LUNA-A | CI/CD・環境分離 | T05、T45 | — | 環境・CI/CDを単独確定 | T47 |
| F7 / W35 | [T47](../tickets/T47-public-demo-operations-portfolio.md) | LUNA-B | 公開・運用資料 | T22、T42、T43、T44、T45、T46 | — | 公開判断・運用資料を単独確定 | — |

## 4. ファイル所有と競合を避ける規則

| 領域 | 主担当 | 並行時の扱い |
| --- | --- | --- |
| `supabase/migrations/`、RLS SQL、DB関数 | 原則A。BのT22/T37/T41等で変更が必要なら、そのWaveを単独にする | 同時にSQLファイルを作らない。タイムスタンプ順とDB状態を一つのPRごとに確定する。 |
| `src/server/orders/`、`payments/`、`shipping/`、在庫API | A | 金額・在庫・決済の共有型を変えるときはBへ契約差分を先に通知する。 |
| `src/server/catalog/`、`src/features/catalog/`、商品画面 | B | Aの互換性判定T23が読む仕様型をT13で固定し、T13マージ後にT23を開始する。 |
| `src/server/auth/`、Auth画面、メール/SMS | B | AのT25/T36はT17で確定した本人・管理者判定インターフェースを使い、認証ヘルパーを並行編集しない。 |
| `src/styles/`、`src/components/`、公開UI | B | Aの購入画面T28は既存部品を利用し、共通部品変更が必要ならBの作業完了後に行う。 |
| `src/app/admin/` | T36/T40/T38/T39はA、T37/T41はB | T36で管理シェルを確定。以後は別ルートを扱い、共通ナビ・レイアウトの変更は直列化する。 |
| `.github/workflows/` | T05はB、T46はA | T05マージ後にT46へ引き継ぐ。Vercel Git連携とActionsからの二重デプロイはしない。 |
| `docs/api/openapi.yaml`、`src/lib`共通型 | T03はB、T04はA。後続は担当チケットが更新 | 変更前に契約差分を両者で共有し、同時編集が必要なら片方を止める。 |
| `tests/`、`supabase/seed.sql` | 機能担当とT11/T35/T45のB | 同一テストファイルや共用seedへの並行書込を避け、必要なら別ファイル・別DBで検証する。 |

表のパスは実装前の予測である。T01後の実際の構成が異なる場合も「同一ファイル・同一マイグレーション・同一テストDBは同時編集しない」という規則を優先する。並行候補でSQL、共通認証、共通UI、OpenAPIの同時変更が必要になったら、そのWaveを直列化し、依存IDを勝手に書き換えない。

## 5. マルチエージェント運用ルール

1. 各LUNAは作業前に[AGENTS.md](../AGENTS.md)、自分の[個別チケット](../tickets/)、要件・基本・詳細設計の該当箇所を読む。担当外チケットを実装しない。
2. LUNA-A/Bは別のGit worktreeと`feature/Txx-luna-a`または`feature/Txx-luna-b`ブランチを使う。作業開始点は、直前に承認・マージされた`main`である。未マージの相手ブランチを依存の代わりに使わない。
3. 開始前に依存PRのマージ、CI、DB適用状態、変更予定ファイルを確認する。依存未完了なら待つ。同じファイル、SQLマイグレーション、共通設定、共用テストDBを同時変更・同時リセットしない。
4. 各チケットのPRはチケットID、要件ID、変更ファイル、設計根拠、受け入れ条件、実行したテスト結果、DB/RLS/秘密の影響、外部作業の未完了を記載する。テスト失敗を隠さず、テストや仕様を弱めない。
5. 競合、設計矛盾、金銭・個人情報・認証・在庫・公開範囲の判断が必要になれば停止してSOLと利用者に報告する。推測で設計変更・権限緩和・課金設定をしない。
6. 並行PRのマージは直列に行う。1件目のマージ後、2件目を最新`main`へ更新し、型・単体・DB/RLS・E2Eの該当ゲートを再実行してからマージする。**マージ後の状態だけ**を次チケットの基準にする。
7. 一方の変更を前提とする作業は、相手のPRがマージされ必要なマイグレーションが適用されてから開始する。レビュー中のコードを仮定した先行実装はしない。
8. 外部サービスのアカウント作成、本人認証、有料契約は対応ゲートの時点で利用者へ作業内容・費用・代替案を提示する。この計画の承認はそれらの操作の承認を意味しない。
9. 進捗一覧`docs/implementation-status.html`の編集責任者はLUNA-Bとする。LUNA-Aは担当チケットの状態、PR/commit、テスト結果をSOLとLUNA-Bへ報告する。LUNA-Bは各Waveの実装PRがマージされた後、最新`main`を基準に一覧だけを更新し、状態更新用PRを作る。LUNA-A/Bは同じ一覧ファイルを並行編集しない。LUNA-Bが不在ならSOLが更新担当を明示して1名だけに割り当てる。
10. 一覧の「未実装」は着手前、「実装中」は作業中、「レビュー中」はPRレビュー中、「完了」は受け入れ条件・必要テスト・レビュー・マージが済んだ状態、「保留」は依存・外部設定・設計判断等で進められない状態を指す。**完了判定の正本はマージ済みPRとCI結果**であり、HTMLの表示だけで依存を解放しない。状態更新PRは製品コードを含めない。

## 6. Waveのゲートと停止条件

- **W01**：T01で指定GitHubリポジトリの現状・所有権・既存ファイルを確認する。空だと決めつけてforce pushしない。
- **W05–W10**：DB/RLSをAが直列に確定。BはT05以外のDB関連作業に着手しない。T11はT10のマージとローカル再構築後。
- **W16–W19**：T17の認証基盤をマージしてからAがカート・管理者共通処理に着手する。Google/SMTP/SMSの外部設定が未了なら接続試験は未完了と明示する。
- **W20–W26**：T24で互換性警告UIを確定してからT28注文確認を実装する。T29–T32は在庫・決済の状態機械としてAが連続管理する。Stripeテスト鍵のみ使用する。
- **W27–W31**：T22削除とT35購入統合は共有DBを占有する単独ゲート。T38の在庫SQLとT41の秘密設定SQLは同時適用しない。
- **W32**：T43はCSS/画面、T44はRLS/API/秘密の監査に範囲を分ける。両者が同一ファイルへ触れる必要が出たら直列化する。
- **W33–W35**：T45全体E2E、T46環境・CI/CD、T47公開を順に完了する。公開判断は利用者と行い、実課金・実SMS・実発送は行わない。

## 7. 完了報告と引き継ぎ書式

各担当はチケット完了時、少なくとも次をPRとSOLへの報告に記す。

```text
チケットID / 担当 / ブランチ / ベースmainコミット
変更したファイルと設計箇所
受け入れ条件ごとの結果
実行したテスト、結果、未実行の理由
DBマイグレーション・RLS・環境変数・秘密への影響
外部サービス設定の要否と利用者作業
残課題、競合、次に解放されるチケット
```

SOLはマージ順、全依存、同時変更ファイル、DB適用、CIの状態を確認して次Waveを解放する。LUNA間の口頭合意だけでチケットを完了扱いにしない。LUNA-Bはその判定結果を[HTML進捗一覧](implementation-status.html)へ反映する。

## 8. 今回行っていないこと

本書の作成でLUNA-A/Bを起動せず、ブランチ、PR、GitHub設定、Vercel/Supabase設定、製品コードは変更しない。指定リポジトリは利用者指定の作業先として記録し、アクセス確認はT01の開始ゲートとする。
