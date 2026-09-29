# 時間割(timetable)

- 全アプリ共通のルールは `../CLAUDE.md`。必ず従うこと。
- 作業を始める前に [HANDOFF.md](HANDOFF.md) を読むこと(冒頭の「現在の状況と次にやること」、これからの計画、データの形)。
- このフォルダには2つある: 時間割アプリ(`index.html`・`css/`・`js/`)と、変換ツール(`timetable_converter.html`)。`claudeからの引継ぎ/` の中は古い資料なので編集しない。
- 機能を変えたら README.md(先生向け)・CHANGELOG.md・HANDOFF.md を同時に更新する。画面のボタンを変えたら `js/guide.js`(画面ガイド)の説明も直す。
- データに新しい項目を足したら `js/core.js` の `normalizeState` にも足す(古いデータファイルを読めるように)。
- 実際の学校の時間割ファイルや先生の名前は、このフォルダに置かない(GitHub の公開リポジトリと Google ドライブに送られるため)。見本は架空の学校・先生だけを使う。
