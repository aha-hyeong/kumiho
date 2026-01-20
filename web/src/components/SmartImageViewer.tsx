import styles from "./SmartImageViewer.module.css";
import { useSmartImage } from "../hooks/useSmartImage";

interface SmartImageViewerProps extends React.ImgHTMLAttributes<HTMLImageElement> {
  src: string;
  nextSrc?: string;
  className?: string;
}

export function SmartImageViewer({ src, nextSrc, className, ...props }: SmartImageViewerProps) {
  const { displaySrc, isLoading, LOADING_OPACITY, TRANSITION_STYLE } = useSmartImage(src, nextSrc, props.onLoad);

  return (
    <div className={`${styles.container} ${className || ""}`}>
      <img
        {...props}
        src={displaySrc}
        className={className}
        style={{
          ...props.style,
          opacity: isLoading ? LOADING_OPACITY : 1,
          transition: TRANSITION_STYLE,
        }}
      />
    </div>
  );
}
