# 公開MVPのデモ認証（T50）

閲覧者はSupabase Authの匿名サインインで個別の署名済み会員セッションを持つ。共有IDは使わない。匿名Authは`authenticated`ロールだが、注文・住所・カートは本人IDで隔離し、管理画面はJWTの`is_anonymous`を拒否する。Productionの`AUTH_BYPASS_ENABLED`は常に無効にする。

## 環境設定

- Local/CI: `supabase/config.toml`で`enable_anonymous_sign_ins = true`とIP別の`anonymous_users`制限を有効化する。設定変更後はローカルSupabaseを再起動する。
- Preview/Production: T46で**別々のSupabaseプロジェクト**の匿名サインインを有効化し、IP別の匿名サインイン制限を確認する。Vercelサーバーはサインインを代理しない。ブラウザの`createBrowserClient`からSupabase Authを直接呼ぶため、レート制限は閲覧者のIPで評価される。
- 公開MVPのSupabase Preview/Productionでは一般向けメール新規登録を無効化する。公開Webの登録ページと`POST /api/auth/register`もProductionでは閉じる。Local/CIの既存メール認証試験は継続する。既存アカウントの管理/試験利用と一般閲覧者向け新規登録は区別する。
- 公開前にSupabaseのBot/Abuse Protectionも評価する。CAPTCHAを有効化する場合はデモ開始画面からトークンを渡す必要があるため、UI変更と外部設定を別途合わせて行う。CAPTCHAだけ先に有効化しない。
- Supabaseの匿名Authユーザーは自動削除されない。T22で30日保持のジョブに`auth.users`と関連するデモデータを含め、T22完了まで公開しない。
- デモ購入時に自由入力の住所・氏名・電話・メールを保存しない制限はT51で実装する。T51完了まで公開しない。

## 検証

2つの独立したブラウザコンテキストでデモを開始し、異なる`auth.users.id`、カート・住所・注文の相互不可視、管理API拒否、終了後の復帰不可、認証障害・レート制限表示を確認する。T50のCIはローカルSupabaseでコード・RLSを検証し、Preview/Productionの実設定はT46で再確認する。
