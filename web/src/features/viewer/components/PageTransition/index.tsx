import React, { forwardRef } from "react";
import { type ReadingDirection, type PageTransitionType } from "../../../../stores/viewerStore";
import styles from "./PageTransition.module.css";

interface PageTransitionProps {
  children: React.ReactNode;
  prevChildren?: React.ReactNode;
  nextChildren?: React.ReactNode;
  offset: number;
  isAnimating: boolean;
  readingDirection: ReadingDirection;
  transitionType: PageTransitionType;
  gap?: number;
  duration?: number;
  className?: string;
  style?: React.CSSProperties;
  onTouchStart?: (e: React.TouchEvent) => void;
  onTouchMove?: (e: React.TouchEvent) => void;
  onTouchEnd?: (e: React.TouchEvent) => void;
  onClick?: (e: React.MouseEvent | React.TouchEvent) => void;
  onMouseDown?: (e: React.MouseEvent) => void;
  onMouseMove?: (e: React.MouseEvent) => void;
}

export const PageTransition = forwardRef<HTMLDivElement, PageTransitionProps>(
  (
    {
      children,
      prevChildren,
      nextChildren,
      offset,
      isAnimating,
      readingDirection,
      transitionType,
      gap = 20,
      duration = 300,
      className,
      style,
      onTouchStart,
      onTouchMove,
      onTouchEnd,
      onClick,
      onMouseDown,
      onMouseMove,
    },
    ref,
  ) => {
    const isRTL = readingDirection === "rtl";

    if (transitionType === "fade") {
      return (
        <div
          ref={ref}
          className={`${className} ${styles.fadeContainer}`}
          onTouchStart={onTouchStart}
          onTouchMove={onTouchMove}
          onTouchEnd={onTouchEnd}
          onClick={onClick}
          onMouseDown={onMouseDown}
          onMouseMove={onMouseMove}
          style={{
            ...style,
            position: "relative",
            width: "100%",
            height: "100%",
            overflow: "hidden",
          }}
        >
          {/* We simplify fade: just the current children with an animation class if needed */}
          {/* Note: In a full implementation, we might want to overlay prev/next during swipe */}
          <div
            className={isAnimating ? styles.fadeIn : ""}
            style={{
              width: "100%",
              height: "100%",
              transition: isAnimating ? `opacity ${duration}ms ease-out` : "none",
            }}
          >
            {children}
          </div>
        </div>
      );
    }

    if (transitionType === "none") {
      return (
        <div
          ref={ref}
          className={className}
          onTouchStart={onTouchStart}
          onTouchMove={onTouchMove}
          onTouchEnd={onTouchEnd}
          onClick={onClick}
          onMouseDown={onMouseDown}
          onMouseMove={onMouseMove}
          style={{
            ...style,
            width: "100%",
            height: "100%",
            position: "relative",
            overflow: "hidden",
          }}
        >
          {children}
        </div>
      );
    }

    // Default: Slide
    return (
      <div
        ref={ref}
        className={className}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onClick={onClick}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        style={{
          width: "100%",
          height: "100%",
          position: "relative",
          overflow: "hidden",
          ...style,
        }}
      >
        <div
          style={{
            display: "flex",
            width: "100%",
            height: "100%",
            transform: `translateX(${offset}px)`,
            transition: isAnimating ? `transform ${duration}ms ease-out` : "none",
          }}
        >
          {/* Next Pages Slot */}
          <div
            style={{
              position: "absolute",
              left: isRTL ? `calc(-100% - ${gap}px)` : `calc(100% + ${gap}px)`,
              top: 0,
              width: "100%",
              height: "100%",
            }}
          >
            {nextChildren}
          </div>

          {/* Prev Pages Slot */}
          <div
            style={{
              position: "absolute",
              left: isRTL ? `calc(100% + ${gap}px)` : `calc(-100% - ${gap}px)`,
              top: 0,
              width: "100%",
              height: "100%",
            }}
          >
            {prevChildren}
          </div>

          {/* Current Active Slot */}
          <div style={{ width: "100%", height: "100%", flexShrink: 0 }}>{children}</div>
        </div>
      </div>
    );
  },
);
