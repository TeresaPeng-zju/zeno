"use client";

import { useEffect, useRef } from "react";
import { createNoise3D } from "simplex-noise";

/**
 * Interactive Aurora Curtain — Canvas-based polar aurora with domain warping.
 *
 * Key technique: domain warping (coordinate distortion) to produce
 * S-shaped, curtain-like aurora structures instead of flat cloud noise.
 *
 * Architecture:
 * - Reduced resolution (25-33%) + CSS blur for dreamy look
 * - Domain-warped simplex noise for curved aurora curtains
 * - Mouse creates repulsion field that deforms the light curtain
 * - Pauses when tab hidden
 */
export function InteractiveAurora() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const noise3D = createNoise3D();

    // --- Config ---
    const RESOLUTION_SCALE = 0.28;
    const TIME_SPEED = 0.00025;

    // Domain warping config
    const WARP_SCALE = 0.0025;     // base noise frequency for warping
    const WARP_STRENGTH = 80;       // how much coordinates get displaced
    const CURTAIN_SCALE_X = 0.004;  // final aurora sampling — wider = more horizontal spread
    const CURTAIN_SCALE_Y = 0.0015; // stretched vertically for curtain feel

    // Mouse interaction
    const MOUSE_RADIUS = 160;
    const MOUSE_STRENGTH = 45;
    const MOUSE_LERP = 0.18;

    // --- State ---
    let width = 0;
    let height = 0;
    let cw = 0;
    let ch = 0;
    let animId = 0;
    let paused = false;

    let targetMx = -9999;
    let targetMy = -9999;
    let smoothMx = -9999;
    let smoothMy = -9999;

    // Colors: balanced ambient — visible but not overpowering
    const CYAN = [25, 120, 145];
    const VIOLET = [110, 65, 180];
    const GOLD = [200, 145, 25];

    function resize() {
      width = window.innerWidth;
      height = window.innerHeight;
      cw = Math.floor(width * RESOLUTION_SCALE);
      ch = Math.floor(height * RESOLUTION_SCALE);
      canvas!.width = cw;
      canvas!.height = ch;
    }

    function onMouseMove(e: MouseEvent) {
      targetMx = e.clientX * RESOLUTION_SCALE;
      targetMy = e.clientY * RESOLUTION_SCALE;
    }

    function onMouseLeave() {
      targetMx = -9999;
      targetMy = -9999;
    }

    function onVisibility() {
      paused = document.hidden;
      if (!paused) animId = requestAnimationFrame(draw);
    }

    const startTime = performance.now();

    function draw(now: number) {
      if (paused) return;
      animId = requestAnimationFrame(draw);

      const t = (now - startTime) * TIME_SPEED;

      // Smooth mouse
      if (targetMx > -999) {
        smoothMx += (targetMx - smoothMx) * MOUSE_LERP;
        smoothMy += (targetMy - smoothMy) * MOUSE_LERP;
      } else {
        smoothMx += (-9999 - smoothMx) * 0.02;
        smoothMy += (-9999 - smoothMy) * 0.02;
      }

      const imageData = ctx!.createImageData(cw, ch);
      const data = imageData.data;

      const step = 2;

      for (let y = 0; y < ch; y += step) {
        for (let x = 0; x < cw; x += step) {
          // --- Mouse repulsion ---
          let px = x;
          let py = y;
          const dx = x - smoothMx;
          const dy = y - smoothMy;
          const dist = Math.sqrt(dx * dx + dy * dy);

          if (dist < MOUSE_RADIUS && dist > 0) {
            const influence = (1 - dist / MOUSE_RADIUS) ** 2.5;
            px += (dx / dist) * influence * MOUSE_STRENGTH;
            py += (dy / dist) * influence * MOUSE_STRENGTH;
          }

          // --- Domain Warping (the key to aurora curtain shapes) ---
          // First pass: compute warp displacement from noise
          const warpNx = noise3D(px * WARP_SCALE, py * WARP_SCALE * 0.6, t * 0.8);
          const warpNy = noise3D(px * WARP_SCALE + 300, py * WARP_SCALE * 0.6, t * 0.6);

          // Warp coordinates — this bends space into S-curves
          const warpedX = px + warpNx * WARP_STRENGTH;
          const warpedY = py + warpNy * WARP_STRENGTH * 0.5;

          // --- Second level warp for more complex structure ---
          const warp2x = noise3D(warpedX * WARP_SCALE * 0.7 + 500, warpedY * WARP_SCALE * 0.4, t * 1.1);
          const finalX = warpedX + warp2x * WARP_STRENGTH * 0.4;
          const finalY = warpedY;

          // --- Sample aurora curtain from warped coordinates ---
          // Asymmetric scale: stretched in Y = vertical curtain feel
          const curtain1 = noise3D(finalX * CURTAIN_SCALE_X, finalY * CURTAIN_SCALE_Y, t);
          const curtain2 = noise3D(finalX * CURTAIN_SCALE_X * 1.3 + 200, finalY * CURTAIN_SCALE_Y * 0.8, t * 0.7 + 50);
          const curtain3 = noise3D(finalX * CURTAIN_SCALE_X * 0.6 - 100, finalY * CURTAIN_SCALE_Y * 1.5, t * 1.3 + 100);

          // --- Vertical fade: aurora strongest in upper half, trailing down ---
          const yNorm = y / ch;
          const vertFade =
            Math.exp(-((yNorm - 0.12) ** 2) / 0.08) * 0.9 +
            Math.exp(-((yNorm - 0.32) ** 2) / 0.14) * 0.55 +
            Math.exp(-((yNorm - 0.55) ** 2) / 0.22) * 0.25;

          // --- Curtain threshold: sharpen edges for curtain bands ---
          const c1 = Math.max(0, curtain1 * 1.3 - 0.15) * vertFade;
          const c2 = Math.max(0, curtain2 * 1.1 - 0.2) * vertFade * 0.5;
          const c3 = Math.max(0, curtain3 * 0.95 - 0.25) * vertFade * 0.22;

          // --- Color mixing ---
          const r = CYAN[0] * c1 + VIOLET[0] * c2 + GOLD[0] * c3;
          const g = CYAN[1] * c1 + VIOLET[1] * c2 + GOLD[1] * c3;
          const b = CYAN[2] * c1 + VIOLET[2] * c2 + GOLD[2] * c3;
          const a = Math.min(150, (c1 + c2 + c3) * 130);

          // Fill step×step block
          for (let fy = 0; fy < step && y + fy < ch; fy++) {
            for (let fx = 0; fx < step && x + fx < cw; fx++) {
              const idx = ((y + fy) * cw + (x + fx)) * 4;
              data[idx] = r;
              data[idx + 1] = g;
              data[idx + 2] = b;
              data[idx + 3] = a;
            }
          }
        }
      }

      ctx!.putImageData(imageData, 0, 0);
    }

    // --- Init ---
    resize();
    animId = requestAnimationFrame(draw);

    window.addEventListener("resize", resize);
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseleave", onMouseLeave);
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener("resize", resize);
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseleave", onMouseLeave);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="pointer-events-none fixed inset-0 z-0"
      style={{
        width: "100vw",
        height: "100vh",
        imageRendering: "auto",
        filter: "blur(40px) saturate(1)",
      }}
      aria-hidden="true"
    />
  );
}
