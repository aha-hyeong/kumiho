import { useSmartImage } from "../hooks/useSmartImage";

interface SmartImageViewerProps extends React.ImgHTMLAttributes<HTMLImageElement> {
  src: string;
  nextSrc?: string;
  className?: string;
}

export function SmartImageViewer({ src, nextSrc, className, ...props }: SmartImageViewerProps) {
  const { displaySrc, isLoading, LOADING_OPACITY, TRANSITION_STYLE } = useSmartImage(src, nextSrc, props.onLoad);

  return (
    <div
      className={`smart-image-wrapper ${className || ""}`}
      style={{ position: "relative", width: "100%", height: "100%" }}
    >
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
