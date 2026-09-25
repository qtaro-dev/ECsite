# T11 テストデータ・期待ケース

`supabase/seed.sql`はローカル Supabase 専用の架空データを作る。商品・メーカー名・価格・仕様はすべて合成値で、実在商品の仕様や販売価格ではない。商品slugをケースIDとして使用し、seedの再適用でも同じIDと値を保つ。

## 互換性の期待ケース

判定ルールは対象API（T23）の結果を検証する入力データ表である。T11は判定ロジックを実装しない。

| ケースID | 比較 | 左側商品 | 右側商品 | 期待 | 根拠となる値 |
| --- | --- | --- | --- | --- | --- |
| SOCKET-MATCH | CPU / motherboard socket | `t11-cpu-am5` | `t11-motherboard-atx` | 一致 | AM5 = AM5 |
| SOCKET-MISMATCH | CPU / motherboard socket | `t11-cpu-am4` | `t11-motherboard-atx` | 不一致 | AM4 ≠ AM5 |
| SOCKET-MISSING | CPU / motherboard socket | `t11-cpu-unknown` | `t11-motherboard-atx` | 判定不能 | CPU socket が NULL |
| DDR-MATCH | motherboard / memory DDR | `t11-motherboard-atx` | `t11-memory-ddr5` | 一致 | DDR5 = DDR5 |
| DDR-MISMATCH | motherboard / memory DDR | `t11-motherboard-atx` | `t11-memory-ddr4` | 不一致 | DDR5 ≠ DDR4 |
| DDR-MISSING | motherboard / memory DDR | `t11-motherboard-atx` | `t11-memory-unknown` | 判定不能 | memory DDR が NULL |
| FORM-MATCH | motherboard / case form factor | `t11-motherboard-atx` | `t11-case-atx` | 一致 | ATX is supported |
| FORM-MISMATCH | motherboard / case form factor | `t11-motherboard-atx` | `t11-case-itx` | 不一致 | ATX is not supported; case supports ITX |
| FORM-MISSING | motherboard / case form factor | `t11-motherboard-atx` | `t11-case-unknown` | 判定不能 | supported form factors が NULL |
| GPU-MATCH | GPU / case length | `t11-gpu-300` | `t11-case-atx` | 一致 | 300 mm ≤ 320 mm |
| GPU-MISMATCH | GPU / case length | `t11-gpu-340` | `t11-case-atx` | 不一致 | 340 mm > 320 mm |
| GPU-MISSING | GPU / case length | `t11-gpu-unknown` | `t11-case-atx` | 判定不能 | GPU length が NULL |
| COOLER-MATCH | CPU / cooler socket | `t11-cpu-am5` | `t11-cooler-am5` | 一致 | AM5 is supported |
| COOLER-MISMATCH | CPU / cooler socket | `t11-cpu-am5` | `t11-cooler-lga` | 不一致 | AM5 is not supported; cooler supports LGA1700 |
| COOLER-MISSING | CPU / cooler socket | `t11-cpu-unknown` | `t11-cooler-am5` | 判定不能 | CPU socket が NULL |

## 価格・重量・在庫

| ケースID | 商品 | 期待値 |
| --- | --- | --- |
| PRICE-BELOW-FREE | `t11-cpu-am5` | 税込商品価格 9,999 円。通常送料の無料閾値未満 |
| PRICE-AT-FREE | `t11-gpu-300` | 税込商品価格 10,000 円。通常送料無料閾値ちょうど |
| WEIGHT-BELOW-HEAVY | `t11-cpu-am5` | 19,999 g。20 kg の重量物境界未満 |
| WEIGHT-AT-HEAVY | `t11-gpu-300` | 20,000 g。重量物境界ちょうど |
| STOCK-SOLD-OUT | `t11-gpu-300` | on_hand 0、available 0 |
| STOCK-LAST-UNIT | `t11-motherboard-atx` | on_hand 1、available 1 |

`initial-v1`の重量物料金表は空のままとし、公式料金に該当しない場合の見積不能を維持する。`t11-fixture-only-v1`は inactive なパーサーテスト専用データで、料金1,234円は架空値である。見積や画面に適用してはならない。送料の算定はT27の責務。

## 画像・Storage

全18商品の `product_images.storage_path` は `t11/<slug>.png`。`tests/database/t11-storage-fixtures.py` が同一の合成1×1 PNGを各パスへ冪等アップロードし、公開商品の authenticated Storage 経路から匿名ロールでバイト一致を確認する。DBだけに画像メタデータを挿入して壊れた画像を表示する状態を作らない。この画像は見た目確認用ではなく、将来の画面ではテスト用プレースホルダーとして扱う。ローカルの `supabase db reset` 後に Storage ヘルパーを実行する（CIでは自動実行）。

| 商品fixture | 商品画像パス | 期待 |
| --- | --- | --- |
| 各 `t11-*` slug | `t11/<slug>.png` | DBメタデータとStorage実体が一致し、公開中だけ取得可 |
