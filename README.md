# <img src="web/public/Logo.svg" alt="Logo" width="50" height="50" style="vertical-align: middle;"/> Kumiho

<div align="center">

![GitHub release (latest by date)](https://img.shields.io/github/v/release/aha-hyeong/kumiho?style=flat-square)
![Docker Image Size (latest by date)](https://img.shields.io/docker/image-size/aha-hyeong/kumiho?style=flat-square)
![GitHub](https://img.shields.io/github/license/aha-hyeong/kumiho?style=flat-square)
![Go Version](https://img.shields.io/badge/Go-1.21+-00ADD8?style=flat-square&logo=go)
![React](https://img.shields.io/badge/React-Vite-61DAFB?style=flat-square&logo=react)

**초경량, 고성능 개인 호스팅 웹 미디어 서버** **Ultra-lightweight, High-performance Self-hosted Web Media Server**

[앱 시연 GIF 이미지 경로]

</div>

---

## 🌐 Language

- [한국어 (Korean)](#korean)
- [English](#english)

---

<a name="korean"></a>

## 🇰🇷 구미호(Kumiho) 소개

**구미호(Kumiho)**는 만화, 소설 등 개인 소장 도서 파일을 관리하고 스트리밍할 수 있는 웹 기반 미디어 서버입니다.

기존 솔루션들에서 불편함을 느낀 개발자가 본인의 편의를 위해 우선적으로 개발했습니다. **Golang**으로 작성되어 가볍고 빠릅니다.

### ✨ 주요 특징

| 특징                      | 설명                                                                                           |
| :------------------------ | :--------------------------------------------------------------------------------------------- |
| **🚀 압도적인 속도**      | Golang 기반의 네이티브 바이너리로 실행됩니다. JVM 오버헤드가 없으며 스캔 속도가 매우 빠릅니다. |
| **📂 파일 시스템 미러링** | 복잡한 메타데이터 관리 없이도, 내 폴더 구조 그대로(Tree View) 라이브러리를 보여줍니다.         |
| **⚡ 가벼운 리소스**      | 저사양 NAS에서도 메모리 점유율 걱정 없이 쾌적하게 구동됩니다.                                  |
| **📱 반응형 웹 뷰어**     | PC, 태블릿, 모바일 어디서든 끊김 없는 스트리밍 뷰어를 제공합니다. (Webtoon 모드 지원)          |
| **🐳 간편한 설치**        | 복잡한 의존성 없이 Docker 컨테이너 하나, 또는 실행 파일 하나(Single Binary)로 즉시 실행됩니다. |

### � 지원 포맷

| 분류         | 지원 확장자                                      |
| :----------- | :----------------------------------------------- |
| **이미지**   | `.jpg`, `.jpeg`, `.png`, `.webp`, `.gif`, `.bmp` |
| **아카이브** | `.zip`, `.cbz`                                   |

> 📁 **폴더 구조**: 폴더 내 이미지 파일들, 또는 아카이브 파일을 자동으로 인식하여 볼륨/챕터로 구성합니다.

#### 🔜 지원 예정

| 분류         | 예정 확장자                   |
| :----------- | :---------------------------- |
| **아카이브** | `.cbr`, `.rar`, `.cb7`, `.7z` |
| **전자책**   | `.epub`, `.pdf`               |

### 🛠 설치 방법 (Docker)

가장 간편한 설치 방법은 Docker를 사용하는 것입니다.

```yaml
version: "3.8"
services:
  kumiho:
    image: aha-hyeong/kumiho:latest
    container_name: kumiho
    restart: unless-stopped
    ports:
      - "8080:8080"
    volumes:
      - ./config:/app/config # 설정 및 DB 저장 경로
      - /path/to/your/books:/books # 내 도서 라이브러리 경로
    environment:
      - TZ=Asia/Seoul
```

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
| **🐳 Easy Deployment**       | Distributable as a single binary or a lightweight Docker container. Say goodbye to dependency hell.                                           |

### � Supported Formats

| Category     | Supported Extensions                             |
| :----------- | :----------------------------------------------- |
| **Images**   | `.jpg`, `.jpeg`, `.png`, `.webp`, `.gif`, `.bmp` |
| **Archives** | `.zip`, `.cbz`                                   |

> 📁 **Folder Structure**: Automatically recognizes image files in folders or archive files and organizes them into volumes/chapters.

#### 🔜 Coming Soon

| Category     | Planned Extensions            |
| :----------- | :---------------------------- |
| **Archives** | `.cbr`, `.rar`, `.cb7`, `.7z` |
| **E-books**  | `.epub`, `.pdf`               |

### 🛠 Installation (Docker)

The simplest way to run Kumiho is via Docker.

```yaml
version: "3.8"
services:
  kumiho:
    image: aha-hyeong/kumiho:latest
    container_name: kumiho
    restart: unless-stopped
    ports:
      - "8080:8080"
    volumes:
      - ./config:/app/config # Stores configuration and database
      - /path/to/your/books:/books # Path to your library
    environment:
      - TZ=Asia/Seoul
```
