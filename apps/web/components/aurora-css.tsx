"use client";

import { useEffect, useRef } from "react";

/**
 * CSS + SVG feTurbulence aurora with mouse interaction.
 * Colors: Zeno cyan + violet + gold.
 * Mouse proximity increases turbulence intensity (aurora reacts to cursor).
 */
export function AuroraCss() {
  const filterRef = useRef<SVGFETurbulenceElement | null>(null);
  const displacementRef = useRef<SVGFEDisplacementMapElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const filter = filterRef.current;
    const displacement = displacementRef.current;
    if (!filter) return;

    let frames = 0;
    let animId = 0;
    const rad = Math.PI / 180;

    // Mouse influence (smoothed)
    let mouseInfluence = 0;
    let targetInfluence = 0;

    function onMouseMove(e: MouseEvent) {
      // Influence across whole page, strongest at top
      const yRatio = e.clientY / window.innerHeight;
      targetInfluence = Math.max(0, 1 - yRatio) * 0.9;
    }

    function onMouseLeave() {
      targetInfluence = 0;
    }

    function animate() {
      frames += 1.5;

      // Smooth mouse influence
      mouseInfluence += (targetInfluence - mouseInfluence) * 0.08;

      // Base frequency + mouse boost (larger range = more visible motion)
      const boost = mouseInfluence * 0.006;
      const bfx = 0.005 + 0.004 * Math.cos(frames * rad) + boost;
      const bfy = 0.005 + 0.004 * Math.sin(frames * rad * 0.7) + boost;
      filter!.setAttributeNS(null, "baseFrequency", `${bfx} ${bfy}`);

      // Displacement scale: more intense near mouse
      if (displacement) {
        const baseScale = 120;
        const extraScale = mouseInfluence * 120;
        displacement.setAttributeNS(null, "scale", String(baseScale + extraScale));
      }

      animId = requestAnimationFrame(animate);
    }

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseleave", onMouseLeave);
    animId = requestAnimationFrame(animate);

    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseleave", onMouseLeave);
    };
  }, []);

  return (
    <>
      {/* SVG filter definition */}
      <svg className="absolute h-0 w-0" aria-hidden="true">
        <defs>
          <filter id="aurora-wave" x="-50%" y="-50%" width="200%" height="200%">
            <feTurbulence
              ref={filterRef}
              type="fractalNoise"
              baseFrequency="0.003 0.003"
              numOctaves={3}
              seed={8}
              result="noise"
            />
            <feDisplacementMap
              ref={displacementRef}
              in="SourceGraphic"
              in2="noise"
              scale={120}
              xChannelSelector="R"
              yChannelSelector="G"
            />
          </filter>
        </defs>
      </svg>

      {/* Aurora layers */}
      <div
        className="pointer-events-none fixed inset-0 z-0 overflow-hidden"
        aria-hidden="true"
      >
        {/* Layer 1: Main cyan aurora */}
        <div
          className="aurora-layer"
          style={{
            width: "140%",
            height: "400px",
            top: "5%",
            left: "-20%",
            background: "radial-gradient(ellipse at 70% 80%, transparent 40%, hsl(183 86% 52% / 0.45) 55%, hsl(183 70% 40% / 0.25) 70%, transparent 85%)",
            transform: "rotate(-8deg) scaleX(1.3)",
          }}
        />
        {/* Layer 2: Violet accent */}
        <div
          className="aurora-layer"
          style={{
            width: "120%",
            height: "350px",
            top: "12%",
            left: "-10%",
            background: "radial-gradient(ellipse at 30% 70%, transparent 45%, hsl(270 60% 50% / 0.3) 58%, hsl(280 50% 40% / 0.15) 72%, transparent 88%)",
            transform: "rotate(5deg) scaleX(1.5)",
            animationDelay: "-2s",
          }}
        />
        {/* Layer 3: Gold highlight */}
        <div
          className="aurora-layer"
          style={{
            width: "100%",
            height: "280px",
            top: "18%",
            left: "5%",
            background: "radial-gradient(ellipse at 50% 90%, transparent 50%, hsl(43 100% 50% / 0.15) 62%, hsl(43 80% 40% / 0.08) 75%, transparent 90%)",
            transform: "rotate(-3deg) scaleX(1.2)",
            animationDelay: "-4s",
          }}
        />
        {/* Layer 4: Bottom cyan ribbon */}
        <div
          className="aurora-layer"
          style={{
            width: "140%",
            height: "300px",
            bottom: "5%",
            left: "-20%",
            top: "auto",
            background: "radial-gradient(ellipse at 30% 20%, transparent 40%, hsl(183 86% 52% / 0.3) 55%, hsl(183 70% 40% / 0.15) 70%, transparent 85%)",
            transform: "rotate(6deg) scaleX(1.4)",
            animationDelay: "-6s",
          }}
        />
        {/* Layer 5: Bottom violet accent */}
        <div
          className="aurora-layer"
          style={{
            width: "110%",
            height: "250px",
            bottom: "10%",
            left: "0%",
            top: "auto",
            background: "radial-gradient(ellipse at 70% 30%, transparent 45%, hsl(270 60% 50% / 0.2) 58%, hsl(280 50% 40% / 0.1) 72%, transparent 88%)",
            transform: "rotate(-4deg) scaleX(1.3)",
            animationDelay: "-8s",
          }}
        />
      </div>
    </>
  );
}
