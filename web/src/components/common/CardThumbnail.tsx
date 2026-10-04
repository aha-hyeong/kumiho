import { useCallback, useState, type ReactNode } from "react";
import styles from "./CardThumbnail.module.css";

interface CardThumbnailProps {
  src: string;
  imageClassName: string;
  backdropClassName?: string;
  fallback: ReactNode;
}

/** Decorative cover. Key by src to reset only the image, never its parent card. */
export function CardThumbnail({ src, imageClassName, backdropClassName, fallback }: CardThumbnailProps) {
  const [status, setStatus] = useState<"loading" | "loaded" | "error">("loading");
  const imageRef = useCallback((image: HTMLImageElement | null) => {
    // A memory-cached image may complete before React attaches its load handler.
    if (image?.complete) setStatus(image.naturalWidth > 0 ? "loaded" : "error");
  }, []);
  const loadedClass = status === "loaded" ? styles.loaded : "";

  return (
    <div className={styles.thumbnail} data-thumbnail-state={src ? status : "unavailable"} aria-hidden="true">
      {status !== "loaded" && (
        <div className={styles.placeholder} data-thumbnail-placeholder>
          {(!src || status === "error") && fallback}
        </div>
      )}
      {src && status !== "error" && backdropClassName && (
        <div
          className={`${backdropClassName} ${styles.image} ${loadedClass}`}
          data-thumbnail-backdrop
          style={{ backgroundImage: status === "loaded" ? `url(${JSON.stringify(src)})` : undefined }}
        />
      )}
      {src && status !== "error" && (
        <img
          ref={imageRef}
          src={src}
          alt=""
          className={`${imageClassName} ${styles.image} ${loadedClass}`}
          onLoad={() => setStatus("loaded")}
          onError={() => setStatus("error")}
          loading="lazy"
          draggable={false}
        />
      )}
    </div>
  );
}
