# <img src="web/public/Logo.svg" alt="Logo" width="50" height="50" style="vertical-align: middle;"/> Kumiho

<div align="center">

[![Discord](https://img.shields.io/badge/Discord-Join%20Server-5865F2?style=flat-square&logo=discord&logoColor=white)](https://discord.gg/KYaWSCUNQt)
![GitHub release (latest by date)](https://badgen.net/github/release/aha-hyeong/kumiho?label=version)
![Docker Image Size (latest by date)](https://img.shields.io/docker/image-size/ahahyeong/kumiho?style=flat-square)
![License](https://img.shields.io/badge/license-Apache--2.0-blue?style=flat-square)
![Go Version](https://img.shields.io/badge/Go-1.24+-00ADD8?style=flat-square&logo=go)
![React](https://img.shields.io/badge/React-Vite-61DAFB?style=flat-square&logo=react)

**초경량, 고성능 개인 호스팅 웹 미디어 서버**

![로그인 페이지](docs/images/login-page.png)

</div>

---

🌐 **Language**: [English](README.md) | [日本語](README.ja.md) | 한국어

---

> [!IMPORTANT]
>
> **v0.15.0 라이브러리 재스캔 안내**: 재귀 leaf-series 스캐너 도입으로 중첩 폴더 해석 방식이 변경됩니다. 업데이트 후 라이브러리 재스캔이 필요하며, 시리즈 구성이 다시 잡히는 라이브러리에서는 기존 읽기 진행 상황이나 메타데이터 연결 승계를 보장하지 않습니다.
>
> **v0.14.0 플러그인 시크릿 키 추가**
> 플러그인 자격증명(API 키, 토큰 등)을 암호화하기 위한 `PLUGIN_SECRET_KEY` 환경변수가 추가되었습니다.
>
> 설정하지 않으면 키가 자동 생성되어 `data/.plugin_secret_key`에 저장됩니다. 서버는 별도 설정 없이 시작되지만, **키 파일이 유실될 경우 저장된 플러그인 자격증명을 복호화할 수 없게 됩니다.** 안정적인 운영을 위해 `PLUGIN_SECRET_KEY`를 환경변수로 직접 설정하는 것을 권장합니다.
>
> **v0.10.x Docker 업데이트**: CGO/네이티브 라이브러리 호환성을 위해 Docker 베이스 이미지를 변경했습니다. 업데이트 시 이미지를 다시 pull하고 컨테이너를 recreate 해주세요.
>
> **v0.9.0 보안 강화 및 중대 변경 사항 (Breaking Change)**
> 이번 업데이트는 보안 향상을 위해 컨테이너 실행 권한을 `root`에서 일반 사용자(`appuser`)로 변경하였습니다.
>
> **기존 사용자 유의사항**: 썸네일이 깨지거나 "Permission Denied" 에러가 발생하는 경우, 반드시 `PUID`와 `PGID` 환경변수를 자신의 계정 ID(터미널에서 `id` 명령어로 확인)로 설정해 주시기 바랍니다.

---

## 🇰🇷 구미호(Kumiho) 소개

<strong>구미호(Kumiho)</strong>는 만화, 소설 등 개인 소장 도서 파일을 관리하고 스트리밍할 수 있는 웹 기반 미디어 서버입니다.

기존 솔루션들에서 불편함을 느낀 개발자가 본인의 편의를 위해 우선적으로 개발했습니다. **Golang**으로 작성되어 가볍고 빠릅니다.

### ✨ 주요 특징

| 특징                      | 설명                                                                                               |
| :------------------------ | :------------------------------------------------------------------------------------------------- |
| **🚀 압도적인 속도**      | Golang 기반의 네이티브 바이너리로 실행됩니다. JVM 오버헤드가 없으며 스캔 속도가 매우 빠릅니다.     |
| **📂 재귀 Leaf 탐색**     | 복잡한 메타데이터 매칭 없이 중첩 폴더를 재귀 탐색하여 실제로 읽을 수 있는 leaf 시리즈를 수집합니다. |
| **⚡ 가벼운 리소스**      | 저사양 NAS에서도 메모리 점유율 걱정 없이 쾌적하게 구동됩니다.                                      |
| **📱 반응형 웹 뷰어**     | PC, 태블릿, 모바일 어디서든 끊김 없는 스트리밍 뷰어를 제공합니다. (Webtoon 모드 지원)              |
| **🎧 오디오북 지원**      | 오디오북 라이브러리를 지원하며 챕터 목록, 이어듣기, 진행도 추적, 북마크, 수면 타이머를 제공합니다. |
| **🎵 몰입형 BGM 재생**    | 시리즈 폴더 내에 작품 파일명과 동일한 오디오 파일(`.mp3`)이 있으면 감상 시 자동 재생됩니다.        |

### 지원 포맷

| 분류         | 지원 확장자                                                                              |
| :----------- | :--------------------------------------------------------------------------------------- |
| **이미지**   | `.jpg`, `.jpeg`, `.png`, `.webp`, `.gif`, `.bmp`                                         |
| **아카이브** | `.zip`, `.cbz`                                                                           |
| **전자책**   | `.epub`, `.pdf`, `.txt`                                                                  |
| **오디오**   | `.mp3`, `.wav`, `.ogg`, `.oga`, `.flac`, `.m4a`, `.m4b`, `.aac`, `.wma`, `.opus`, `.mp4` |

> 📁 **폴더 구조**: 폴더 내 이미지 파일들, 또는 아카이브 파일을 자동으로 인식하여 볼륨/챕터로 구성합니다.

#### 🔜 지원 예정

| 분류         | 예정 확장자                   |
| :----------- | :---------------------------- |
| **아카이브** | `.cbr`, `.rar`, `.cb7`, `.7z` |

- `comicInfo.xml` 지원
  - 메타데이터 관리 지원
- `OPDS` 기능
  - 모바일 뷰어 앱 지원

### 📁 추천 라이브러리 구조

#### 1) 시리즈 폴더에 볼륨/챕터 파일 직접 배치

```text
/books
└── My Series
    ├── 001.zip
    ├── 002.pdf
    └── 003.epub
```

#### 2) 시리즈 폴더 하위에 챕터(또는 볼륨) 폴더를 나누어 배치

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

#### 3) 중첩 폴더 구조 (무제한 계층)

구미호는 **재귀 leaf 탐색 방식**으로 무제한 폴더 계층 구조를 지원합니다. 하위 폴더를 자유롭게 구성해도 실제로 읽을 수 있는 leaf 시리즈까지 내려가서 수집합니다.

```text
/books
└── 대분류 폴더
    └── 중분류 폴더
        └── My Series
            ├── 01권 폴더
            │   ├── 01화 폴더
            │   │   └── 01.zip
            │   └── 02화.pdf
            └── 02권.epub
```

위 예시에서는 중간 폴더를 그대로 별도 트리 UI로 보여주는 대신, 해당 구조를 따라 내려가서 실제 leaf 시리즈를 라이브러리 목록에 구성합니다.

### 🎵 BGM 자동 재생 규칙

- 지원 오디오 형식: `.mp3`, `.ogg`, `.wav`, `.flac`, `.m4a`
- 현재 읽는 볼륨/챕터 파일과 베이스 파일명이 동일한 오디오 파일이 있으면 자동 재생됩니다.
- 예시: `001.zip` ↔ `001.mp3`, `001.epub` ↔ `001.mp3`

### 🎧 오디오북 지원

- 지원 오디오 형식: `.mp3`, `.wav`, `.ogg`, `.oga`, `.flac`, `.m4a`, `.m4b`, `.aac`, `.wma`, `.opus`, `.mp4`
- 이어듣기, 챕터 이동, 진행도 추적, 북마크, 수면 타이머를 지원합니다
- 책과 동일하게 중첩 폴더 구조로 오디오북을 정리할 수 있습니다
- 오디오북용 라이브러리를 생성할 때는 라이브러리 타입을 **Audiobook**으로 설정해야 합니다

### 🛠 설치 방법 (Docker)

#### Docker Compose (권장)

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
      - PUID=1000 # 유저 ID (id 명령어로 확인 가능)
      - PGID=1000 # 그룹 ID
      - TZ=Asia/Seoul
      - JWT_SECRET=your_secret_key # 보안을 위한 비밀키 설정
      - PLUGIN_SECRET_KEY=your_plugin_secret_key # 필수: 미설정 시 재설치 후 플러그인 자격증명 복호화 불가
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

### 📂 라이브러리 경로 설정 가이드

Docker Compose 설정에서 `volumes`에 `./books:/books`로 마운트한 경우, Kumiho 설정 페이지에서는 **컨테이너 내부 경로**인 `/books`를 입력해야 합니다.

![라이브러리 경로 설정](docs/images/library-settings.png)

1. **설정 > 라이브러리** 탭으로 이동합니다.
2. **Add New Library** 버튼을 클릭합니다.
3. **Set Path** 필드에 `/books`를 입력합니다. (호스트 경로인 `./books`가 아닙니다!)

> 참고: 스캐너는 `@eaDir`, `#recycle`, `.DS_Store`, `Thumbs.db`를 자동으로 제외합니다.

## 🐞 버그 제보 및 기능 요청

- [GitHub Issues](https://github.com/aha-hyeong/kumiho/issues)
- ahahyeong@gmail.com
