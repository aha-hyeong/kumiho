# =============================================================================
# Stage 1: Frontend Build
# =============================================================================
FROM node:20-alpine AS frontend-builder

WORKDIR /app/web

# 의존성 파일 복사 및 설치
COPY web/package*.json ./
RUN npm ci

# 소스 코드 복사 및 빌드
COPY web/ ./
RUN npm run build

# =============================================================================
# Stage 2: Backend Build
# =============================================================================
FROM golang:1.24-alpine AS backend-builder

# CGO를 위한 C 컴파일러 설치
RUN apk add --no-cache gcc musl-dev

WORKDIR /app

# Go 모듈 파일 복사 및 다운로드
COPY backend/go.mod backend/go.sum ./backend/
RUN cd backend && go mod download

# 소스 코드 복사
COPY backend/ ./backend/

# Frontend 빌드 결과물 복사 (임베딩 필수)
COPY --from=frontend-builder /app/web/dist ./backend/internal/frontend/dist

# Backend 빌드
WORKDIR /app/backend
RUN CGO_ENABLED=1 go build -ldflags="-s -w" -o /app/kumiho ./cmd/server

# =============================================================================
# Stage 3: Runtime
# =============================================================================
FROM alpine:3.20

# 런타임 의존성 설치 및 non-root 사용자 생성
RUN apk add --no-cache ca-certificates tzdata su-exec shadow \
    && addgroup -S appgroup \
    && adduser -S appuser -G appgroup

WORKDIR /app

# 바이너리 복사 (Frontend가 임베딩되어 있음)
COPY --from=backend-builder /app/kumiho ./kumiho

# 엔트리포인트 스크립트 복사 및 권한 설정
COPY docker/entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh

# 설정 및 데이터 디렉토리 생성 (동적 UID/GID 환경에서도 쓰기 가능하도록 권한 설정)
RUN mkdir -p /app/config /app/data && chmod 777 /app/config /app/data

# 포트 노출
EXPOSE 9999

# 볼륨 마운트 포인트
VOLUME ["/app/config", "/app/data", "/books"]

# 환경 변수
ENV TZ=Asia/Seoul

# 실행 (entrypoint 스크립트가 root로 시작하여 PUID/PGID 처리 후 appuser로 전환)
ENTRYPOINT ["/app/entrypoint.sh"]

