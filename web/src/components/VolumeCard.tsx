import { useState, useRef, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { BookOpen, Play, MoreVertical, BookCheck, BookX } from "lucide-react";
import { volumeAPI } from "../api/client";
import type { Volume } from "../types/series";
import "./VolumeCard.css";

interface VolumeCardProps {
  volume: Volume;
  onStatusChange?: () => void;
}

export function VolumeCard({ volume, onStatusChange }: VolumeCardProps) {
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // 메뉴 외부 클릭 시 닫기
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    };

    if (menuOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [menuOpen]);

  const getImageUrl = (url: string) => {
    const token = localStorage.getItem("access_token");
    if (!token) return url;
    const separator = url.includes("?") ? "&" : "?";
    return `${url}${separator}token=${token}`;
  };

  // 카드 클릭 시 볼륨 상세 페이지로 이동
  const handleCardClick = (e: React.MouseEvent) => {
    e.preventDefault();
    navigate(`/volumes/${volume.id}`);
  };

  // 설정 메뉴 버튼 클릭
  const handleMenuClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setMenuOpen(!menuOpen);
  };

  // 읽은 것으로 표시 (완독 상태)
  const handleMarkAsRead = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setMenuOpen(false);

    setIsUpdating(true);
    try {
      await volumeAPI.markComplete(volume.id);
      onStatusChange?.();
    } catch (error) {
      console.error("Failed to mark as read:", error);
    } finally {
      setIsUpdating(false);
    }
  };

  // 읽지 않은 것으로 표시 (완독 해제)
  const handleMarkAsUnread = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setMenuOpen(false);

    setIsUpdating(true);
    try {
      await volumeAPI.deleteCompletion(volume.id);
      onStatusChange?.();
    } catch (error) {
      console.error("Failed to mark as unread:", error);
    } finally {
      setIsUpdating(false);
    }
  };

  return (
    <div
      className={`volume-card ${isUpdating ? "loading" : ""}`}
      onClick={handleCardClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === "Enter" && handleCardClick(e as unknown as React.MouseEvent)}
    >
      <div className="volume-cover">
        {volume.thumbnail_url ? (
          <img
            src={getImageUrl(volume.thumbnail_url)}
            alt={volume.title}
            className="volume-thumbnail"
            loading="lazy"
          />
        ) : (
          <BookOpen size={40} />
        )}
        {/* 재생 오버레이 */}
        <div className="volume-play-overlay">
          <Play
            size={32}
            fill="white"
          />
        </div>
        {/* 설정 메뉴 버튼 */}
        <div
          className="volume-menu-wrapper"
          ref={menuRef}
        >
          <button
            className="volume-menu-button"
            onClick={handleMenuClick}
            title="더보기"
          >
            <MoreVertical size={18} />
          </button>
          {/* 드롭다운 메뉴 */}
          {menuOpen && (
            <div className="volume-dropdown-menu">
              <button
                className="volume-menu-item"
                onClick={handleMarkAsRead}
              >
                <BookCheck size={16} />
                <span>읽은 것으로 표시</span>
              </button>
              <button
                className="volume-menu-item"
                onClick={handleMarkAsUnread}
              >
                <BookX size={16} />
                <span>읽지 않은 것으로 표시</span>
              </button>
            </div>
          )}
        </div>
      </div>
      <div className="volume-info">
        <h3 className="volume-title">{volume.title}</h3>
        <p className="volume-number">{volume.volume_number}권</p>
      </div>
    </div>
  );
}
