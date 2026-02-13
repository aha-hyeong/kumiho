import { Monitor, Smartphone, Tablet, Globe } from "lucide-react";
import type { TFunction } from "i18next";

/**
 * 디바이스 타입에 따른 아이콘 반환
 */
export const getDeviceIcon = (deviceType: string, size = 20) => {
  switch (deviceType) {
    case "desktop":
      return <Monitor size={size} />;
    case "mobile":
      return <Smartphone size={size} />;
    case "tablet":
      return <Tablet size={size} />;
    default:
      return <Globe size={size} />;
  }
};

/**
 * 상대 시간 포맷팅
 */
export const formatRelativeTime = (dateStr: string, t: TFunction) => {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  const diffHr = Math.floor(diffMs / 3600000);
  const diffDay = Math.floor(diffMs / 86400000);

  if (diffMin < 1) return t("settings.account.sessions.just_now");
  if (diffMin < 60) return t("settings.account.sessions.minutes_ago", { count: diffMin });
  if (diffHr < 24) return t("settings.account.sessions.hours_ago", { count: diffHr });
  return t("settings.account.sessions.days_ago", { count: diffDay });
};
