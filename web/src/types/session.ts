export interface Session {
  id: string;
  user_id: string;
  device_name: string;
  device_type: string; // "desktop" | "tablet" | "mobile" | "unknown"
  browser: string;
  os: string;
  ip_address: string;
  is_current: boolean;
  last_active_at: string;
  created_at: string;
  expires_at: string;
  // 관리자 조회용
  username?: string;
  nickname?: string;
}
