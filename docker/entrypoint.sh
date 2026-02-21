#!/bin/sh

# PUID와 PGID 환경변수 확인 (기본값은 기존 appuser의 ID)
USER_ID=${PUID:-1000}
GROUP_ID=${PGID:-1000}

echo "Starting with UID: $USER_ID, GID: $GROUP_ID"

# appgroup의 GID 변경
groupmod -o -g "$GROUP_ID" appgroup

# appuser의 UID 변경
usermod -o -u "$USER_ID" appuser

# 서비스 필수 디렉토리 소유권 변경
# 호스트 볼륨 매핑 시 권한 불일치 문제를 해결하기 위해 실행 시점에 소유권 조정
chown -R appuser:appgroup /app/data /app/config

# su-exec를 사용하여 appuser 권한으로 실제 바이너리 실행
exec su-exec appuser ./kumiho "$@"
