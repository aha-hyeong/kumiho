import { useState, useEffect, useRef } from "react";

interface SmartImageViewerProps extends React.ImgHTMLAttributes<HTMLImageElement> {
  src: string;
  nextSrc?: string;
  className?: string;
}

export function SmartImageViewer({ src, nextSrc, className, ...props }: SmartImageViewerProps) {
  // displaySrc holds the image URL that is currently visible
  const [displaySrc, setDisplaySrc] = useState<string>(src);
  // isLoading is true while the *new* src is fetching.
  // We keep showing the *old* displaySrc during this time.
  const [isLoading, setIsLoading] = useState(false);

  // Track the last requested src to avoid race conditions or redundant updates
  const currentSrcRef = useRef(src);

  // Keep the latest onLoad callback in a ref to avoid re-triggering effects
  const onLoadRef = useRef(props.onLoad);
  useEffect(() => {
    onLoadRef.current = props.onLoad;
  }, [props.onLoad]);

  useEffect(() => {
    // If the prop src hasn't changed, do nothing
    if (src === currentSrcRef.current) {
      return;
    }
    currentSrcRef.current = src;

    // Start loading the new image
    setIsLoading(true);

    const img = new Image();
    img.src = src;

    // Once loaded, update the display and stop loading state
    img.onload = (e) => {
      // Only update if this is still the requested src (handle race conditions)
      if (src === currentSrcRef.current) {
        setDisplaySrc(src);
        setIsLoading(false);
        // Call onLoad prop if provided
        onLoadRef.current?.(e as any);
      }
    };

    img.onerror = () => {
      // On error, we might still want to switch to show the broken image icon
      // or handle it gracefully. For now, let's switch so the user knows it failed.
      if (src === currentSrcRef.current) {
        setDisplaySrc(src);
        setIsLoading(false);
      }
    };

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src]);

  // Handle preloading next page
  useEffect(() => {
    if (!nextSrc) return;

    const img = new Image();
    img.src = nextSrc;

    return () => {
      // Cancel preloading if component unmounts or nextSrc changes
      img.src = "";
    };
  }, [nextSrc]);

  return (
    <div
      className={`smart-image-wrapper ${className || ""}`}
      style={{ position: "relative", width: "100%", height: "100%" }}
    >
      {/* 
        We display the 'displaySrc'. 
        While 'isLoading' is true, this is still the OLD image.
        Once 'isLoading' becomes false, this updates to the NEW image.
      */}
      <img
        {...props}
        src={displaySrc}
        className={className}
        style={{
          ...props.style,
          // Optional: visual cue that loading is happening, e.g. slight dim
          opacity: isLoading ? 0.7 : 1,
          transition: "opacity 0.2s ease-in-out",
        }}
      />
    </div>
  );
}
