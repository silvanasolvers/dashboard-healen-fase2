// Aurora ambiental Healen — fondo WebGL.
// Manchas violeta/lila que derivan lentamente sobre un blanco cálido, muy suave,
// para dar sensación "viva / regenerativa" sin competir con el contenido.
// Sin librerías: un quad a pantalla completa + fragment shader barato.

const VERT = `
attribute vec2 p;
void main() { gl_Position = vec4(p, 0.0, 1.0); }
`;

const FRAG = `
precision highp float;
uniform vec2 u_res;
uniform float u_time;

// Mancha radial suave (gaussiana barata).
float bloom(vec2 uv, vec2 c, float r) {
  float d = distance(uv, c) / r;
  return exp(-d * d);
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_res;
  uv.x *= u_res.x / u_res.y;
  float ar = u_res.x / u_res.y;
  float t = u_time;

  // Lienzo: blanco con tinte violeta muy leve.
  vec3 col = vec3(0.984, 0.976, 0.996);

  // Paleta Healen.
  vec3 violet = vec3(0.486, 0.298, 0.882);
  vec3 lilac  = vec3(0.733, 0.604, 0.969);
  vec3 mint   = vec3(0.612, 0.847, 0.745);

  // Tres blooms que derivan en órbitas lentas y desfasadas.
  vec2 c1 = vec2(ar * (0.30 + 0.06 * sin(t * 0.13)), 0.28 + 0.05 * cos(t * 0.11));
  vec2 c2 = vec2(ar * (0.74 + 0.05 * cos(t * 0.09)), 0.74 + 0.06 * sin(t * 0.10));
  vec2 c3 = vec2(ar * (0.58 + 0.07 * sin(t * 0.07)), 0.46 + 0.04 * cos(t * 0.15));

  col = mix(col, lilac,  bloom(uv, c1, 0.55) * 0.55);
  col = mix(col, violet, bloom(uv, c2, 0.42) * 0.34);
  col = mix(col, mint,   bloom(uv, c3, 0.34) * 0.16);

  // Viñeta tenue para enfocar el centro.
  vec2 q = gl_FragCoord.xy / u_res - 0.5;
  col -= dot(q, q) * 0.10;

  gl_FragColor = vec4(col, 1.0);
}
`;

function compile(gl: WebGLRenderingContext, type: number, src: string) {
  const sh = gl.createShader(type)!;
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  return sh;
}

export function startAurora(canvas: HTMLCanvasElement): () => void {
  const gl = canvas.getContext('webgl', { antialias: true, alpha: false });
  if (!gl) return () => {};

  const prog = gl.createProgram()!;
  gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VERT));
  gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FRAG));
  gl.linkProgram(prog);
  gl.useProgram(prog);

  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, 'p');
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

  const uRes = gl.getUniformLocation(prog, 'u_res');
  const uTime = gl.getUniformLocation(prog, 'u_time');

  const dpr = Math.min(window.devicePixelRatio || 1, 1.75);
  function resize() {
    const w = Math.floor(canvas.clientWidth * dpr);
    const h = Math.floor(canvas.clientHeight * dpr);
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
      gl!.viewport(0, 0, w, h);
    }
  }

  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let raf = 0;
  const start = performance.now();

  function frame(now: number) {
    resize();
    gl!.uniform2f(uRes, canvas.width, canvas.height);
    gl!.uniform1f(uTime, reduced ? 8 : (now - start) / 1000);
    gl!.drawArrays(gl!.TRIANGLES, 0, 3);
    if (!reduced) raf = requestAnimationFrame(frame);
  }

  window.addEventListener('resize', resize);
  if (reduced) {
    frame(start); // un solo cuadro estático
  } else {
    raf = requestAnimationFrame(frame);
  }

  return () => {
    cancelAnimationFrame(raf);
    window.removeEventListener('resize', resize);
  };
}
