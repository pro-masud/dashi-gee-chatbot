// Interactive 3D Rotating Airtight Jar Wireframe & Aroma-Seal Silhouette
export function initSpecsCanvas(canvas: HTMLCanvasElement | null): () => void {
  if (!canvas) return () => {};
  const ctx = canvas.getContext('2d');
  if (!ctx) return () => {};

  const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let angle = 0;
  const baseSpeed = 0.007;
  let hoverBoost = 0;
  let rafId = 0;

  const resize = () => {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.floor(canvas.clientWidth * dpr);
    const h = Math.floor(canvas.clientHeight * dpr);
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
  };

  const onEnter = () => {
    hoverBoost = 0.016;
  };
  const onLeave = () => {
    hoverBoost = 0;
  };

  const parent = canvas.parentElement;
  parent?.addEventListener('pointerenter', onEnter);
  parent?.addEventListener('pointerleave', onLeave);
  window.addEventListener('resize', resize, { passive: true });
  
  let ro: ResizeObserver | null = null;
  if (typeof ResizeObserver !== 'undefined' && parent) {
    ro = new ResizeObserver(() => resize());
    ro.observe(parent);
  }
  resize();

  // Apothecary wide-mouth ghee jar profile (base -> body -> shoulder -> brass lid)
  const rings = [
    { y: -0.82, r: 0.52 },
    { y: -0.74, r: 0.58 },
    { y: 0.24, r: 0.58 },
    { y: 0.42, r: 0.47 },
    { y: 0.52, r: 0.45 },
    { y: 0.58, r: 0.50 },
    { y: 0.78, r: 0.50 },
    { y: 0.82, r: 0.48 },
  ];

  const draw = () => {
    const w = canvas.width;
    const h = canvas.height;
    if (w <= 0 || h <= 0) {
      resize();
      if (!prefersReduced) {
        rafId = requestAnimationFrame(draw);
      }
      return;
    }
    ctx.clearRect(0, 0, w, h);

    const isLight = document.documentElement.getAttribute('data-sf-theme') === 'light';
    const strokeEspresso = isLight ? 'rgba(30, 23, 16, 0.22)' : 'rgba(229, 198, 150, 0.22)';
    const strokeAmber = isLight ? 'rgba(180, 123, 43, 0.85)' : 'rgba(229, 178, 93, 0.9)';

    const cx = w * 0.5;
    const cy = h * 0.5;
    const scaleY = Math.min(w, h) * 0.39;
    const scaleX = scaleY * 0.92;

    if (!prefersReduced) {
      angle += baseSpeed + hoverBoost;
    }

    ctx.lineWidth = Math.max(1.2, w / 380);
    for (let i = 0; i < rings.length; i++) {
      const { y, r } = rings[i];
      ctx.beginPath();
      ctx.strokeStyle = i >= 5 ? strokeAmber : strokeEspresso;
      const rx = r * scaleX;
      const ry = r * scaleX * 0.24;
      const py = cy - y * scaleY;
      ctx.ellipse(cx, py, rx, ry, 0, 0, Math.PI * 2);
      ctx.stroke();
    }

    const meridians = 14;
    for (let m = 0; m < meridians; m++) {
      const theta = angle + (m * Math.PI * 2) / meridians;
      const cosT = Math.cos(theta);
      const sinT = Math.sin(theta);

      ctx.beginPath();
      ctx.strokeStyle = m % 4 === 0 ? strokeAmber : strokeEspresso;
      for (let i = 0; i < rings.length; i++) {
        const { y, r } = rings[i];
        const px = cx + cosT * r * scaleX;
        const py = cy - y * scaleY + sinT * r * scaleX * 0.24;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.stroke();
    }

    if (!prefersReduced) {
      rafId = requestAnimationFrame(draw);
    }
  };

  rafId = requestAnimationFrame(draw);

  return () => {
    cancelAnimationFrame(rafId);
    ro?.disconnect();
    parent?.removeEventListener('pointerenter', onEnter);
    parent?.removeEventListener('pointerleave', onLeave);
    window.removeEventListener('resize', resize);
  };
}
