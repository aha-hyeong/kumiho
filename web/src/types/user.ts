export interface User {
  id: string;
  username: string;
  email: string;
  role: "MASTER" | "USER";
  created_at: string;
  updated_at: string;
}
