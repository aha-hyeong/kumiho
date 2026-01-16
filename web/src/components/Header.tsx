import { Link, useNavigate } from "react-router-dom";
import { LogOut, Menu, Settings } from "lucide-react";
import { useAuthStore } from "../stores/authStore";
import styles from "./Header.module.css";

interface HeaderProps {
  onMenuClick?: () => void;
}

export function Header({ onMenuClick }: HeaderProps) {
  const navigate = useNavigate();
  const user = useAuthStore((state) => state.user);
  const logout = useAuthStore((state) => state.logout);

  return (
    <header className={styles.appHeader}>
      <div className={styles.headerLeft}>
        {onMenuClick && (
          <button
            className={styles.menuBtn}
            onClick={onMenuClick}
            aria-label="Open menu"
          >
            <Menu size={22} />
          </button>
        )}
        <Link
          to="/"
          className={styles.logoLink}
        >
          <img
            src="/Logo.svg"
            alt="Kumiho Logo"
            className={styles.logoIcon}
          />
          <span className={styles.logoText}>Kumiho</span>
        </Link>
      </div>
      <div className={styles.headerRight}>
        <span className={styles.userInfo}>
          {user?.username}
          {user?.role === "MASTER" && <span className={styles.roleBadge}>관리자</span>}
        </span>
        {user?.role === "MASTER" && (
          <button
            onClick={() => navigate("/settings")}
            className={styles.settingsButton}
            title="설정"
          >
            <Settings size={18} />
          </button>
        )}
        <button
          onClick={logout}
          className={styles.logoutButton}
        >
          <LogOut size={16} /> 로그아웃
        </button>
      </div>
    </header>
  );
}
