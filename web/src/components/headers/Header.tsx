import { useState, useEffect, useRef } from "react";
import { Link, useNavigate } from "react-router-dom";
import { LogOut, Menu, Settings, ChevronDown, User, Search, X, ChevronRight } from "lucide-react";
import { useAuthStore } from "../../stores/authStore";
import { seriesAPI } from "../../api/client";
import type { Series } from "../../types/series";
import { ScanProgressBar } from "../ScanProgressBar";
import styles from "./Header.module.css";

interface HeaderProps {
  onMenuClick?: () => void;
}

export function Header({ onMenuClick }: HeaderProps) {
  const navigate = useNavigate();
  const user = useAuthStore((state) => state.user);
  const logout = useAuthStore((state) => state.logout);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [searchExpanded, setSearchExpanded] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [liveResults, setLiveResults] = useState<Series[]>([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [isKeyboardNav, setIsKeyboardNav] = useState(false);

  const dropdownRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const searchContainerRef = useRef<HTMLDivElement>(null);

  const MAX_VISIBLE_RESULTS = 5;

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setDropdownOpen(false);
      }

      // 검색창 외부 클릭
      if (searchContainerRef.current && !searchContainerRef.current.contains(event.target as Node)) {
        if (searchQuery === "") {
          setSearchExpanded(false);
        }
        setShowDropdown(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [searchQuery]);

  // 실시간 검색 (Debounce)
  useEffect(() => {
    if (!searchQuery.trim()) {
      setLiveResults([]);
      setShowDropdown(false);
      setSelectedIndex(-1);
      setSearchError(null);
      return;
    }

    const timer = setTimeout(async () => {
      setSearchError(null);
      try {
        const response = await seriesAPI.search(searchQuery.trim());
        const results = response.data.series || [];
        setLiveResults(results);
        setShowDropdown(true);
        setSelectedIndex(-1);
      } catch (error) {
        console.error("Live search failed:", error);
        setLiveResults([]);
        setSearchError("검색 중 오류가 발생했습니다.");
        setShowDropdown(true);
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [searchQuery]);

  const handleSearchSubmit = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (searchQuery.trim()) {
      navigate(`/search?q=${encodeURIComponent(searchQuery.trim())}`);
      searchInputRef.current?.blur();
      setShowDropdown(false);
      setSearchExpanded(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!showDropdown || liveResults.length === 0) return;

    setIsKeyboardNav(true);
    const visibleResultCount = Math.min(liveResults.length, MAX_VISIBLE_RESULTS);
    const allResultsButtonIndex = visibleResultCount; // "전체 보기" 버튼 인덱스

    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((prev) => (prev < allResultsButtonIndex ? prev + 1 : 0));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((prev) => (prev > 0 ? prev - 1 : allResultsButtonIndex));
    } else if (e.key === "Enter") {
      if (selectedIndex >= 0 && selectedIndex < visibleResultCount) {
        e.preventDefault();
        handleResultClick(liveResults[selectedIndex].id);
      } else if (selectedIndex === allResultsButtonIndex) {
        e.preventDefault();
        handleSearchSubmit();
      }
    } else if (e.key === "Escape") {
      setShowDropdown(false);
    }
  };

  const handleResultClick = (seriesID: string) => {
    navigate(`/series/${seriesID}`);
    setSearchQuery("");
    setShowDropdown(false);
    setSearchExpanded(false);
    setSelectedIndex(-1);
  };

  const toggleSearch = () => {
    if (!searchExpanded) {
      setSearchExpanded(true);
      setTimeout(() => searchInputRef.current?.focus(), 100);
    }
  };

  const handleLogout = () => {
    logout();
    setDropdownOpen(false);
    navigate("/login");
  };

  return (
    <>
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
            className={styles.searchContainer}
            ref={searchContainerRef}
          >
            <div
              className={`${styles.searchWrapper} ${searchExpanded ? styles.expanded : ""}`}
              onClick={toggleSearch}
            >
              <div className={styles.searchIconWrapper}>
                <Search size={18} />
              </div>
              <form
                onSubmit={handleSearchSubmit}
                className={styles.searchForm}
              >
                <input
                  ref={searchInputRef}
                  type="text"
                  className={styles.searchInput}
                  placeholder="시리즈 검색..."
                  aria-label="시리즈 검색"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onKeyDown={handleKeyDown}
                  onBlur={() => {
                    if (searchQuery === "") setSearchExpanded(false);
                  }}
                />
              </form>
              {searchExpanded && searchQuery && (
                <button
                  className={styles.clearBtn}
                  aria-label="검색어 지우기"
                  onClick={(e) => {
                    e.stopPropagation();
                    setSearchQuery("");
                    setLiveResults([]);
                    setShowDropdown(false);
                    setSelectedIndex(-1);
                    searchInputRef.current?.focus();
                  }}
                >
                  <X size={14} />
                </button>
              )}
            </div>

            {/* 실시간 검색 결과 드롭다운 */}
            {showDropdown && (
              <div className={styles.searchDropdown}>
                <div className={styles.dropdownTitle}>추천 검색 결과</div>
                {searchError && <div className={styles.searchError}>{searchError}</div>}
                <div
                  className={styles.resultsList}
                  onMouseMove={() => setIsKeyboardNav(false)}
                >
                  {liveResults.length > 0 ? (
                    <>
                      {liveResults.slice(0, MAX_VISIBLE_RESULTS).map((series: Series, index: number) => (
                        <div
                          key={series.id}
                          className={`${styles.searchResultItem} ${selectedIndex === index ? styles.active : ""}`}
                          onClick={() => handleResultClick(series.id)}
                          onMouseEnter={() => !isKeyboardNav && setSelectedIndex(index)}
                          role="button"
                          tabIndex={0}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              handleResultClick(series.id);
                            }
                          }}
                        >
                          <div className={styles.resultThumbnailWrapper}>
                            <img
                              src={series.thumbnail_url}
                              alt={series.title}
                              className={styles.resultThumbnail}
                            />
                          </div>
                          <div className={styles.resultInfo}>
                            <span className={styles.resultName}>{series.title}</span>
                            {series.metadata?.authors && (
                              <span className={styles.resultAuthor}>{series.metadata.authors}</span>
                            )}
                          </div>
                        </div>
                      ))}
                      <button
                        className={`${styles.allResultsBtn} ${selectedIndex === Math.min(liveResults.length, MAX_VISIBLE_RESULTS) ? styles.active : ""}`}
                        onClick={() => handleSearchSubmit()}
                        onMouseEnter={() =>
                          !isKeyboardNav && setSelectedIndex(Math.min(liveResults.length, MAX_VISIBLE_RESULTS))
                        }
                      >
                        전체 결과 보기 ({liveResults.length}) <ChevronRight size={14} />
                      </button>
                    </>
                  ) : (
                    <div className={styles.noResults}>검색 결과가 없습니다.</div>
                  )}
                </div>
              </div>
            )}
          </div>

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

                <button
                  onClick={() => {
                    navigate("/settings");
                    setDropdownOpen(false);
                  }}
                  className={styles.dropdownItem}
                >
                  <Settings size={16} /> 설정
                </button>

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
      <ScanProgressBar />
    </>
  );
}
