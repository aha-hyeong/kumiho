import { Link } from "react-router-dom";
import { LogOut, Menu } from "lucide-react";
import { useAuthStore } from "../stores/authStore";
import "./Header.css";

interface HeaderProps {
  onMenuClick?: () => void;
}

export function Header({ onMenuClick }: HeaderProps) {
  const user = useAuthStore((state) => state.user);
  const logout = useAuthStore((state) => state.logout);

  return (
    <header className="app-header">
      <div className="header-left">
        {onMenuClick && (
          <button
            className="menu-btn"
            onClick={onMenuClick}
          >
            <Menu size={22} />
          </button>
        )}
        <Link
          to="/"
          className="logo-link"
        >
          <img
            src="/Logo.svg"
            alt="Kumiho Logo"
            className="logo-icon"
          />
          <span className="logo-text">Kumiho</span>
        </Link>
      </div>
      <div className="header-right">
        <span className="user-info">
          {user?.username}
          {user?.role === "MASTER" && <span className="role-badge">관리자</span>}
        </span>
        <button
          onClick={logout}
          className="logout-button"
        >
          <LogOut size={16} /> 로그아웃
        </button>
      </div>
    </header>
  );
}
