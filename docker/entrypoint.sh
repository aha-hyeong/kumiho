#!/bin/sh

# PUID와 PGID 환경변수 확인 (기본값: 1000)
USER_ID=${PUID:-1000}
GROUP_ID=${PGID:-1000}

# PUID=0(root) 방지
if [ "$USER_ID" = "0" ]; then
    echo "WARNING: PUID=0 is not allowed. Using default UID 1000."
    USER_ID=1000
fi

echo "Starting with UID: $USER_ID, GID: $GROUP_ID"

# 컨테이너 내부 사용자 ID만 변경 (호스트 파일 시스템은 건드리지 않음)
groupmod -o -g "$GROUP_ID" appgroup
usermod -o -u "$USER_ID" appuser

# su-exec를 사용하여 appuser 권한으로 실제 바이너리 실행
exec su-exec appuser ./kumiho "$@"
