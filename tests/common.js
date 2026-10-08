/* shared by the tests: a context, a program, a way to wait for the GPU, and the report's shape (lines of "key: value") */
export const VERT = `#version 300 es
void main(){ vec2 p=vec2((gl_VertexID<<1)&2,gl_VertexID&2); gl_Position=vec4(p*2.0-1.0,0.0,1.0); }`;

export function context(w = 64, h = 64) {
  const canvas = document.createElement("canvas");
  canvas.width = w; canvas.height = h;
  const gl = canvas.getContext("webgl2", { antialias: false, alpha: false, depth: false, stencil: false, powerPreference: "high-performance" });
  if (gl) gl.getExtension("EXT_color_buffer_float");
  return { canvas, gl };
}
export const release = (gl) => { try { gl.getExtension("WEBGL_lose_context")?.loseContext(); } catch { /* fine */ } };

/* the GPU made to finish what it has: a one-pixel read */
export const sync = (gl) => gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));

/* a program, compiled and linked, timed to the moment its link status is known (which waits for the compile, in
   the background or on this thread alike); a salt in the source keeps the browser's shader cache out of it */
export function program(gl, fsrc, { salt = true } = {}) {
  const src = salt ? `${fsrc}\n// ${Math.random()}\n` : fsrc;
  const t0 = performance.now();
  const vs = gl.createShader(gl.VERTEX_SHADER); gl.shaderSource(vs, VERT); gl.compileShader(vs);
  const fs = gl.createShader(gl.FRAGMENT_SHADER); gl.shaderSource(fs, src); gl.compileShader(fs);
  const p = gl.createProgram(); gl.attachShader(p, vs); gl.attachShader(p, fs); gl.linkProgram(p);
  const ok = gl.getProgramParameter(p, gl.LINK_STATUS);
  const ms = performance.now() - t0;
  if (!ok) throw new Error((gl.getShaderInfoLog(fs) || gl.getProgramInfoLog(p) || "link failed").slice(0, 300));
  const u = {}; const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < n; i++) { const a = gl.getActiveUniform(p, i); u[a.name.replace(/\[0\]$/, "")] = gl.getUniformLocation(p, a.name); }
  return { p, u, ms, chars: src.length };
}

/* a render target of the given size */
export function target(gl, w, h) {
  const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  const f = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, f); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
  return { t, f, w, h };
}
/* a small texture of noise, for shaders that read maps */
export function noiseTexture(gl, w = 256, h = 128, seed = 1) {
  const d = new Uint8Array(w * h * 4); let s = seed;
  for (let i = 0; i < d.length; i++) { s = (s * 16807) % 2147483647; d[i] = s & 255; }
  const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, d); gl.generateMipmap(gl.TEXTURE_2D);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return t;
}
/* draw a full-screen triangle n times with the program, waiting for each; the mean of all but the first (ms) */
export function timeDraws(gl, prog, fbo, w, h, set, n = 4) {
  const vao = gl.createVertexArray(); gl.bindVertexArray(vao);
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo); gl.viewport(0, 0, w, h); gl.useProgram(prog.p);
  set(prog.u);
  const times = [];
  for (let i = 0; i < n; i++) { const t0 = performance.now(); gl.drawArrays(gl.TRIANGLES, 0, 3); sync(gl); times.push(performance.now() - t0); }
  const rest = times.slice(1);
  return { mean: rest.reduce((a, b) => a + b, 0) / rest.length, first: times[0], all: times.map((x) => +x.toFixed(1)) };
}

/* an Earth-like probe shader of about two thousand characters: a short march with noise and a few texture reads */
export const PROBE = `#version 300 es
precision highp float;
uniform vec2 uRes; uniform sampler2D uA, uB; uniform float uT; out vec4 o;
float hash13(vec3 p){p=fract(p*0.1031);p+=dot(p,p.zyx+31.32);return fract((p.x+p.y)*p.z);}
float vnoise(vec3 p){ vec3 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
  return mix(mix(mix(hash13(i),hash13(i+vec3(1,0,0)),f.x),mix(hash13(i+vec3(0,1,0)),hash13(i+vec3(1,1,0)),f.x),f.y),
             mix(mix(hash13(i+vec3(0,0,1)),hash13(i+vec3(1,0,1)),f.x),mix(hash13(i+vec3(0,1,1)),hash13(i+vec3(1,1,1)),f.x),f.y),f.z); }
float fbm(vec3 p){ float s=0.0,a=0.5; for(int i=0;i<4;i++){ s+=a*vnoise(p); p=p*2.03+vec3(1.7,9.2,3.1); a*=0.5; } return s; }
vec2 sph(vec3 ro,vec3 rd,float R){ float b=dot(ro,rd), c=dot(ro,ro)-R*R, d=b*b-c; if(d<0.0) return vec2(-1.0); d=sqrt(d); return vec2(-b-d,-b+d); }
void main(){
  vec2 uv=gl_FragCoord.xy/uRes;
  vec3 ro=vec3(0.0,0.0,-2.2), rd=normalize(vec3((uv-0.5)*vec2(uRes.x/uRes.y,1.0),1.2));
  vec2 t=sph(ro,rd,1.0), ta=sph(ro,rd,1.06);
  vec3 L=vec3(0.0), T=vec3(1.0);
  if(ta.y>0.0){ float t0=max(ta.x,0.0), t1=t.x>0.0?t.x:ta.y, ds=(t1-t0)/16.0;
    for(int i=0;i<16;i++){ vec3 x=ro+rd*(t0+ds*(float(i)+0.5)); float h=length(x)-1.0;
      float dr=exp(-h/0.02), dm=exp(-h/0.004); vec3 ext=vec3(5.8,13.5,33.1)*dr+vec3(21.0)*dm;
      float cl=texture(uA,x.xy*0.5+0.5+uT*0.01).r; float cd=smoothstep(0.4,0.8,cl+0.2*fbm(x*8.0))*step(h,0.02);
      vec3 ins=(vec3(5.8,13.5,33.1)*dr*0.06+vec3(21.0)*dm*0.02)*vec3(1.0,0.96,0.9)*20.0+cd*vec3(0.8);
      vec3 st=exp(-(ext+cd*30.0)*ds); L+=T*ins*(1.0-st)/max(ext+cd*30.0,vec3(1e-6)); T*=st; } }
  if(t.x>0.0){ vec3 P=ro+rd*t.x; vec2 g=vec2(atan(P.y,P.x)/6.2832+0.5,0.5-asin(clamp(P.z,-1.0,1.0))/3.14159);
    vec3 alb=pow(texture(uB,g).rgb,vec3(2.2)); float lit=max(dot(normalize(P),normalize(vec3(0.3,0.2,-1.0))),0.0);
    L+=T*(alb*lit*3.0+pow(texture(uA,g*4.0).rgb,vec3(2.2))*0.4); }
  o=vec4(1.0-exp(-L*0.35),1.0);
}`;

export const line = (k, v) => `${k}: ${v}`;
export const round = (x, d = 1) => (Number.isFinite(x) ? +x.toFixed(d) : x);
