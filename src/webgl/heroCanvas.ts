// Procedural WebGL2 Warm Linen & Golden Silk Contour Shader
export function initHeroCanvas(canvas: HTMLCanvasElement | null): () => void {
  if (!canvas) return () => {};
  const gl = canvas.getContext('webgl2', {
    alpha: true,
    antialias: false,
    powerPreference: 'low-power',
  });
  if (!gl) return () => {};

  const vsSource = `#version 300 es
  in vec2 a_pos;
  out vec2 v_uv;
  void main() {
    v_uv = a_pos * 0.5 + 0.5;
    gl_Position = vec4(a_pos, 0.0, 1.0);
  }`;

  const fsSource = `#version 300 es
  precision highp float;
  in vec2 v_uv;
  out vec4 outColor;

  uniform float u_time;
  uniform vec2 u_mouse;
  uniform vec2 u_res;
  uniform float u_dark;

  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
  }

  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = hash(i);
    float b = hash(i + vec2(1.0, 0.0));
    float c = hash(i + vec2(0.0, 1.0));
    float d = hash(i + vec2(1.0, 1.0));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
  }

  void main() {
    vec2 uv = v_uv;
    float aspect = u_res.x / max(u_res.y, 1.0);
    vec2 p = (uv - 0.5) * vec2(aspect, 1.0);

    float n1 = noise(p * 2.1 + vec2(u_time * 0.035, -u_time * 0.02));
    float n2 = noise(p * 4.4 - vec2(u_time * 0.025, u_time * 0.018));
    float elev = n1 * 0.65 + n2 * 0.35;

    float contour = abs(fract(elev * 8.0) - 0.5);
    float line = smoothstep(0.468, 0.496, contour);

    vec2 mPos = (u_mouse - 0.5) * vec2(aspect, 1.0);
    float dist = length(p - mPos);
    float glow = exp(-dist * dist * 2.2);

    // Deep Espresso (#0B0805) + Burnished Gold contour lines (#D4AF37)
    vec3 linenBase = mix(vec3(0.980, 0.969, 0.949), vec3(0.043, 0.031, 0.020), u_dark);
    vec3 goldenGlow = mix(vec3(0.847, 0.659, 0.325), vec3(0.898, 0.698, 0.365), u_dark);
    vec3 amberLine = mix(vec3(0.706, 0.482, 0.169), vec3(0.831, 0.686, 0.216), u_dark);

    vec3 col = mix(linenBase, goldenGlow, glow * mix(0.14, 0.16, u_dark));
    col = mix(col, amberLine, line * mix(0.065, 0.10, u_dark));

    outColor = vec4(col, 1.0);
  }`;

  const compile = (type: number, src: string): WebGLShader | null => {
    const sh = gl.createShader(type);
    if (!sh) return null;
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      gl.deleteShader(sh);
      return null;
    }
    return sh;
  };

  const prog = gl.createProgram();
  if (!prog) return () => {};
  const vs = compile(gl.VERTEX_SHADER, vsSource);
  const fs = compile(gl.FRAGMENT_SHADER, fsSource);
  if (!vs || !fs) {
    if (vs) gl.deleteShader(vs);
    if (fs) gl.deleteShader(fs);
    gl.deleteProgram(prog);
    return () => {};
  }
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    gl.deleteProgram(prog);
    return () => {};
  }

  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
    gl.STATIC_DRAW
  );

  const aPos = gl.getAttribLocation(prog, 'a_pos');
  const uTime = gl.getUniformLocation(prog, 'u_time');
  const uMouse = gl.getUniformLocation(prog, 'u_mouse');
  const uRes = gl.getUniformLocation(prog, 'u_res');
  const uDark = gl.getUniformLocation(prog, 'u_dark');

  let mouseX = 0.72;
  let mouseY = 0.48;
  let targetX = 0.72;
  let targetY = 0.48;
  let rafId = 0;

  const resize = () => {
    if (!canvas) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.floor(canvas.clientWidth * dpr);
    const h = Math.floor(canvas.clientHeight * dpr);
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
  };

  const onPointerMove = (e: PointerEvent) => {
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    targetX = (e.clientX - rect.left) / rect.width;
    targetY = 1.0 - (e.clientY - rect.top) / rect.height;
  };

  let ro: ResizeObserver | null = null;
  const parent = canvas.parentElement;
  if (typeof ResizeObserver !== 'undefined' && parent) {
    ro = new ResizeObserver(() => resize());
    ro.observe(parent);
  }

  window.addEventListener('pointermove', onPointerMove, { passive: true });
  window.addEventListener('resize', resize, { passive: true });
  resize();

  const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const start = performance.now();

  const render = (now: number) => {
    if (canvas.width <= 0 || canvas.height <= 0) {
      resize();
      if (canvas.width <= 0 || canvas.height <= 0) {
        if (!prefersReduced) rafId = requestAnimationFrame(render);
        return;
      }
    }
    mouseX += (targetX - mouseX) * 0.08;
    mouseY += (targetY - mouseY) * 0.08;

    const t = prefersReduced ? 0.0 : (now - start) * 0.001;

    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.useProgram(prog);
    gl.enableVertexAttribArray(aPos);
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

    gl.uniform1f(uTime, t);
    gl.uniform2f(uMouse, mouseX, mouseY);
    gl.uniform2f(uRes, canvas.width, canvas.height);
    gl.uniform1f(uDark, document.documentElement.getAttribute('data-sf-theme') === 'light' ? 0.0 : 1.0);

    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    if (!prefersReduced) {
      rafId = requestAnimationFrame(render);
    }
  };

  rafId = requestAnimationFrame(render);

  return () => {
    cancelAnimationFrame(rafId);
    ro?.disconnect();
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('resize', resize);
  };
}
