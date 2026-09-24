# 自作PCパーツECサイト 実装チケット一覧（レビュー版）

**版** 0.9 ／ **作成日** 2026年9月25日 ／ **状態** 未着手。LUNAは1件ずつ実装・検証する。  
**順序** 単独担当では`docs/implementation-plan.md`第3章、LUNA-A/Bの2エージェント運用では`docs/multi-agent-execution-plan.md`のWaveを用いる。番号は参照IDであり、依存を越えて着手しない。外部設定が必要なら利用者作業を確認してから接続試験を行う。  
**共通完了条件** `docs/implementation-plan.md`第2章と`AGENTS.md`を適用する。受け入れ条件の「表示」はPC・スマホで確認する。

**2エージェント担当と進捗** [担当割当・実行計画](multi-agent-execution-plan.md) ／ [実装進捗HTML一覧](implementation-status.html)。個別チケットの依存と内容はこの索引およびチケット本体を正とする。

## 個別チケット索引（推奨実装順）

番号は元のT01–T47のまま維持する。着手順は依存関係に従い、T20→T19、T25→T24、T27→T26、T34→T22となる。

| 実装順 | チケット | 依存 | 対応要件ID |
| ---: | --- | --- | --- |
| 01 | [T01 GitHub向けリポジトリとローカル雛形](../tickets/T01-github-repository-scaffold.md) | なし | QLT-01、SEC-01 |
| 02 | [T02 画面ワイヤーと遷移レビュー](../tickets/T02-screen-wireframes.md) | T01 | CAT-01、CAT-02、CAT-03、CMP-02、CMP-04、CMP-06、ORD-01、ORD-02、QLT-01 |
| 03 | [T03 OpenAPI初版とAPI責務表](../tickets/T03-openapi-contract.md) | T02 | QLT-01、ORD-08、SEC-01 |
| 04 | [T04 共通Zodスキーマとエラー型](../tickets/T04-shared-zod-schemas.md) | T03 | CAT-02、ACC-03、ORD-08、QLT-01 |
| 05 | [T05 CIの最小ゲート](../tickets/T05-ci-baseline.md) | T01、T03、T04 | QLT-01、SEC-01 |
| 06 | [T06 会員・商品スキーマSQL](../tickets/T06-member-product-schema.md) | T01、T04 | CAT-03、CAT-04、CAT-05、ACC-03、ACC-07 |
| 07 | [T07 在庫・注文・決済スキーマSQL](../tickets/T07-inventory-order-payment-schema.md) | T06 | INV-02、INV-03、ORD-01、ORD-06、ORD-08、ORD-10 |
| 08 | [T08 設定・通知・監査スキーマSQL](../tickets/T08-settings-notification-audit-schema.md) | T06、T07 | ACC-05、ACC-08、ORD-03、ORD-04、ORD-05、SEC-01 |
| 09 | [T09 公開データ・StorageのRLS SQL](../tickets/T09-public-storage-rls.md) | T06、T07 | CAT-03、CAT-04、SEC-01、QLT-01 |
| 10 | [T10 本人・管理者のRLS SQL](../tickets/T10-member-admin-rls.md) | T07、T08、T09 | ACC-07、ORD-06、ADM-01、SEC-01、QLT-01 |
| 11 | [T11 テストデータ定義と投入](../tickets/T11-test-data-fixtures.md) | T06、T07、T08、T09、T10 | DEM-01、CMP-01、CMP-02、INV-01、ORD-07、QLT-01 |
| 12 | [T12 デザイントークンと共通シェル](../tickets/T12-design-system-shell.md) | T01、T02 | CAT-01、CAT-03、QLT-01 |
| 13 | [T13 商品検索サービス/API](../tickets/T13-product-search-api.md) | T03、T04、T09、T11 | CAT-01、CAT-02、CAT-03、SEC-01 |
| 14 | [T14 トップ・カテゴリ・検索画面](../tickets/T14-home-category-search-ui.md) | T12、T13 | CAT-01、CAT-02、QLT-01 |
| 15 | [T15 商品詳細・画像配信](../tickets/T15-product-detail-image.md) | T09、T12、T13、T14 | CAT-03、CMP-03、ORD-01 |
| 16 | [T16 カタログ例外と初期データ検収](../tickets/T16-catalog-exceptions.md) | T13、T14、T15 | CAT-01、CAT-02、CAT-03、DEM-01 |
| 17 | [T17 Supabase SSRとメール・パスワード認証](../tickets/T17-supabase-email-auth.md) | T06、T10、T12 | ACC-01、ACC-06、SEC-01、SEC-02、ORD-01 |
| 18 | [T18 Google OAuth](../tickets/T18-google-oauth.md) | T17 | ACC-02、ACC-03、ACC-05、SEC-01 |
| 19 | [T20 Supabase Send Email HookとSMTP送信](../tickets/T20-auth-email-hook-smtp.md) | T08、T17 | ACC-01、ACC-04、ACC-08、SEC-01 |
| 20 | [T19 模擬SMSと再設定のOTP](../tickets/T19-mock-sms-password-reset.md) | T08、T17、T20 | ACC-04、ACC-05、ACC-06、ACC-09、ACC-10、SEC-02 |
| 21 | [T21 配送先と会員画面](../tickets/T21-member-address-ui-api.md) | T10、T12、T17 | ACC-03、ACC-07、ORD-01、SEC-01 |
| 22 | [T23 互換性判定エンジン/API](../tickets/T23-compatibility-engine-api.md) | T06、T09、T11、T13 | CMP-01、CMP-02、CMP-03、CMP-04、CMP-05 |
| 23 | [T25 匿名・会員カートのサーバー処理](../tickets/T25-anonymous-member-cart-api.md) | T07、T10、T15、T17 | ORD-01、INV-01、SEC-01 |
| 24 | [T27 送料・税計算器](../tickets/T27-shipping-tax-calculator.md) | T04、T08、T11 | ORD-03、ORD-04、ORD-05、ORD-08、ORD-09 |
| 25 | [T24 構成確認UI](../tickets/T24-pc-build-check-ui.md) | T12、T15、T23、T25 | CMP-01、CMP-02、CMP-03、CMP-04、CMP-05、CMP-06 |
| 26 | [T26 カートUIと概算送料](../tickets/T26-cart-ui-estimated-shipping.md) | T12、T25、T27 | ORD-01、ORD-02、INV-01 |
| 27 | [T28 住所選択・正式見積・注文確認](../tickets/T28-checkout-quote-review.md) | T21、T23、T25、T27 | ORD-01、ORD-02、ORD-06、CMP-06、INV-01 |
| 28 | [T29 原子的な注文作成・在庫引当](../tickets/T29-atomic-order-stock-allocation.md) | T07、T10、T27、T28 | INV-02、INV-03、ORD-06、ORD-08、ORD-10 |
| 29 | [T30 Stripe CheckoutテストSession](../tickets/T30-stripe-test-checkout-session.md) | T29 | ORD-01、ORD-07、ORD-08、INV-02、SEC-01 |
| 30 | [T31 Stripe Webhookと決済状態](../tickets/T31-stripe-webhook-state.md) | T29、T30 | ORD-07、ORD-08、INV-02、INV-03、QLT-01 |
| 31 | [T32 期限切れ照合と補償ジョブ](../tickets/T32-payment-expiry-reconciliation.md) | T31 | INV-02、INV-03、ORD-07、ORD-08 |
| 32 | [T33 決済結果・注文履歴画面](../tickets/T33-checkout-result-order-history.md) | T12、T17、T31、T32 | ACC-07、ORD-01、ORD-06、ORD-07、ORD-10 |
| 33 | [T34 注文・認証通知のジョブ](../tickets/T34-order-notification-jobs.md) | T08、T20、T31 | ACC-08、ORD-01、ORD-07 |
| 34 | [T22 アカウント削除と30日消去](../tickets/T22-account-retention-deletion.md) | T17、T21、T31、T32、T34 | ACC-07、ORD-10、SEC-01、QLT-01 |
| 35 | [T35 注文系の統合検収](../tickets/T35-checkout-integration-acceptance.md) | T26、T28、T29、T30、T31、T32、T33、T34 | QLT-01、DEM-01、ORD-01、INV-01、INV-03 |
| 36 | [T36 管理者判定と管理画面シェル](../tickets/T36-admin-auth-shell.md) | T10、T12、T17 | CAT-04、ADM-01、SEC-01 |
| 37 | [T37 商品・仕様・画像の管理](../tickets/T37-admin-products-specs-images.md) | T06、T09、T15、T36 | CAT-04、CAT-05、SEC-01 |
| 38 | [T38 在庫調整の管理](../tickets/T38-admin-inventory-adjustment.md) | T07、T29、T36 | CAT-04、INV-02、INV-03、SEC-01 |
| 39 | [T39 注文・決済状態の管理閲覧](../tickets/T39-admin-orders-payments-readonly.md) | T31、T32、T33、T34、T36 | ADM-01、ORD-06、SEC-01 |
| 40 | [T40 発送元・送料規則の管理](../tickets/T40-admin-shipping-settings.md) | T08、T27、T36 | ORD-03、ORD-04、ORD-05、ORD-10、SEC-01 |
| 41 | [T41 SMTP設定の管理](../tickets/T41-admin-smtp-settings.md) | T08、T20、T36 | ACC-08、SEC-01 |
| 42 | [T42 異常系デモの利用者導線](../tickets/T42-abnormal-demo-paths.md) | T11、T23、T25、T27、T24、T26、T28、T29、T30、T31、T32、T33、T34、T35 | DEM-01、INV-01、ORD-07、CMP-02、CMP-05 |
| 43 | [T43 レスポンシブ・アクセシビリティ仕上げ](../tickets/T43-responsive-accessibility-final.md) | T14、T15、T16、T21、T24、T26、T28、T33、T36、T37、T38、T39、T40、T41 | CAT-01、CAT-02、CAT-03、CMP-04、ORD-01、QLT-01 |
| 44 | [T44 セキュリティ・RLS・削除の横断検証](../tickets/T44-security-rls-retention-audit.md) | T09、T10、T17、T18、T20、T19、T21、T29、T30、T31、T32、T33、T34、T22、T36、T37、T38、T39、T40、T41 | SEC-01、SEC-02、ACC-06、INV-03、QLT-01 |
| 45 | [T45 全体E2Eと性能検収](../tickets/T45-full-e2e-performance.md) | T35、T42、T43、T44 | QLT-01、DEM-01、ORD-01、ACC-02、INV-03 |
| 46 | [T46 GitHub Actions・Vercel・SupabaseのCI/CD](../tickets/T46-cicd-vercel-supabase-release.md) | T05、T45 | QLT-01、SEC-01、SEC-02 |
| 47 | [T47 公開・運用・ポートフォリオ説明](../tickets/T47-public-demo-operations-portfolio.md) | T22、T42、T43、T44、T45、T46 | QLT-01、DEM-01、ACC-09、ORD-07、SEC-01 |

## チケット概要（番号順）

## M0 契約と土台

### [T01 GitHub向けリポジトリとローカル雛形](../tickets/T01-github-repository-scaffold.md)
- **目的**：設計資料と製品コードを追跡できる土台を作る。
- **内容・範囲**：既存資料を保全し、Git初期化、`main`、README、`.gitignore`、`.env.example`、Next.js/TypeScript/CSS Modulesの最小雛形、予定ディレクトリを用意。GitHubへの接続は利用者のリポジトリ作成・認証後。
- **依存**：なし。外部ゲートG-GitHub。
- **受け入れ条件**：秘密を追跡せず、起動・型検査が通り、資料へのリンクと非販売の説明がある。既存PDFを消さない。
- **テスト**：ローカル起動、型検査、Git追跡対象と秘密除外の確認。

### [T02 画面ワイヤーと遷移レビュー](../tickets/T02-screen-wireframes.md)
- **目的**：製品UI着手前にS01–S17、A01–A06の構造を固定する。
- **内容・範囲**：`docs/wireframes/`にPC・タブレット・スマホの主要画面、ヘッダー、検索、構成、カート、注文、認証、管理、警告・空・エラー状態と遷移を作る。デザインルールを添える。
- **依存**：T01。
- **受け入れ条件**：詳細設計の全画面IDと主要異常状態が追跡でき、0–767/768–1199/1200px以上の変化が分かる。互換性不一致でも購入導線が残る。
- **テスト**：設計画面一覧との対応表、キーボード操作・文言・320pxレイアウトのレビュー。

### [T03 OpenAPI初版とAPI責務表](../tickets/T03-openapi-contract.md)
- **目的**：画面とサーバーの契約を先に明示する。
- **内容・範囲**：`docs/api/openapi.yaml`に詳細設計第6章の経路、認証方式、入出力、共通エラー、冪等キー、Webhook生ボディを記載。Server Componentの直接取得はAPI扱いにしない。
- **依存**：T02。
- **受け入れ条件**：全主要経路に成功・主要失敗応答と権限があり、画面ワイヤーの操作と対応する。
- **テスト**：OpenAPI lint・参照解決、画面操作との手動照合。

### [T04 共通Zodスキーマとエラー型](../tickets/T04-shared-zod-schemas.md)
- **目的**：入力・応答形式を一箇所で管理する。
- **内容・範囲**：共通ID、円額、数量、検索クエリ、住所、API成功/失敗、状態列挙のZodスキーマと型を作る。秘密やDBエラーの応答漏出を防ぐ。
- **依存**：T03。
- **受け入れ条件**：OpenAPIと矛盾せず、サーバー再検証のために利用できる。未使用の推測フィールドを増やさない。
- **テスト**：Vitestで正常・境界・不正値、OpenAPI契約との差分確認。

### [T05 CIの最小ゲート](../tickets/T05-ci-baseline.md)
- **目的**：以後のチケットが同じ品質チェックを通るようにする。
- **内容・範囲**：GitHub ActionsでPR・mainのlint、型検査、Vitest、OpenAPI lint、ビルドを実行。Node/依存を固定しキャッシュする。外部秘密を使わない。
- **依存**：T01、T03、T04。外部ゲートG-GitHubは実行時のみ。
- **受け入れ条件**：PRで成功・失敗が可視化され、秘密を必要とするテストをPRの未信頼コードへ渡さない。
- **テスト**：ローカル同等コマンド、意図的な型エラーでCI失敗の確認。

## M1 データと権限

### [T06 会員・商品スキーマSQL](../tickets/T06-member-product-schema.md)
- **目的**：会員補助情報と8カテゴリの商品を型付きで保持する。
- **内容・範囲**：`profiles`、`admin_memberships`、`addresses`、`categories`、`products`、用途・画像、8仕様表をマイグレーション化。制約、FK、索引、公開時必須値検証を含む。
- **依存**：T01、T04。
- **受け入れ条件**：詳細設計第4.1/4.2章と一致し、仕様不足商品は下書き・テストデータとして表現できる。商品カテゴリと仕様表の不一致を拒否する。
- **テスト**：Supabaseローカル`db reset`、DB制約・索引・FKの統合テスト。

### [T07 在庫・注文・決済スキーマSQL](../tickets/T07-inventory-order-payment-schema.md)
- **目的**：金額・在庫・決済履歴を独立した状態で保持する。
- **内容・範囲**：`inventory`、`stock_allocations`、`carts`、明細、`orders`、明細スナップショット、`payment_attempts/events`、在庫調整ログをマイグレーション化。
- **依存**：T06。
- **受け入れ条件**：`allocated<=on_hand`、試行一意性、商品削除後の注文履歴、金額非負・合計整合の制約がある。
- **テスト**：ローカル再構築、重複・負数・不正遷移用DB試験。

### [T08 設定・通知・監査スキーマSQL](../tickets/T08-settings-notification-audit-schema.md)
- **目的**：送料・SMTP・認証補助・監査を分離して保存する。
- **内容・範囲**：`sms_challenges`、`shipping_settings`、`smtp_settings`、`notification_jobs`、`audit_logs`、保護秘密参照のマイグレーション。送料初期値940円、閾値1万円、重量物20kg、東京都発送。
- **依存**：T06、T07。
- **受け入れ条件**：秘密平文・OTP平文を表に保存せず、設定版を注文へ参照でき、監査ログが追記専用。
- **テスト**：制約・一意索引・秘密非露出・ローカル再構築。

### [T09 公開データ・StorageのRLS SQL](../tickets/T09-public-storage-rls.md)
- **目的**：公開商品だけを安全に閲覧させる。
- **内容・範囲**：カテゴリ、商品、仕様、画像、可用在庫投影のRLS・GRANT・Storageポリシー。下書きと非公開は匿名に見せない。
- **依存**：T06、T07。
- **受け入れ条件**：`anon`と会員は公開商品の必要情報だけ読め、商品・画像・在庫を直接変更できない。
- **テスト**：匿名／会員A/B／管理者でSELECT・INSERT・UPDATE・DELETEの許可拒否、Storage URL試験。

### [T10 本人・管理者のRLS SQL](../tickets/T10-member-admin-rls.md)
- **目的**：配送先、カート、注文、決済、設定を権限で分離する。
- **内容・範囲**：本人所有ポリシー、注文に従属する明細・試行、管理者判定関数、非公開スキーマ、限定DB関数の実行権限、既定GRANT剥奪。
- **依存**：T07–T09。
- **受け入れ条件**：会員Aから会員Bを読書きできず、自己管理者昇格不可。サービスロール経路は明示されたサーバー処理だけ。
- **テスト**：RLS許可拒否マトリクス、`auth.uid()=null`、関数search_path、関連明細のID推測試験。

### [T11 テストデータ定義と投入](../tickets/T11-test-data-fixtures.md)
- **目的**：要求された正常・異常系を再現可能にする。
- **内容・範囲**：`supabase/seed.sql`等に8カテゴリ、互換・不一致・判定不能、売切れ、残数1、9,999/10,000円、20kg境界、料金表のテスト版を定義。実在製品を参考にしても画像・価格の出典を記録し、外部ECから自動取得しない。
- **依存**：T06–T10。
- **受け入れ条件**：ケース表から商品IDと期待結果を追跡でき、実メール・住所・電話番号などの個人情報を含まない。
- **テスト**：ローカル再投入の冪等性、データ件数・各ケースの検出試験。

## M2 公開カタログ

### [T12 デザイントークンと共通シェル](../tickets/T12-design-system-shell.md)
- **目的**：専門ECとして一貫した視覚基盤を作る。
- **内容・範囲**：詳細設計の配色、文字、余白、ヘッダー、フッター、検索導線、パンくず、ボタン、フォーム、状態表示、スケルトンをCSS Modulesで実装。
- **依存**：T02、T01。
- **受け入れ条件**：購入前に非販売・非課金・非発送を示し、色だけに依存しない状態表示、44px操作領域を備える。
- **テスト**：Vitestの部品試験、Playwrightのキーボード・320px・200%拡大確認。

### [T13 商品検索サービス/API](../tickets/T13-product-search-api.md)
- **目的**：初心者の用途別探索と経験者の仕様絞り込みを可能にする。
- **内容・範囲**：公開商品に限定したキーワード・カテゴリ・用途・メーカー・価格・カテゴリ仕様のAND検索、安定ソート、24件ページング、`GET /api/products`。OpenAPIとZodを更新。
- **依存**：T09、T11、T03、T04。
- **受け入れ条件**：URL条件が再現可能で、下書きは漏れず、0件と不正条件を区別する。
- **テスト**：Vitest条件組合せ、DB検索・ソート・ページ境界、RLS下書き漏出試験。

### [T14 トップ・カテゴリ・検索画面](../tickets/T14-home-category-search-ui.md)
- **目的**：S01–S03の探索を完結させる。
- **内容・範囲**：用途別入口、8カテゴリ、検索欄、絞り込み、並べ替え、0件・読込失敗・条件解除。PCの左フィルタとスマホの開閉パネル。
- **依存**：T12、T13。
- **受け入れ条件**：初心者は用途から、経験者は直接条件指定から商品へ進める。URL更新と戻る操作で条件が保持される。
- **テスト**：PlaywrightでPC・スマホの探索、空状態、キーボード操作。

### [T15 商品詳細・画像配信](../tickets/T15-product-detail-image.md)
- **目的**：S04で購入判断に必要な情報を示す。
- **内容・範囲**：公開商品の画像・説明・型番・仕様・税込価格・可用状態、数量入力、カート／構成への導線。公開画像への配信経路を実装。
- **依存**：T09、T12–T14。
- **受け入れ条件**：非公開商品404、売切れは追加不可、仕様名は検索と一致、画像代替テキストを持つ。
- **テスト**：Playwrightで公開・非公開・売切れ、画像アクセスのRLS試験。

### [T16 カタログ例外と初期データ検収](../tickets/T16-catalog-exceptions.md)
- **目的**：商品系の想定外の表示や仕様不足を整理する。
- **内容・範囲**：管理側の下書き、空カテゴリ、仕様欠損、画像欠損、価格変更、公開切替後の検索結果を画面とデータで検証し、必要な文言・回復導線を整える。
- **依存**：T13–T15。
- **受け入れ条件**：各状態の原因と次の操作が分かり、非公開データが公開画面へ漏れない。
- **テスト**：Vitest/Playwrightの異常系、RLS回帰。

## M3 認証と会員

### [T17 Supabase SSRとメール・パスワード認証](../tickets/T17-supabase-email-auth.md)
- **目的**：会員本人のセッションとメール確認を成立させる。
- **内容・範囲**：`@supabase/ssr`、S07/S08/S09のメール登録・確認・ログイン・ログアウト、セッション更新、同一サイト内戻り先、Production認証省略拒否。
- **依存**：T06、T10、T12。外部ゲートG-Supabaseは接続時。
- **受け入れ条件**：未確認会員は購入不可、通常ログインにSMSなし、他人セッション不可、Productionで省略設定を有効化できない。
- **テスト**：Vitest認証分岐、Playwright登録・ログイン、RLS本人/他人、Production設定失敗試験。

### [T18 Google OAuth](../tickets/T18-google-oauth.md)
- **目的**：Googleで登録・ログインできるようにする。
- **内容・範囲**：Supabase Auth Google Provider、OAuth callback、最小スコープ、戻り先検査、配送先不足案内。GoogleトークンをアプリDBに保存しない。
- **依存**：T17。外部ゲートG-Googleで利用者がOAuthクライアントと許可URLを設定。
- **受け入れ条件**：GoogleログインにSMSなし、会員識別が安定し、意図しない外部URLへリダイレクトしない。
- **テスト**：OAuthフローのテスト環境接続、callback失敗・戻り先拒否、アカウント分離。

### [T19 模擬SMSと再設定のOTP](../tickets/T19-mock-sms-password-reset.md)
- **目的**：公開デモで6桁コードの発行・入力・照合を実現する。
- **内容・範囲**：登録・パスワード再設定のフロー、コードハッシュ、10分期限、5回試行、60秒再送制限、当該フロー内デモ通知。Development/Test限定の実SMS差替え境界と省略機能を分離。
- **依存**：T08、T17、T20。
- **受け入れ条件**：公開デモで電話番号を収集・実送信せず、誤り・期限切れを拒否。通常・GoogleログインにはOTPを要求しない。
- **テスト**：Vitest境界・制限、Playwright登録/再設定、Production省略不可。実端末SMS試験は別ゲートで検証後のみ記録。

### [T20 Supabase Send Email HookとSMTP送信](../tickets/T20-auth-email-hook-smtp.md)
- **目的**：会員確認・再設定・注文通知のメール送信経路を作る。
- **内容・範囲**：署名付きAuth Hook、許可テンプレート、SMTPアダプタ、送信失敗・再送、設定の保護参照、環境別送信先制限。秘密の管理UIはT41。
- **依存**：T08、T17。外部ゲートG-SMTPで利用者が送信先と資格情報を用意。
- **受け入れ条件**：署名不正を拒否し、秘密をログ・画面に出さず、送信障害時は認証を完了扱いにしない。
- **テスト**：Hook署名・テンプレート・SMTP失敗の統合試験、許可されたテスト宛先への実送信確認。

### [T21 配送先と会員画面](../tickets/T21-member-address-ui-api.md)
- **目的**：注文前に本人の国内配送先を管理できるようにする。
- **内容・範囲**：S11/S15、住所CRUD・既定住所、郵便番号・都道府県・文字数検証、架空データ案内、注文復帰。OpenAPI/Zodを同期。
- **依存**：T10、T12、T17。
- **受け入れ条件**：本人だけ読み書きでき、住所なし・入力エラー・削除確認が明確。Google会員も本サイト側で入力する。
- **テスト**：Vitest住所検証、Playwright登録/編集/削除、会員A/BのRLS拒否。

### [T22 アカウント削除と30日消去](../tickets/T22-account-retention-deletion.md)
- **目的**：公開デモの個人情報方針を動作で満たす。
- **内容・範囲**：再認証済み削除、住所・カート・注文・通知・Authアカウントの消去、15分間隔の期限ジョブ、決済中の照合、失敗時の冪等再実行、バックアップ条件の運用確認。
- **依存**：T17、T21、T31、T32、T34。番号上はM3だが、購入・期限・通知処理を終えた後に着手する。
- **受け入れ条件**：本人による即時削除と30日期限で個人情報が消え、他人のデータは削除されず、失敗は監視される。
- **テスト**：DB/Playwright削除、30日境界、途中失敗・再実行、削除後RLS、バックアップ保持条件。

## M4 構成とカート

### [T23 互換性判定エンジン/API](../tickets/T23-compatibility-engine-api.md)
- **目的**：5組の比較を一貫した結果で返す。
- **内容・範囲**：CPU/MB Socket、MB/メモリDDR、MB/ケース形状、GPU/ケース長、クーラー/CPU Socketの`compatible/incompatible/unknown/not_applicable`、理由・比較値・適合一覧URL。OpenAPI/Zodを同期。
- **依存**：T06、T09、T11、T13。
- **受け入れ条件**：仕様欠損を一致としない。不一致でも購入可の情報として返し、非公開商品IDは拒否する。
- **テスト**：Vitestで5判定×一致/不一致/欠損、APIの権限・リンク・不正ID。

### [T24 構成確認UI](../tickets/T24-pc-build-check-ui.md)
- **目的**：初心者が組合せを理解して適合商品へ移動できるようにする。
- **内容・範囲**：S05、8カテゴリ選択、URL共有可能な一時状態、比較値・理由・欠損・適合候補リンク、カート追加。
- **依存**：T12、T15、T23、T25。
- **受け入れ条件**：不一致の理由が具体的で購入を妨げず、繰り返しモーダルなし。欠損は断定しない。
- **テスト**：Playwrightで一致/不一致/不明、適合一覧遷移、スマホ表示。

### [T25 匿名・会員カートのサーバー処理](../tickets/T25-anonymous-member-cart-api.md)
- **目的**：購入前の商品選択を安全に保存する。
- **内容・範囲**：署名付きHttpOnly匿名Cookie、会員カート、追加・数量・削除・ログイン時統合、価格・販売可能数再取得、売切れ409。OpenAPI/Zodを同期。
- **依存**：T07、T10、T15、T17。
- **受け入れ条件**：他人カートを読めず、数量1–10、価格を固定しない。統合時の超過を利用者へ知らせる。
- **テスト**：Vitest数量/統合、RLS・Cookie改ざん、API競合/売切れ。

### [T26 カートUIと概算送料](../tickets/T26-cart-ui-estimated-shipping.md)
- **目的**：S06で現在の内容と送料の不確実性を示す。
- **内容・範囲**：明細編集、削除、商品小計、送料「概算」、変更・売切れ・空状態、ログイン導線。概算は確定額として決済へ渡さない。
- **依存**：T12、T25、T27。
- **受け入れ条件**：利用者に概算と正式金額の違いが分かり、在庫不足から数量変更できる。
- **テスト**：Playwrightで匿名/会員、空・売切れ・価格変更、PC/スマホ。

## M5 金額と購入

### [T27 送料・税計算器](../tickets/T27-shipping-tax-calculator.md)
- **目的**：注文金額をサーバーで一意に確定する。
- **内容・範囲**：税込円整数、通常送料940円、商品小計1万円以上の通常無料、20kg以上の商品ごとのヤマト公式運賃、離島加算なし、標準税率10%の内税一回切り捨て。料金表版・根拠URL・東京都初期発送元を扱う。
- **依存**：T08、T11、T04。
- **受け入れ条件**：住所・梱包・料金表欠損、ヤマト上限超過は金額を仮定せず決済不可。カート用概算と注文用正式見積を区別する。
- **テスト**：Vitestで9,999/10,000円、19,999/20,000g、北海道・沖縄・離島、複数重量物、税端数、設定版変更。

### [T28 住所選択・正式見積・注文確認](../tickets/T28-checkout-quote-review.md)
- **目的**：支払い前に最終金額と互換性を確認させる。
- **内容・範囲**：`POST /api/checkout/quote`、S12/S13、配送先、商品現在価格・在庫、送料内訳、内税額、見積期限、互換性警告、差額再確認。OpenAPI/Zodを同期。
- **依存**：T21、T23、T25、T27。
- **受け入れ条件**：ブラウザ送信額を採用せず、送料算定不能・在庫不足・価格変更を説明して支払いへ進ませない。不一致だけでは支払いを止めない。
- **テスト**：Vitest見積、API価格改ざん・409/503、Playwright住所なし・警告・差額。

### [T29 原子的な注文作成・在庫引当](../tickets/T29-atomic-order-stock-allocation.md)
- **目的**：同時注文でも在庫超過と二重注文を防ぐ。
- **内容・範囲**：商品ID順の行ロック、可用数検証、注文・明細・スナップショット・引当・試行の単一DBトランザクション、30分期限、同一checkout keyの冪等処理。
- **依存**：T07、T10、T27、T28。
- **受け入れ条件**：残数1に同時2注文でも1件だけ引当、失敗時全ロールバック、価格・住所・送料版が注文に固定される。
- **テスト**：DB統合の並列注文、デッドロック・ロールバック、冪等再送、スナップショット確認。

### [T30 Stripe CheckoutテストSession](../tickets/T30-stripe-test-checkout-session.md)
- **目的**：実課金なしで決済成功・失敗を体験させる。
- **内容・範囲**：`POST /api/checkout/start`、Stripe CheckoutテストSession、JPY額・注文IDメタデータ・期限・Idempotency-Key、Session保存、作成失敗時の引当解放。カード情報はサイトで受け取らない。
- **依存**：T29。外部ゲートG-Stripeで利用者がテストアカウント・テスト鍵を用意。
- **受け入れ条件**：注文額とStripe額が一致し、同じ操作の再送で別注文を作らない。ライブ鍵を拒否する。
- **テスト**：Stripeテスト環境、SDK失敗・タイムアウト・DB応答不明の統合試験。

### [T31 Stripe Webhookと決済状態](../tickets/T31-stripe-webhook-state.md)
- **目的**：署名済み通知を唯一の自動成功根拠にする。
- **内容・範囲**：生ボディ署名検証、イベントID重複排除、Session/PaymentIntent照合、金額・通貨・注文ID検査、成功時の在庫消費、失敗時の引当解放をDBトランザクション化。
- **依存**：T29、T30。
- **受け入れ条件**：戻りURLだけで成功にせず、重複・逆順・偽署名・金額不一致に安全に対応する。DB失敗時は再送で回復できる。
- **テスト**：Stripe CLI/テストイベント、偽署名、同一イベント2回、逆順、異額、DB障害・再送。

### [T32 期限切れ照合と補償ジョブ](../tickets/T32-payment-expiry-reconciliation.md)
- **目的**：未完了の引当を安全に回収する。
- **内容・範囲**：Supabase Cron→署名付きVercel内部API→Stripe現在状態照合、期限切れ解放、照合不能の`review_required`、遅延成功と再試行の整合処理。
- **依存**：T31。外部ゲートG-Supabase/G-StripeでCron・API秘密の接続設定。
- **受け入れ条件**：30分経過だけで無条件解放せず、二重販売を起こさない。遅延成功の矛盾は管理者確認に送る。
- **テスト**：Vitest状態機械、DB統合の期限・遅延・重複、Cron再実行・外部障害。

### [T33 決済結果・注文履歴画面](../tickets/T33-checkout-result-order-history.md)
- **目的**：利用者に注文結果と次の操作を示す。
- **内容・範囲**：S14/S16/S17、サーバー状態取得、確認中・成功・失敗・期限切れ・要確認、スナップショット表示、再試行導線。カート整理は成功確定後。
- **依存**：T31、T32、T12、T17。
- **受け入れ条件**：Webhook未着なら確認中、失敗を完了と表示しない。他人の注文IDは404相当。
- **テスト**：Playwright成功/失敗/保留、RLS他人注文、過去商品・住所変更後の履歴。

### [T34 注文・認証通知のジョブ](../tickets/T34-order-notification-jobs.md)
- **目的**：送信失敗が注文状態を壊さない通知を実現する。
- **内容・範囲**：`paid`後の注文完了メール一回投入、再試行・失敗監視、認証メールとのテンプレート区分、宛先制限。個人情報をジョブログへ残さない。
- **依存**：T20、T31、T08。
- **受け入れ条件**：決済Webhook重複でも重複メールを送らず、通知失敗で`paid`を戻さない。
- **テスト**：ジョブ冪等・再試行、SMTP障害、テンプレートと秘密非露出。

### [T35 注文系の統合検収](../tickets/T35-checkout-integration-acceptance.md)
- **目的**：M5の正常系・異常系を通して確認する。
- **内容・範囲**：商品探索→カート→住所→見積→テスト決済→結果→履歴をデータセットで通し、在庫競合・失敗・期限切れ・互換性警告を再確認。
- **依存**：T26、T28–T34。
- **受け入れ条件**：金額・在庫・注文・決済の表示とDB状態が一致し、原因と次の操作を表示する。
- **テスト**：Playwright主要導線、DB状態照合、Webhook再送、全関連Vitest/RLS回帰。

## M6 管理

### [T36 管理者判定と管理画面シェル](../tickets/T36-admin-auth-shell.md)
- **目的**：一般会員と管理者の操作領域を分離する。
- **内容・範囲**：A01、管理ナビ、管理API共通認可、権限付与の手動運用手順、監査ID。管理者権限の自己付与UIは作らない。
- **依存**：T10、T12、T17。
- **受け入れ条件**：非管理者のURL直打ち・API呼出しを拒否し、秘密や個人情報をダッシュボードに過剰表示しない。
- **テスト**：RLS/Route Handlerの403、Playwright管理者・一般会員、監査記録。

### [T37 商品・仕様・画像の管理](../tickets/T37-admin-products-specs-images.md)
- **目的**：管理者が8カテゴリの商品を登録・編集・公開できるようにする。
- **内容・範囲**：A02、商品・価格・仕様・用途・画像CRUD、公開時の必須条件とヤマト上限検査、公開/非公開、画像の種類・容量・寸法検査。
- **依存**：T06、T09、T36、T15。
- **受け入れ条件**：管理者のみ変更でき、仕様欠損は下書き可、公開の不備は欄下に示す。過去注文は変わらない。
- **テスト**：Zod・DB制約、RLS/Storage、Playwright登録・編集・非公開、履歴不変。

### [T38 在庫調整の管理](../tickets/T38-admin-inventory-adjustment.md)
- **目的**：実在庫と引当を安全に管理する。
- **内容・範囲**：A03、実在庫・引当・可用数表示、理由付き調整、版番号を使う競合検出、調整ログ。直接UPDATEは使わない。
- **依存**：T07、T29、T36。
- **受け入れ条件**：引当より少ない実在庫へ変更できず、競合時は最新値と再操作を案内。一般会員から更新不可。
- **テスト**：DB競合・下限、RLS、Playwright調整・失敗、監査ログ。

### [T39 注文・決済状態の管理閲覧](../tickets/T39-admin-orders-payments-readonly.md)
- **目的**：要確認注文と通知障害を調査できるようにする。
- **内容・範囲**：A04、注文・試行・Webhook・引当・通知状態の必要情報のみ表示、検索、`review_required`の調査導線。決済状態の手動編集は作らない。
- **依存**：T31–T34、T36。
- **受け入れ条件**：他人の個人情報を一般会員に見せず、管理者に必要な状態・監査・原因が分かる。
- **テスト**：管理者/会員権限、Playwright注文なし・要確認、監査ID照合。

### [T40 発送元・送料規則の管理](../tickets/T40-admin-shipping-settings.md)
- **目的**：東京都初期設定と公式運賃の根拠を保って変更できるようにする。
- **内容・範囲**：A05、発送元、通常送料、1万円閾値、20kg規則、公式料金表・URL・確認日・版の編集と試算。変更は新しい版として保存。
- **依存**：T08、T27、T36。
- **受け入れ条件**：設定変更は新注文だけに適用され、既存注文スナップショットは不変。料金表欠損で正式見積不可。
- **テスト**：Vitest版選択・料金境界、Playwright保存/検証、監査・RLS。

### [T41 SMTP設定の管理](../tickets/T41-admin-smtp-settings.md)
- **目的**：管理者が送信先を環境別に安全に変更できるようにする。
- **内容・範囲**：A06、ホスト・ポート・TLS・送信元・秘密参照の更新、接続試験、旧設定復帰、監査。秘密は入力後に再表示しない。
- **依存**：T08、T20、T36。外部ゲートG-SMTP。
- **受け入れ条件**：管理者のみ更新可、秘密はDB通常表・画面・ログに平文なし。接続失敗時は旧設定で送信可能。
- **テスト**：RLS/管理API、SMTP成功/失敗、秘密非露出、監査。

## M7 品質・CI/CD・公開

### [T42 異常系デモの利用者導線](../tickets/T42-abnormal-demo-paths.md)
- **目的**：ポートフォリオ閲覧者が指定異常系を確認できるようにする。
- **内容・範囲**：在庫切れ、注文中の在庫不足、Stripe成功/失敗、互換性不一致/不明のガイドとテスト商品・手順。管理用の内部操作は公開しない。
- **依存**：T11、T23–T35。
- **受け入れ条件**：各ケースの入口・期待表示・次の操作が分かり、実課金・実SMS・実発送を連想させない。
- **テスト**：Playwright全6ケース、ガイドと実動作の一致確認。

### [T43 レスポンシブ・アクセシビリティ仕上げ](../tickets/T43-responsive-accessibility-final.md)
- **目的**：全画面を公開ECとして使いやすくする。
- **内容・範囲**：S01–S17/A01–A06の0–767/768–1199/1200px以上、320px、200%拡大、44px操作領域、フォーカス、読み上げ、コントラスト、管理表カード化を調整。
- **依存**：T14–T16、T21、T24、T26、T28、T33、T36–T41。
- **受け入れ条件**：主要操作に横スクロール・隠れたボタンがなく、警告は色以外でも理解できる。
- **テスト**：Playwright PC/タブレット/スマホ、axe等の自動検査とキーボード手動確認。

### [T44 セキュリティ・RLS・削除の横断検証](../tickets/T44-security-rls-retention-audit.md)
- **目的**：公開前の個人情報・権限・秘密漏えいを防ぐ。
- **内容・範囲**：全表RLSマトリクス、管理API、Origin/Cookie/CSP、レート制限、Production認証省略拒否、秘密スキャン、30日削除・バックアップ保持条件を検証。
- **依存**：T09–T10、T17–T22、T29–T34、T36–T41。
- **受け入れ条件**：会員間隔離、管理者自己付与不可、ライブStripe鍵不在、個人情報30日削除が確認できる。問題は隠さず修正チケット化。
- **テスト**：RLS許可拒否、API侵入ケース、秘密スキャン、削除統合、手動セキュリティレビュー。

### [T45 全体E2Eと性能検収](../tickets/T45-full-e2e-performance.md)
- **目的**：要件の正常系・異常系を一式で証明する。
- **内容・範囲**：Playwrightの探索→注文、Google、メール、模擬SMS、管理、競合、Webhooks、PC/タブレット/スマホをまとめ、LCP/CLS/INPを測定する。
- **依存**：T35、T42–T44。
- **受け入れ条件**：主要シナリオが再実行可能で、既知の失敗を記録し、性能目標未達は原因と改善チケットを残す。
- **テスト**：全CIテスト、Playwright、実測Web Vitals、RLS/在庫競合の再実行。

### [T46 GitHub Actions・Vercel・SupabaseのCI/CD](../tickets/T46-cicd-vercel-supabase-release.md)
- **目的**：レビューと環境分離を保って公開できるようにする。
- **内容・範囲**：CIにDB/RLS/Playwrightを追加、PR Preview、main Production、別Supabaseプロジェクト、マイグレーション適用ゲート、環境別変数、失敗時ロールバック手順。アプリはVercel Git連携でデプロイし、Actionsから二重デプロイしない。
- **依存**：T05、T45。外部ゲートG-GitHub/G-Vercel/G-Supabase。
- **受け入れ条件**：PreviewがProductionの個人情報・秘密・DBを共有せず、PR必須チェック失敗でmain反映できない。Productionにライブ決済鍵なし。
- **テスト**：PR Preview、mainのテストデプロイ、環境変数差分・DB適用順・ロールバック演習。

### [T47 公開・運用・ポートフォリオ説明](../tickets/T47-public-demo-operations-portfolio.md)
- **目的**：採用担当者が操作できる公開デモを安全に提供する。
- **内容・範囲**：公開前チェック、規約・個人情報案内、ヤマト公式リンク、実課金なし表示、利用ガイド、監視・障害・30日削除・バックアップ手順、AI駆動開発の人間による判断とAIの役割を記録。
- **依存**：T22、T42–T46。外部ゲートG-Publication（利用者が公開先・アカウントを設定）。
- **受け入れ条件**：PC/スマホで購入体験と異常系を操作でき、実課金・実SMS・実発送なし、個人情報削除、CI/CDの証拠を確認できる。
- **テスト**：公開URLのスモーク、全主要シナリオ、監視通知、削除ジョブ、秘密・環境分離の最終確認。
