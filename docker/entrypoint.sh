#!/bin/sh
set -e

# PUID와 PGID 환경변수 확인 (기본값: 1000)
USER_ID=${PUID:-1000}
GROUP_ID=${PGID:-1000}

# UID/GID가 유효한 양의 정수(1~65535)인지 확인
if ! echo "$USER_ID" | grep -qE '^[0-9]+$' || [ "$USER_ID" -lt 1 ] || [ "$USER_ID" -gt 65535 ]; then
    echo "ERROR: PUID must be a valid positive integer between 1 and 65535" >&2
    exit 1
fi

if ! echo "$GROUP_ID" | grep -qE '^[0-9]+$' || [ "$GROUP_ID" -lt 1 ] || [ "$GROUP_ID" -gt 65535 ]; then
    echo "ERROR: PGID must be a valid positive integer between 1 and 65535" >&2
    exit 1
fi

echo "Starting with UID: $USER_ID, GID: $GROUP_ID"

# 컨테이너 내부 사용자 ID만 변경
if ! groupmod -o -g "$GROUP_ID" appgroup; then
    echo "ERROR: Failed to modify group ID to $GROUP_ID for appgroup." >&2
    exit 1
fi

if ! usermod -o -u "$USER_ID" appuser; then
    echo "ERROR: Failed to modify user ID to $USER_ID for appuser." >&2
    exit 1
fi

# 필수 데이터 디렉토리 소유권 설정 (보안 강화)
# 사용자의 도서 폴더(/books 등)는 건드리지 않고, 앱 구동에 필수적인 폴더만 관리합니다.
chown -R appuser:appgroup /app/config /app/data

# su-exec를 사용하여 appuser 권한으로 실제 바이너리 실행
exec su-exec appuser ./kumiho "$@"
