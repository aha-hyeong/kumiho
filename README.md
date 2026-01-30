# <img src="web/public/Logo.svg" alt="Logo" width="50" height="50" style="vertical-align: middle;"/> Kumiho

<div align="center">

![GitHub tag (latest by date)](https://img.shields.io/github/v/tag/aha-hyeong/kumiho?style=flat-square&label=version)
![Docker Image Size (latest by date)](https://img.shields.io/docker/image-size/ahahyeong/kumiho?style=flat-square)
![GitHub](https://img.shields.io/github/license/aha-hyeong/kumiho?style=flat-square)
![Go Version](https://img.shields.io/badge/Go-1.21+-00ADD8?style=flat-square&logo=go)
![React](https://img.shields.io/badge/React-Vite-61DAFB?style=flat-square&logo=react)

**초경량, 고성능 개인 호스팅 웹 미디어 서버**</br>
**Ultra-lightweight**</br>
**High-performance**</br>
**Self-hosted Web Media Server**

![로그인 페이지](docs/images/login-page.png)

</div>

---

## 🌐 Language(지원 언어)

- [한국어 (Korean)](#korean)
- [English](#english)
- [日本語](#japanese)

> **The primary language is Korean, and translations may not be perfect.**<br>Feedback is welcome and will be reflected as much as possible.
>
> **原文は韓国語であり、翻訳は完璧ではない可能性があります。**<br>ご意見をいただければ、可能な限り反映いたします。
>
> **베이스는 한국어이며 번역본은 완벽하지 않을 수 있습니다.**<br>의견 주시면 최대한 반영하도록 하겠습니다.

---

<a name="korean"></a>

## 🇰🇷 구미호(Kumiho) 소개

<strong>구미호(Kumiho)</strong>는 만화, 소설 등 개인 소장 도서 파일을 관리하고 스트리밍할 수 있는 웹 기반 미디어 서버입니다.

기존 솔루션들에서 불편함을 느낀 개발자가 본인의 편의를 위해 우선적으로 개발했습니다. **Golang**으로 작성되어 가볍고 빠릅니다.

### ✨ 주요 특징

| 특징                      | 설명                                                                                           |
| :------------------------ | :--------------------------------------------------------------------------------------------- |
| **🚀 압도적인 속도**      | Golang 기반의 네이티브 바이너리로 실행됩니다. JVM 오버헤드가 없으며 스캔 속도가 매우 빠릅니다. |
| **📂 파일 시스템 미러링** | 복잡한 메타데이터 관리 없이도, 내 폴더 구조 그대로(Tree View) 라이브러리를 보여줍니다.         |
| **⚡ 가벼운 리소스**      | 저사양 NAS에서도 메모리 점유율 걱정 없이 쾌적하게 구동됩니다.                                  |
| **📱 반응형 웹 뷰어**     | PC, 태블릿, 모바일 어디서든 끊김 없는 스트리밍 뷰어를 제공합니다. (Webtoon 모드 지원)          |
| **🎵 몰입형 BGM 재생**    | 시리즈 폴더 내에 작품 파일명과 동일한 오디오 파일(`.mp3`)이 있으면 감상 시 자동 재생됩니다.    |

### 지원 포맷

| 분류         | 지원 확장자                                      |
| :----------- | :----------------------------------------------- |
| **이미지**   | `.jpg`, `.jpeg`, `.png`, `.webp`, `.gif`, `.bmp` |
| **아카이브** | `.zip`, `.cbz`                                   |

> 📁 **폴더 구조**: 폴더 내 이미지 파일들, 또는 아카이브 파일을 자동으로 인식하여 볼륨/챕터로 구성합니다.

#### 🔜 지원 예정

| 분류         | 예정 확장자                   |
| :----------- | :---------------------------- |
| **아카이브** | `.cbr`, `.rar`, `.cb7`, `.7z` |
| **전자책**   | `.epub`, `.pdf`, `.txt`       |

- `comicInfo.xml` 지원
  - 메타데이터 관리 지원
- `OPDS` 기능
  - 모바일 뷰어 앱 지원

### 🛠 설치 방법 (Docker)

```yaml
version: "3.8"
services:
  kumiho:
    image: ahahyeong/kumiho:latest
    container_name: kumiho
    restart: unless-stopped
    ports:
      - "9999:9999" # 외부포트:내부포트
    volumes:
      - ./data:/app/data # DB 및 데이터 (필수)
      - ./config:/app/config # 설정 (선택)
      - ./books:/books # 도서 라이브러리 경로
    environment:
      - TZ=Asia/Seoul
      - JWT_SECRET=your_secret_key # 보안을 위한 비밀키 설정
```

### 📂 라이브러리 경로 설정 가이드

Docker Compose 설정에서 `volumes`에 `./books:/books`로 마운트한 경우, Kumiho 설정 페이지에서는 **컨테이너 내부 경로**인 `/books`를 입력해야 합니다.

![라이브러리 경로 설정](docs/images/library-settings.png)

1. **설정 > 라이브러리** 탭으로 이동합니다.
2. **Add New Library** 버튼을 클릭합니다.
3. **Set Path** 필드에 `/books`를 입력합니다. (호스트 경로인 `./books`가 아닙니다!)

## 🐞 버그 제보 및 기능 요청

- [GitHub Issues](https://github.com/aha-hyeong/kumiho/issues)
- ahahyeong@gmail.com

---

<a name="english"></a>

## 🇺🇸 What is Kumiho?

**Kumiho** is a self-hosted web media server designed to manage and stream your personal collection of comics and e-books.

It was originally developed by a developer for personal convenience, after feeling limitations with existing solutions. Written in **Golang**, Kumiho is lightweight and fast.

### ✨ Key Features

| Feature                      | Description                                                                                                                                   |
| :--------------------------- | :-------------------------------------------------------------------------------------------------------------------------------------------- |
| **🚀 Blazing Fast**          | Built with Golang, Kumiho runs as a native binary without JVM overhead, offering incredible scan speeds.                                      |
| **📂 File-System Mirroring** | It mirrors your physical folder structure directly. No complex metadata matching required—what you see in your OS is what you get in the app. |
| **⚡ Lightweight**           | Optimized for low-resource environments. It runs smoothly with minimal memory footprint.                                                      |
| **📱 Responsive Viewer**     | Provides a seamless streaming experience on PC, Tablet, and Mobile devices. Supports 'Webtoon' scrolling mode.                                |
| **🎵 Immersive BGM**         | Automatically plays audio files (`.mp3`) within the series folder when the filename matches.                                                  |

### Supported Formats

| Category     | Supported Extensions                             |
| :----------- | :----------------------------------------------- |
| **Images**   | `.jpg`, `.jpeg`, `.png`, `.webp`, `.gif`, `.bmp` |
| **Archives** | `.zip`, `.cbz`                                   |

> 📁 **Folder Structure**: Automatically recognizes image files in folders or archive files and organizes them into volumes/chapters.

#### 🔜 Coming Soon

| Category     | Planned Extensions            |
| :----------- | :---------------------------- |
| **Archives** | `.cbr`, `.rar`, `.cb7`, `.7z` |
| **E-books**  | `.epub`, `.pdf`, `.txt`       |

- Support `comicInfo.xml`
  - Metadata management interaction
- OPDS Support
  - Mobile viewer application support

### 🛠 Installation (Docker)

```yaml
version: "3.8"
services:
  kumiho:
    image: ahahyeong/kumiho:latest
    container_name: kumiho
    restart: unless-stopped
    ports:
      - "9999:9999"
    volumes:
      - ./data:/app/data # Path to store database and data
      - ./config:/app/config # Path to store configuration
      - ./books:/books # Path to your library
    environment:
      - TZ=Asia/Seoul
      - JWT_SECRET=your_secret_key # Recommended for security
```

### 📂 Library Path Setup Guide

If you mounted `./books:/books` in your Docker Compose `volumes` configuration, you must enter the **container internal path** `/books` on the Kumiho settings page.

![Library Path Settings](docs/images/library-settings.png)

1. Go to the **Settings > Libraries** tab.
2. Click the **Add New Library** button.
3. Enter `/books` in the **Set Path** field. (Do NOT use the host path `./books`!)

## 🐞 Bug Reports & Feature Requests

- [GitHub Issues](https://github.com/aha-hyeong/kumiho/issues)
- ahahyeong@gmail.com

---

<a name="japanese"></a>

## 🇯🇵 Kumiho(クミホ)とは？

**Kumiho**は、個人所有の漫画や小説などの書籍ファイルを管理し、ストリーミングできるWebベースのメディアサーバーです。

既存のソリューションに不便さを感じた開発者が、自身の利便性のために優先的に開発しました。**Golang**で書かれており、軽量で高速です。

### ✨ 主な特徴

| 特徴                                | 説明                                                                                                        |
| :---------------------------------- | :---------------------------------------------------------------------------------------------------------- |
| **🚀 圧倒的な速度**                 | Golangベースのネイティブバイナリで実行されます。JVMのオーバーヘッドがなく、スキャン速度が非常に高速です。   |
| **📂 ファイルシステムミラーリング** | 複雑なメタデータ管理なしで、フォルダ構造そのままで（ツリービュー）ライブラリを表示します。                  |
| **⚡ 軽量なリソース**               | 低スペックのNASでもメモリ使用量を気にせず快適に動作します。                                                 |
| **📱 レスポンシブWebビューア**      | PC、タブレット、モバイルなど、どこでも途切れのないストリーミングビューアを提供します。（Webtoonモード対応） |
| **🎵 没入型BGM再生**                | シリーズフォルダ内に作品ファイル名と同じオーディオファイル(`.mp3`)があれば、鑑賞時に自動再生されます。      |

### 対応フォーマット

| 分類           | 対応拡張子                                       |
| :------------- | :----------------------------------------------- |
| **画像**       | `.jpg`, `.jpeg`, `.png`, `.webp`, `.gif`, `.bmp` |
| **アーカイブ** | `.zip`, `.cbz`                                   |

> 📁 **フォルダ構造**: フォルダ内の画像ファイル、またはアーカイブファイルを自動的に認識し、巻/チャプターとして構成します。

#### 🔜 対応予定

| 分類           | 予定拡張子                    |
| :------------- | :---------------------------- |
| **アーカイブ** | `.cbr`, `.rar`, `.cb7`, `.7z` |
| **電子書籍**   | `.epub`, `.pdf`, `.txt`       |

- `comicInfo.xml` 対応
  - メタデータ管理の連携
- OPDS 対応
  - モバイルビューアアプリ対応

### 🛠 インストール方法 (Docker)

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
      - TZ=Asia/Seoul
      - JWT_SECRET=your_secret_key # セキュリティのための秘密鍵設定
```

### 📂 ライブラリパス設定ガイド

Docker Compose設定で`volumes`に`./books:/books`としてマウントした場合、Kumiho設定ページでは**コンテナ内部パス**である`/books`を入力する必要があります。

![ライブラリパス設定](docs/images/library-settings.png)

1. **Settings > Libraries** タブに移動します。
2. **Add New Library** ボタンをクリックします。
3. **Set Path** フィールドに `/books` を入力します。（ホストパスである `./books` ではありません！）

## 🐞 バグ報告・機能リクエスト

- [GitHub Issues](https://github.com/aha-hyeong/kumiho/issues)
- ahahyeong@gmail.com
