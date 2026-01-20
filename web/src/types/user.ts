export interface User {
  id: string;
  username: string; // 로그인 ID
  nickname: string; // 사용자명
  role: "MASTER" | "USER";
  allowed_library_ids?: string[];
  created_at: string;
  updated_at: string;
}
