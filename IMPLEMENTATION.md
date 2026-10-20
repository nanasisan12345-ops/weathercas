# WeatherCas 実装・検証記録

## 目的と受け入れ条件
公式番組表の出演予定を保持し、検索・統計・動画/公式チャット・本人SNS・天気/台風図を表示する。予定を自動で実績に昇格しない。録画ではプレイヤーUIを含めず、元の映像/音声を再圧縮せずMP4保存する。設定/ログ/キャッシュ/録画/ブラウザー状態はData配下。

## 最新のユーザー指定
- GitHubへpushを承認。その後、非公開を希望したためprivateリポジトリを作成。
- 個人アカウントのプランによりprivateリポジトリからのPages有効化がHTTP422で拒否された。
- 閲覧認証と検索除外の違いを説明後、ユーザーが「リポジトリも公開にして、Pagesは検索除外する」を選択。公開リポジトリ/Pagesとnoindexで進める。URLが伝わった第三者のアクセスは防がない。
- 不要な紹介文/時刻メモ/取得状況と出典欄/4概要カード/重複録画リンク/録画メニューを削除。
- メニューはホーム→ライブ視聴→天気・台風→出演番組表→出演履歴→出演統計。
- 写真掲載・YouTube録画は許諾取得済みとの申告。許諾原本照合は未実施。

## 設計と完了した機能
React/TypeScript/Vite、Python標準ライブラリの収集器。予定・実績を区別し、月別JSON・出典・変更履歴・失敗状態を保持。写真16名/本人SNS42URLを公式プロフィールから対応。明暗切替、PCの動画/チャット自動表示、レスポンシブ表示、公式の全国予報図/台風図を5分更新。採用ロゴPNGはスターター原本とSHA256一致。

配信IDの切替時に古い動画のチャット無効を観測したため、ローカルNodeサーバーの公式リゾルバーを60秒キャッシュにし、画面で動画/チャットを同時更新。PagesではActionsの10分間隔更新に依存。APIキーなしでは現在LIVEと断定しない。

録画方式を画面共有/Region Captureから、yt-dlpでの公式公開HLS確認＋FFmpeg `-c copy` に置換。元の映像・音声を保持でき、ホバーUI・マウス・表示サイズ・ミュートの影響を受けない。AVC/H.264とAAC、最大1080p/60fps、30fps配信は30fpsを保持。AACのMP4格納にはaac_adtstoascを適用。Windows64bitローカル版のみで、Pagesでは案内を表示。現在の配信の最新地点から取得し、巻き戻した視聴位置は対象外。

固定公式リリースをSHA256照合してData/toolsへ取得。録画/metadataはData/recordings、ログはData/logs/recording。最大30分/約2GB。CSRFトークンと同一Origin、loopback限定API、公式チャンネル/現在ID/Google媒体ホスト検証、DRM/ログイン非対応。停止後に映像・音声・再生時間を検証し、Range対応でプレビュー/保存する。中断した元ファイルは削除しない。

## 今回の検証観測
- フロント単体7件、Nodeリゾルバー/録画API8件が成功。品質選択、終了/DRM/偽ホスト拒否、二重開始、停止、再起動復元、準備中止、CSRF/Origin拒否、MP4/Rangeを検証。
- Python収集器18件成功。ライブだけの更新で予定/取得日時を変更しないことを含む。
- Edgeの画面E2Eは14件。録画のUI/異常応答/ローカル限定案内、検索/戻る進む/集計/日付、写真、SNS、明暗保存/拒否、動画とチャットの切替、天気図、320〜3840pxとDPR2、HTMLのnoindexを検証。
- 模擬ファイルのdownload要求はEdgeでpage.routeを経由せず実HTTPへ進み、偽IDで404となることを切り分け。UI試験は保存リンクを検証し、実ダウンロードは配布版の実録画APIで検証する。
- 公式実配信U-NLyctHkvsで1920×1080/30fps H.264＋AACの12秒MP4保存成功。その後、録画サービスの開始/停止で約10秒のMP4保存成功。画面共有は使用しない。
- run.batから新規配布フォルダーを起動済み。新規配布物には全録画サーバーモジュール/ツール固定設定/README/ランチャーを含み、初期Data・node_modules・録画・DB・検証ファイルを含めない。

## 保存と起動
run.batで専用Edgeを起動。Data配下にブラウザー状態/ダウンロード/ログ/キャッシュ/temp/ツール/録画を置く。既存Edge設定は上書きしない。Windows CAでTLS検証有効。DataはGit除外、public/dataは公開対象。exe/_internal/ZIPはWebアプリのため対象外。

## 未検証・限界
60fpsの実配信は未観測（選択処理のみテスト）。YouTubeコメント投稿、任意APIキーでの実通信は未検証。公開JSONと気象図の包括的転載ライセンスは未確認。過去全期間の埋め戻し・出演実績自動確定は未対応。noindexはアクセス制限ではない。

## 配布版の最終確認（2026-10-20）
新規配布先 release/weathercas-2026-10-20T02-51-49-532Z-b698eb66 のrun.batから起動。初回のツール取得/ハッシュ照合/展開から、画面の録画開始→録画中→停止→プレビュー→MP4ダウンロードを5回成功。各4〜6秒、すべて1920×1080/30fps、H.264とAACをffprobeで確認。getDisplayMediaを例外にしても成功し、画面共有を使わないことを確認。プレイヤーに模擬ホバータイトルを表示したまま録画し、抽出フレームにタイトル/操作UIがないことを目視確認。録画パネル/プレビューのPNGも目視。検証記録はData/verification/direct-release-results.jsonとdirect-release-ui.png、direct-release-frame.png。

## GitHub公開作業
ユーザーの明示承認後にリポジトリをPUBLICへ変更。SITE_URL変数を設定し、コミット1bdf4d0をpush。PagesのSourceはGitHub Actions、HTTPS有効。Actions run 39361560686 は収集・Python18/フロント7/Node8/Chrome E2E14・新規ビルド・データ保存・デプロイすべて成功。

公開URL https://nanasisan12345-ops.github.io/weathercas/ はHTTP200。配信HTMLのnoindex/nofollow/noarchiveを確認。公開URLを実ブラウザーで開き、アプリ描画、動画/チャットの同一IDとembed_domain、Pagesの録画ローカル限定案内、390/1280/1920幅のはみ出しなし、pageerrorなしを確認。iframe内部の動画再生/チャット投稿はこの検査の対象外。Data/verification/pages-browser.jsonとpages-desktop.pngに記録。

Git対象72ファイル/全ローカル履歴の秘密キー形式検索は該当なし。Data・録画・ブラウザー状態はGitに含まれず、テスト用MP4は自作の合成映像/音声のみ。git diff --check成功。新規ソースコピーData/validation/push-28e6f8e7でnpm ci→build成功、HTMLのnoindexとcanonicalを確認。

最新の配布先 release/weathercas-2026-10-20T02-56-16-468Z-c7591c55 は23ファイル、初期Dataなし。run.bat --no-browserで起動し、HTML/JSON/ロゴ/favicon/録画API/不正パス拒否を確認。録画検証版とJS/CSSハッシュ一致。Dataは起動時に作成。exe/_internalは対象外、ZIPなし。

最終ドキュメント更新のみ[skip ci]でpushし、収集botのコミットを含めローカルmainとorigin/mainを同期する。
