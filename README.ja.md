# <img src="web/public/Logo.svg" alt="Logo" width="50" height="50" style="vertical-align: middle;"/> Kumiho

<div align="center">

[![Discord](https://img.shields.io/badge/Discord-Join%20Server-5865F2?style=flat-square&logo=discord&logoColor=white)](https://discord.gg/KYaWSCUNQt)
![GitHub release (latest by date)](https://badgen.net/github/release/aha-hyeong/kumiho?label=version)
![Docker Image Size (latest by date)](https://img.shields.io/docker/image-size/ahahyeong/kumiho?style=flat-square)
![License](https://img.shields.io/badge/license-Apache--2.0-blue?style=flat-square)
![Go Version](https://img.shields.io/badge/Go-1.24+-00ADD8?style=flat-square&logo=go)
![React](https://img.shields.io/badge/React-Vite-61DAFB?style=flat-square&logo=react)

**超軽量・高性能・セルフホスト型 Web メディアサーバー**

![ログインページ](docs/images/login-page.png)

</div>

---

🌐 **Language**: [English](README.md) | 日本語 | [한국어](README.ko.md)

---

> [!IMPORTANT]
>
> **v0.15.0 ライブラリ再スキャンのお知らせ**: 再帰 leaf-series スキャナーの導入により、ネストされたフォルダの解釈方法が変更されます。アップデート後はライブラリの再スキャンが必要であり、シリーズ構成が再構築されるライブラリでは、既存の読書進捗やメタデータの関連付けが引き継がれない可能性があります。
>
> **v0.14.0 プラグインシークレットキーの追加**
> プラグイン認証情報（APIキー、トークンなど）を暗号化するための `PLUGIN_SECRET_KEY` 環境変数が追加されました。
>
> 設定しない場合、キーは自動生成されて `data/.plugin_secret_key` に保存されます。サーバーは設定なしで起動しますが、**キーファイルが失われた場合、保存されたプラグイン認証情報は復号できなくなります**。安定した運用のために、`PLUGIN_SECRET_KEY` を環境変数として明示的に設定することを推奨します。
>
> **v0.10.x Docker更新**: CGO/ネイティブライブラリ互換性のため、Dockerベースイメージを変更しました。更新時はイメージを再Pullし、コンテナを再作成してください。
>
> **v0.9.0 セキュリティ強化および重大な変更 (Breaking Change)**
> セキュリティ向上のため、コンテナの実行権限を `root` から一般ユーザー (`appuser`) に変更しました。
>
> **既存ユーザーの方へ**: サムネイルが表示されない、または "Permission Denied" エラーが発生する場合は、必ず `PUID` と `PGID` 環境変数を自身のユーザー ID（ターミナルで `id` コマンドで確認）に設定してください。

---

## 🇯🇵 Kumiho(クミホ)とは？

**Kumiho**は、個人所有の漫画や小説などの書籍ファイルを管理し、ストリーミングできるWebベースのメディアサーバーです。

既存のソリューションに不便さを感じた開発者が、自身の利便性のために優先的に開発しました。**Golang**で書かれており、軽量で高速です。

### ✨ 主な特徴

| 特徴                                | 説明                                                                                                                         |
| :---------------------------------- | :--------------------------------------------------------------------------------------------------------------------------- |
| **🚀 圧倒的な速度**                 | Golangベースのネイティブバイナリで実行されます。JVMのオーバーヘッドがなく、スキャン速度が非常に高速です。                    |
| **📂 再帰 Leaf 探索**               | 複雑なメタデータの突き合わせなしに、ネストされたフォルダを再帰的に走査して実際に読める leaf シリーズを収集します。           |
| **⚡ 軽量なリソース**               | 低スペックのNASでもメモリ使用量を気にせず快適に動作します。                                                                  |
| **📱 レスポンシブWebビューア**      | PC、タブレット、モバイルなど、どこでも途切れのないストリーミングビューアを提供します。（Webtoonモード対応）                  |
| **🎧 オーディオブック対応**         | オーディオブックライブラリをサポートし、チャプター一覧、続きから再生、進捗管理、ブックマーク、スリープタイマーを提供します。 |
| **🎵 没入型BGM再生**                | シリーズフォルダ内に作品ファイル名と同じオーディオファイル(`.mp3`)があれば、鑑賞時に自動再生されます。                       |

### 対応フォーマット

| 分類           | 対応拡張子                                                                               |
| :------------- | :--------------------------------------------------------------------------------------- |
| **画像**       | `.jpg`, `.jpeg`, `.png`, `.webp`, `.gif`, `.bmp`                                         |
| **アーカイブ** | `.zip`, `.cbz`                                                                           |
| **電子書籍**   | `.epub`, `.pdf`, `.txt`                                                                  |
| **オーディオ** | `.mp3`, `.wav`, `.ogg`, `.oga`, `.flac`, `.m4a`, `.m4b`, `.aac`, `.wma`, `.opus`, `.mp4` |

> 📁 **フォルダ構造**: フォルダ内の画像ファイル、またはアーカイブファイルを自動的に認識し、巻/チャプターとして構成します。

#### 🔜 対応予定

| 分類           | 予定拡張子                    |
| :------------- | :---------------------------- |
| **アーカイブ** | `.cbr`, `.rar`, `.cb7`, `.7z` |

- `comicInfo.xml` 対応
  - メタデータ管理の連携
- OPDS 対応
  - モバイルビューアアプリ対応

### 📁 推奨ライブラリ構成

#### 1) シリーズ直下に巻/チャプターファイルを配置

```text
/books
└── My Series
    ├── 001.zip
    ├── 002.pdf
    └── 003.epub
```

#### 2) シリーズ配下にチャプター(または巻)フォルダを分けて配置

```text
/books
└── My Series
    ├── Chapter 01
    │   ├── 001.zip
    │   └── 002.zip
    ├── Chapter 02
    │   └── 001.pdf
    └── Chapter 03
        └── 001.epub
```

#### 3) 入れ子構造（無制限の階層）

Kumihoは**再帰 leaf 探索**によって無制限のフォルダ階層をサポートします。サブフォルダを自由に構成しても、実際に読める leaf シリーズまで辿って収集します。

```text
/books
└── 大分類
    └── 中分類
        └── My Series
            ├── 第01巻
            │   ├── 第01話
            │   │   └── 001.zip
            │   └── 第02話.pdf
            └── 002.epub
```

この例では、中間フォルダ全体を別個のツリー UI として表示するのではなく、ネストされた構造を辿って見つかった leaf シリーズをライブラリ一覧に追加します。

### 🎵 BGM自動再生ルール

- 対応オーディオ形式: `.mp3`, `.ogg`, `.wav`, `.flac`, `.m4a`
- 閲覧中の巻/チャプターファイルと同じベース名のオーディオがある場合、自動再生されます。
- 例: `001.zip` ↔ `001.mp3`, `001.epub` ↔ `001.mp3`

### 🎧 オーディオブック対応

- 対応オーディオ形式: `.mp3`, `.wav`, `.ogg`, `.oga`, `.flac`, `.m4a`, `.m4b`, `.aac`, `.wma`, `.opus`, `.mp4`
- 続きから再生、チャプター移動、進捗管理、ブックマーク、スリープタイマーに対応
- 書籍と同じように、入れ子フォルダ構造でオーディオブックを整理できます
- オーディオブック用ライブラリを作成する場合は、ライブラリタイプを **Audiobook** に設定してください

### 🛠 インストール方法 (Docker)

#### Docker Compose (推奨)

```yaml
version: "3.8"
services:
  kumiho:
    image: ahahyeong/kumiho:latest
    container_name: kumiho
    restart: unless-stopped
    ports:
      - "9999:9999" # 外部ポート:内部ポート
    volumes:
      - ./data:/app/data # DBおよびデータ (必須)
      - ./config:/app/config # 設定 (任意)
      - ./books:/books # 図書ライブラリパス
    environment:
      - PUID=1000 # ユーザー ID (idコマンドで確認可能)
      - PGID=1000 # グループ ID
      - TZ=Asia/Seoul
      - JWT_SECRET=your_secret_key # セキュリティのための秘密鍵設定
      - PLUGIN_SECRET_KEY=your_plugin_secret_key # 必須: 未設定の場合、再インストール後にプラグイン認証情報が復号不可
```

#### Docker Run

```bash
docker run -d \
  --name kumiho \
  -p 9999:9999 \
  -v $(pwd)/data:/app/data \
  -v $(pwd)/config:/app/config \
  -v $(pwd)/books:/books \
  -e PUID=1000 \
  -e PGID=1000 \
  -e TZ=Asia/Seoul \
  -e JWT_SECRET=your_secret_key \
  -e PLUGIN_SECRET_KEY=your_plugin_secret_key \
  --restart unless-stopped \
  ahahyeong/kumiho:latest
```

### 📂 ライブラリパス設定ガイド

Docker Compose設定で`volumes`に`./books:/books`としてマウントした場合、Kumiho設定ページでは**コンテナ内部パス**である`/books`を入力する必要があります。

![ライブラリパス設定](docs/images/library-settings.png)

1. **Settings > Libraries** タブに移動します。
2. **Add New Library** ボタンをクリックします。
3. **Set Path** フィールドに `/books` を入力します。（ホストパスである `./books` ではありません！）

> 注: スキャナーは `@eaDir`, `#recycle`, `.DS_Store`, `Thumbs.db` を自動的に除外します。

## 🐞 バグ報告・機能リクエスト

- [GitHub Issues](https://github.com/aha-hyeong/kumiho/issues)
- ahahyeong@gmail.com
