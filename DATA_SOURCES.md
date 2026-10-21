# データ取得元と確認範囲

調査日: 2026-10-20。一次ページの実HTML、JSON、HTTP状態、公式ドキュメントを確認。実応答の調査用控えはローカルの `Data/research/`（Git対象外）。第三者参考サイトの内容・DB・画像は取得していない。

|取得元|項目・方法|頻度・確度・障害時|
|---|---|---|
|[公式番組表](https://weathernews.jp/wnl/timetable.html) / [公開JSON](https://site.weathernews.jp/site/live/json/timetable.json)|公式ページのスクリプトが直接参照する認証不要GET。hour/title/casterの並び。日付なし、先頭が現在枠という公式画面の表示意味を利用。出演実績ではない。|3時間ごと1GET。JST取得時刻以前の直近の先頭時刻を起点に、時刻の巻き戻りで翌日に進む。起点が6時間より古い場合・48時間超の範囲・未知構造は採用しない。`date_basis=rolling_schedule` を保存。予定として保持し、未掲載の過去枠を補完しない。失敗時は過去JSONを維持。|
|[公式トップ](https://weathernews.jp/wnl/)|caster_trans/caster_kanjiの対応を実HTMLから確認し `config/casters.json` にID・表示名・別名を記録。|現時点21名の表示名対応表。現役名簿や全在籍者数を意味しない。未知IDは日本語名を捏造せず未確認。顔画像バイナリーは収集サーバーに保存しない。名前変更は対応表をレビューして更新。|
|[公式動画一覧JSON](https://site.weathernews.jp/site/live/json/list.json)|公式トップで利用。live.id/title/live、ondemandのID・タイトル・公開時刻のみ。|ローカルNodeサーバーは60秒キャッシュ。公開Pagesは無料Workerの15秒キャッシュを画面から30秒間隔で確認。履歴用スナップショットのActions収集は10分ごと。`live: true` は「公式掲載・取得時点」。現在配信を保証する情報ではない。公開時刻は配信開始時刻とみなさない。失敗時はLIVE表示を停止し正規リンクへ。アーカイブは最新一覧の範囲のみで、出演記録へ自動変換しない。|
|[YouTube oEmbed](https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=LbMd2BvWHHU&format=json)|公式JSONで得たIDを問い合わせ、author_url=@weathernews、type=video、埋め込みURLを確認。返されたHTMLを画面に挿入しない。|Workerでは同一IDの照合を1時間保持し、新ID時に照合。Actionsでは候補1件につき最大1GET/更新。認証不要。埋め込み可能な公式動画候補の確認用で、LIVE状態の検証ではない。失敗時はiframeを出さない。|
|[YouTube videos.list](https://developers.google.com/youtube/v3/docs/videos/list) / channels.list|任意のActions Secret `YOUTUBE_API_KEY` がある場合のみ。公式ハンドルのチャンネルIDと一致し、public・embeddable・liveBroadcastContent=live・actualStartTimeあり・actualEndTimeなしを検証。|更新あたり原則2リクエスト、各1 unit。検索APIを使わない。キーはHTTPヘッダーのみで送信。認証付き実通信はキー未設定のため未検証。無設定時も公式掲載動画の通常埋め込みは利用でき、現在LIVEとは表示しない。APIエラーで以前のLIVE判定を引き継がない。|

## 利用条件・アクセスの扱い

- [weathernews.jp robots.txt](https://weathernews.jp/robots.txt) を確認。今回の /wnl/ は列挙されたDisallowに該当しなかった。site.weathernews.jp の robots.txt は403で確認できなかった。JSON自体は200、公式ページが一般閲覧者向けに公開している取得先。robotsは転載許諾を意味しない。
- 公開JSONについて再配布を包括的に許すライセンスは確認できていない。表示するのは日時・番組名・出演者名など必要最小限の事実と出典。元HTML/顔写真/サムネイル/記事本文を収蔵しない。許諾済み配信の録画ファイルはローカルPCだけに保存し、Git・Pagesへ送信しない。公開運用者は利用条件の変更・削除要請に対応し、必要に応じ取得を停止する。
- 公開JSONのクォータ仕様は未公表。並列大量収集・過去URL探索を行わず、タイムアウト20秒、429/5xx/通信障害のみ最大3試行。指数バックオフとRetry-After上限30秒。予定収集は約1日8回、動画メタデータのActions更新は最大1日144回。ローカル実行は短時間で何度も繰り返さない。
- [YouTube APIポリシー](https://developers.google.com/youtube/terms/developer-policies) を参照。APIキー・ユーザーの認証情報は公開しない。YouTube APIの応答は一時的な現在状態の検証に限り、古いAPIメタデータを無期限保存しない。検索APIの割当は変更されうるため実際のCloud Consoleで確認する。
- [YouTube埋め込み仕様](https://developers.google.com/youtube/player_parameters) に沿う通常iframe。プライバシー強化ドメインを使用し、ページ表示時に自動読み込み。ミュートで自動再生を試行する。YouTubeのUI・広告・ロゴは隠さない。PC版の公式チャットも同じ動画IDで自動表示し、投稿・ログインはYouTubeが管理する。[モバイルWebの制限](https://support.google.com/youtube/answer/2524549?hl=JA)があるため小画面は公式リンクを表示する。
- キャスター写真と本人SNSは[公式プロフィール](https://weathernews.jp/wnl/caster/index.html)で16名を確認し、`config/caster-photos.json` と `config/caster-socials.json` に出典・URLを記録。画像バイナリーは保存せず公式配信先を直接参照する。本人SNS42件はプロフィールのリンクから取得し、推測で補完しない。
- 依頼者が写真掲載・YouTube録画の許諾取得済みと申告したため録画を有効にした。Windowsローカル版だけで、現在の公式配信ID・公式チャンネルIDを検証し、公開HLSの映像・音声をFFmpeg `-c copy` とAACのコンテナ変換でMP4保存する。最大1080p/60fps、配信が30fpsなら30fpsを保持する。DRM・Cookie・ログイン情報は利用しない。保存は `Data/recordings/`、ログは `Data/logs/recording/`。録画ファイルをGitやPagesへ送らない。時刻メモは依頼により削除。
- 初回に[yt-dlp公式](https://github.com/yt-dlp/yt-dlp)と[FFmpeg推奨ビルド](https://github.com/yt-dlp/FFmpeg-Builds)の固定リリースをSHA256照合し `Data/tools/recording/` へ取得する。バージョンとハッシュは `config/recording-tools.json`。ツール実行時の一時/キャッシュ先もData配下とする。
- [番組映像ガイドライン](https://weathernews.jp/wnl/guideline/) とYouTube側の条件は別々。許諾原本と個別条件の照合、YouTubeへのコメント投稿は未検証。公開実配信の映像・音声の直接MP4保存は実行検証済み。

## できること・できないこと

公式のローリング番組表を定期観測して、確認できた予定とその変更履歴を蓄積する。過去全期間の埋め戻し、実際の出演確認、自動的な全出演者の判別は実装していない。予定が過去になっても確認済みに変換しない。未確認を統計に加算しない。番組名や時刻は取得値を使い6枠に固定しない。

## 定期実行

[GitHub schedule](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule) の遅延・無活動リポジトリの停止等を考慮。毎時3/13/23/33/43/53分に動画情報を更新し、番組表は前回から3時間以上経過時に更新。リアルタイム保証はない。UIは4時間以上前の収集を期限切れとし、LIVE判定は15分で失効する。

## 全国予報図・台風図

2026-10-20に公式トップと台風ページの実HTMLから画像URLを確認し、両画像がHTTP 200/image/pngであることとブラウザーでの描画を検証。全国図は https://site.weathernews.jp/site/forecast/image/map/JAPAN.today.png 、台風図は https://gvs.weathernews.jp/s/typhoon/img/data/multi_onebox.png 。画像バイナリーをGitへ保存せず公式配信先を直接参照し、5分ごとに再読み込みする。元画像の予報・進路・日時を加工しない。出典と公式の詳細リンクを表示し、読み込み失敗時は失敗表示と公式リンクに切り替える。会員専用データは取得しない。

## 公開サイトの番組切替（2026-10-21）

GitHubの定期デプロイ待ちを解消するため、配信メタデータはWorkers経由でも取得する。固定された公式一覧とYouTube oEmbed以外の取得先は受け付けず、任意URLの代理取得はしない。既存のチャンネル照合をNode/Workerで共用する。公開Pages OriginだけにCORSを許可し、GET/HEAD以外の操作を受け付けない。公開ブラウザーから新ID kS81qB9BZko、公式照合済みの埋め込み許可、CORS応答を実確認。Worker用の認証情報・アカウントID・メールはサイトへ渡さない。

## カスタマイズ用の天気情報（2026-10-21）

32種類のカードを追加。公式HTML・そのHTMLが読むJavaScript・実HTTP応答を照合し、`scripts/weather-source.mjs` に取得先を固定しました。資料と実ブラウザーの検証結果はGit対象外の `Data/verification/weather-dashboard/`、公開データを最小化した試験用応答は `tests/fixtures/weather-sources.json` と `weather-cards.json` です。

| 情報 | 公式の公開データ |
|---|---|
| 全国・9地方の予報 | `https://weathernews.jp/comment/map_area/{japan,hokkaido,tohoku,kanto,chubu,kinki,chugoku,shikoku,kyushu,okinawa}.json` のfcst/mapsrc。今日/明日/明後日/日付選択。日付を推測した固定画像URLは作りません |
| 実況天気図 | `https://weathernews.jp/onebox/chart/api/chart/fctList` のobsの画像パス |
| 衛星雲画像 | `https://memgvs-cdn.weathernews.jp/s/satellite/cloud/JAPAN/index.json` の最新時刻・画像 |
| 雨雲 | `https://tile.weathernews.jp/3/json/airadar_3600.json` の無料の実況だけ。4枚のズーム4タイルで日本域を表示。予想・会員向けのデータは使用しません |
| 地震 | `https://mws.cdn.weathernews.jp/s/quake/json/quake.json` の掲載順・最新震度図・5件の概要 |
| 津波 | `https://mws.cdn.weathernews.jp/s/tsunami_v2/json/image.json` の掲載図・発表日時。publish=falseなら発表終了を明示し、古い図を現在の発表と説明しません |
| 警報・注意報 | `https://site.weathernews.jp/app/warning_v3/allcity.json` の発表がある市区町村。公式JSの分類に従いwarn=注意報、alrm=警報、urgt=危険警報、exal=特別警報。未知の分類は公式確認の表示 |
| 紫外線 | `https://api.weathernews.jp/uv/json/JAPAN.json` の公式UV値と分類 |
| 乾燥・風邪予防・熱中症 | `https://site.weathernews.jp/app/{dryness-index,cold-index,wbgt-index}/JAPAN.json` の対象時刻・主要都市・公式区分 |
| お洗濯・天気痛 | `https://site.weathernews.jp/site/washing/json/map/JAPAN.json` と `https://site.weathernews.jp/pain/json/map/JAPAN.json` |
| 観測ランキング6種 | `https://site.weathernews.jp/info/data/obs/rank/{element}/latest_top10.json`。最高/最低気温、日最大1時間雨量/降雪量、現在の平均風速、日最低湿度。発表/観測時刻と単位を区別 |

雨雲背景は[国土地理院の淡色地図](https://maps.gsi.go.jp/development/ichiran.html)（`https://cyberjapandata.gsi.go.jp/xyz/pale/4/{x}/{y}.png`）。カード内に地図と雨雲の出典を別々に表示します。雨の強さの凡例は公式の `https://tile.weathernews.jp/nowcast/res/legend_zoomradar_rain@2x.png`。動きのアニメーションやズーム操作は公式ページで確認できます。

ローカルNodeとWorkerで同じ正規化/固定取得処理を共用。Workerは `/weather/{許可済みID}.json` のGET/HEADのみで、任意のURL・クエリー・認証情報を受け付けません。天気のEdgeキャッシュは60秒、画面確認は5分間隔（即時の防災通知ではありません）。配信動画の15秒キャッシュ・30秒確認は別のまま。通信/形式エラーで古い取得結果へフォールバックしません。表示するカードだけ読み、画像そのものをGitへ保存しません。

初期配置は今日・台風の2枚。選択/順番/幅は `weathercas.weather-layout.v1` としてブラウザーへ保存。無効・破損データは初期配置へ戻し、保存できない場合もその場の操作は継続し画面通知します。設定の外部送信・端末同期・DB追加はありません。公開PagesのブラウザーからWorkerの28経路すべてがHTTP200で応答することを確認しています。
