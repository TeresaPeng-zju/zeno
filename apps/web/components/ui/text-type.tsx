"use client";

import { useEffect, useState, useRef } from "react";

/**
 * Lightweight typewriter component (ReactBits-compatible API, no GSAP dependency).
 * Types text once, then stops. Cursor fades out after typing completes.
 */

interface TextTypeProps {
  text: string;
  typingSpeed?: number;
  initialDelay?: number;
  showCursor?: boolean;
  cursorCharacter?: string;
  className?: string;
  cursorClassName?: string;
}

export default function TextType({
  text,
  typingSpeed = 50,
  initialDelay = 0,
  showCursor = true,
  cursorCharacter = "|",
  className = "",
  cursorClassName = "",
}: TextTypeProps) {
  const [displayed, setDisplayed] = useState("");
  const [done, setDone] = useState(false);
  const indexRef = useRef(0);

  useEffect(() => {
    const startTimeout = setTimeout(() => {
      const interval = setInterval(() => {
        indexRef.current += 1;
        setDisplayed(text.slice(0, indexRef.current));
        if (indexRef.current >= text.length) {
          clearInterval(interval);
          // Fade out cursor after a brief pause
          setTimeout(() => setDone(true), 800);
        }
      }, typingSpeed);

      return () => clearInterval(interval);
    }, initialDelay);

    return () => clearTimeout(startTimeout);
  }, [text, typingSpeed, initialDelay]);

  return (
    <span className={className}>
      {displayed}
      {showCursor && (
        <span
          className={`inline-block transition-opacity duration-500 ${done ? "opacity-0" : "animate-blink"} ${cursorClassName}`}
        >
          {cursorCharacter}
        </span>
      )}
    </span>
  );
}
