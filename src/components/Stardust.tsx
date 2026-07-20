import { useEffect, useRef } from 'react';

interface Particle {
  x: number; y: number; vx: number; vy: number;
  size: number; opacity: number; opacityVel: number;
}

interface Props {
  particleColor?: string;
  density?: number; // 1..10
  speed?: number;   // flicker 1..10
  minSize?: number;
  maxSize?: number;
}

/**
 * Adapted from Originkit "Stardust": a subtle field of drifting, flickering
 * particles on a TRANSPARENT canvas. Patched for a static site — Framer
 * bindings removed, respects prefers-reduced-motion, and pauses its animation
 * loop whenever the tab is hidden (protects battery / Core Web Vitals).
 */
export default function Stardust({
  particleColor = '#c8443a',
  density = 3,
  speed = 3,
  minSize = 1,
  maxSize = 2.2,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const parent = canvas?.parentElement;
    if (!canvas || !parent) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const flicker = 0.5 + ((Math.max(1, Math.min(10, speed)) - 1) / 9) * 11.5;
    let particles: Particle[] = [];

    const countFor = (w: number, h: number) =>
      Math.floor((w * h / 1e4) * (5 + ((Math.max(1, Math.min(10, density)) - 1) / 9) * 55) * 0.15);

    const init = (w: number, h: number) => {
      particles = [];
      const n = countFor(w, h);
      for (let i = 0; i < n; i++) {
        particles.push({
          x: Math.random() * w, y: Math.random() * h,
          vx: (Math.random() - 0.5) * 0.15, vy: (Math.random() - 0.5) * 0.15,
          size: minSize + Math.random() * (maxSize - minSize),
          opacity: Math.random(), opacityVel: (Math.random() - 0.5) * 0.04,
        });
      }
    };

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      const w = parent.clientWidth || 1;
      const h = parent.clientHeight || 1;
      canvas.width = w * dpr; canvas.height = h * dpr;
      canvas.style.width = `${w}px`; canvas.style.height = `${h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      init(w, h);
    };
    resize();

    const draw = (w: number, h: number) => {
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = particleColor;
      for (const p of particles) {
        ctx.globalAlpha = p.opacity;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    };

    const step = () => {
      const dpr = window.devicePixelRatio || 1;
      const w = canvas.width / dpr;
      const h = canvas.height / dpr;
      for (const p of particles) {
        p.x += p.vx; p.y += p.vy;
        if (p.x < 0) p.x = w; if (p.x > w) p.x = 0;
        if (p.y < 0) p.y = h; if (p.y > h) p.y = 0;
        p.opacity += p.opacityVel * flicker * 0.5;
        if (p.opacity <= 0.1 || p.opacity >= 1) p.opacityVel *= -1;
        p.opacity = Math.max(0.1, Math.min(1, p.opacity));
      }
      draw(w, h);
      rafRef.current = requestAnimationFrame(step);
    };

    const dpr = window.devicePixelRatio || 1;
    if (reduce) draw(canvas.width / dpr, canvas.height / dpr);
    else step();

    const onVis = () => {
      if (document.hidden) {
        if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
      } else if (!reduce && rafRef.current == null) {
        step();
      }
    };
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('resize', resize);

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('resize', resize);
    };
  }, [particleColor, density, speed, minSize, maxSize]);

  return (
    <canvas
      ref={canvasRef}
      style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', display: 'block', pointerEvents: 'none' }}
    />
  );
}
