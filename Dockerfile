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

# Frontend 빌드 결과물 복사 (임베딩용, 현재는 사용하지 않지만 추후 확장 가능)
COPY --from=frontend-builder /app/web/dist ./web/dist

# Backend 빌드
WORKDIR /app/backend
RUN CGO_ENABLED=1 go build -ldflags="-s -w" -o /app/kumiho ./cmd/server

# =============================================================================
# Stage 3: Runtime
# =============================================================================
FROM alpine:latest

# 런타임 의존성 설치
RUN apk add --no-cache ca-certificates tzdata

WORKDIR /app

# 바이너리 복사
COPY --from=backend-builder /app/kumiho ./kumiho

# Frontend 정적 파일 복사
COPY --from=frontend-builder /app/web/dist ./web/dist

# 설정 및 데이터 디렉토리
RUN mkdir -p /app/config /app/data

# 포트 노출
EXPOSE 8080

# 볼륨 마운트 포인트
VOLUME ["/app/config", "/books"]

# 환경 변수
ENV TZ=Asia/Seoul

# 실행
ENTRYPOINT ["./kumiho"]
