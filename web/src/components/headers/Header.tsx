import { useState, useEffect, useRef } from "react";
import { Link, useNavigate } from "react-router-dom";
import { LogOut, Menu, Settings, ChevronDown, User } from "lucide-react";
import { useAuthStore } from "../../stores/authStore";
import styles from "./Header.module.css";

interface HeaderProps {
  onMenuClick?: () => void;
}

export function Header({ onMenuClick }: HeaderProps) {
  const navigate = useNavigate();
  const user = useAuthStore((state) => state.user);
  const logout = useAuthStore((state) => state.logout);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, []);

  const handleLogout = () => {
    logout();
    setDropdownOpen(false);
    navigate("/login");
  };

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
        <div
          className={styles.userDropdownContainer}
          ref={dropdownRef}
        >
          <button
            className={`${styles.userDropdownTrigger} ${dropdownOpen ? styles.active : ""}`}
            onClick={() => setDropdownOpen(!dropdownOpen)}
          >
            <span className={styles.userIconWrapper}>
              <User size={18} />
            </span>
            <span className={styles.userInfo}>
              <span className={styles.nickname}>{user?.nickname}</span>
              {user?.role === "MASTER" && <span className={styles.roleBadge}>MASTER</span>}
            </span>
            <ChevronDown
              size={14}
              className={styles.chevron}
              style={{ transform: dropdownOpen ? "rotate(180deg)" : "none" }}
            />
          </button>

          {dropdownOpen && (
            <div className={styles.dropdownMenu}>
              <div className={styles.dropdownHeader}>
                <p className={styles.dropdownNickname}>{user?.nickname}</p>
                <p className={styles.dropdownRole}>{user?.role}</p>
              </div>
              <div className={styles.dropdownDivider} />

              {user?.role === "MASTER" && (
                <button
                  onClick={() => {
                    navigate("/settings");
                    setDropdownOpen(false);
                  }}
                  className={styles.dropdownItem}
                >
                  <Settings size={16} /> 설정
                </button>
              )}

              <button
                onClick={handleLogout}
                className={`${styles.dropdownItem} ${styles.logoutItem}`}
              >
                <LogOut size={16} /> 로그아웃
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
