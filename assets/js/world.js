/*
 * THE WORLD: the install's planet, drawn for real.
 *
 * A violet gas giant. Its cloud deck is not painted: it is a fluid
 * simulation (tools/gas-giant.py) — jets along irregular bands, rolling up
 * where they are strong, storms turning in the zones — written once as the
 * planet's map (assets/img/install/planet*.webp). Here it is flattened by its
 * spin, darkens towards the limb through a thin haze, and wears rings of
 * hundreds of ringlets that shade it and are shaded by it; a gold moon beyond,
 * and the galaxy behind, baked on the GPU. The frame is drawn in light (HDR),
 * bloomed, and tone-mapped like film.
 *
 * createWorld(canvas) → null when WebGL2 is not there; otherwise
 *   { bake(sync), baked, draw(view), resize(w, h, scale), lose() }
 */
import { chore, fetchOnce } from "./chores.js";

const VERT = `#version 300 es
in vec2 p; void main(){ gl_Position = vec4(p, 0.0, 1.0); }`;

/* simplex noise (Gustavson / McEwan), fbm, and a few helpers */
const NOISE = `
vec3 mod289(vec3 x){return x-floor(x*(1.0/289.0))*289.0;}
vec4 mod289(vec4 x){return x-floor(x*(1.0/289.0))*289.0;}
vec4 permute(vec4 x){return mod289(((x*34.0)+10.0)*x);}
vec4 taylorInvSqrt(vec4 r){return 1.79284291400159-0.85373472095314*r;}
float snoise(vec3 v){
  const vec2 C=vec2(1.0/6.0,1.0/3.0); const vec4 D=vec4(0.0,0.5,1.0,2.0);
  vec3 i=floor(v+dot(v,C.yyy)); vec3 x0=v-i+dot(i,C.xxx);
  vec3 g=step(x0.yzx,x0.xyz); vec3 l=1.0-g; vec3 i1=min(g.xyz,l.zxy); vec3 i2=max(g.xyz,l.zxy);
  vec3 x1=x0-i1+C.xxx; vec3 x2=x0-i2+C.yyy; vec3 x3=x0-D.yyy;
  i=mod289(i);
  vec4 p=permute(permute(permute(i.z+vec4(0.0,i1.z,i2.z,1.0))+i.y+vec4(0.0,i1.y,i2.y,1.0))+i.x+vec4(0.0,i1.x,i2.x,1.0));
  float n_=0.142857142857; vec3 ns=n_*D.wyz-D.xzx;
  vec4 j=p-49.0*floor(p*ns.z*ns.z);
  vec4 x_=floor(j*ns.z); vec4 y_=floor(j-7.0*x_);
  vec4 x=x_*ns.x+ns.yyyy; vec4 y=y_*ns.x+ns.yyyy; vec4 h=1.0-abs(x)-abs(y);
  vec4 b0=vec4(x.xy,y.xy); vec4 b1=vec4(x.zw,y.zw);
  vec4 s0=floor(b0)*2.0+1.0; vec4 s1=floor(b1)*2.0+1.0; vec4 sh=-step(h,vec4(0.0));
  vec4 a0=b0.xzyw+s0.xzyw*sh.xxyy; vec4 a1=b1.xzyw+s1.xzyw*sh.zzww;
  vec3 p0=vec3(a0.xy,h.x); vec3 p1=vec3(a0.zw,h.y); vec3 p2=vec3(a1.xy,h.z); vec3 p3=vec3(a1.zw,h.w);
  vec4 norm=taylorInvSqrt(vec4(dot(p0,p0),dot(p1,p1),dot(p2,p2),dot(p3,p3)));
  p0*=norm.x; p1*=norm.y; p2*=norm.z; p3*=norm.w;
  vec4 m=max(0.5-vec4(dot(x0,x0),dot(x1,x1),dot(x2,x2),dot(x3,x3)),0.0); m=m*m;
  return 105.0*dot(m*m,vec4(dot(p0,x0),dot(p1,x1),dot(p2,x2),dot(p3,x3)));
}
const mat3 ROT=mat3(0.00,0.80,0.60,-0.80,0.36,-0.48,-0.60,-0.48,0.64);
float fbm(vec3 p,int oct){float s=0.0,a=0.5;for(int i=0;i<12;i++){if(i>=oct)break;s+=a*snoise(p);p=ROT*p*2.02;a*=0.5;}return s;}
float ridged(vec3 p,int oct){float s=0.0,a=0.5,w=1.0;for(int i=0;i<12;i++){if(i>=oct)break;float n=1.0-abs(snoise(p));n*=n;n*=w;w=clamp(n*1.8,0.0,1.0);s+=a*n;p=ROT*p*2.03;a*=0.5;}return s;}
float hash13(vec3 p){p=fract(p*0.1031);p+=dot(p,p.zyx+31.32);return fract((p.x+p.y)*p.z);}
vec3 srgb(int r,int g,int b){return pow(vec3(r,g,b)/255.0,vec3(2.2));}
const float PI=3.14159265, TAU=6.28318531;
vec3 dirOf(vec2 uv){float lon=(uv.x-0.5)*TAU, lat=(uv.y-0.5)*PI; return vec3(cos(lat)*sin(lon),sin(lat),cos(lat)*cos(lon));}
`;

/* THE GALAXY, baked: the band, its dust, its nebulae; alpha is how dense the stars are */
const SKY = `#version 300 es
precision highp float;
uniform vec2 uSize;
out vec4 o;
${NOISE}
void main(){
  vec2 uv=gl_FragCoord.xy/uSize;
  vec3 d=dirOf(uv);
  vec3 gN=vec3(0.0,1.0,0.0), gC=vec3(0.0,0.0,1.0);
  vec3 w=vec3(fbm(d*2.5,5),fbm(d*2.5+5.0,5),fbm(d*2.5+9.0,5));
  float b=dot(d,gN)+0.05*fbm(d*3.0+w,6);
  float toCore=acos(clamp(dot(normalize(d-gN*dot(d,gN)),gC),-1.0,1.0));
  float thick=0.07+0.08*exp(-toCore*toCore/0.5);
  float band=exp(-b*b/(thick*thick));
  float bulge=exp(-(b*b)/0.02-toCore*toCore/0.18);
  float cloud=0.5+0.5*fbm(d*6.0+w*1.6,10);
  float grain=0.5+0.5*fbm(d*40.0,4);
  float lanes=smoothstep(0.3,0.85,ridged(d*5.0+w*2.0,10))*exp(-b*b/(thick*thick*0.35));
  float lanes2=smoothstep(0.45,0.9,ridged(d*13.0+w*3.0,8))*band;
  float dust=(1.0-0.92*lanes)*(1.0-0.5*lanes2);
  vec3 arm=vec3(0.66,0.68,0.92), core=vec3(1.0,0.78,0.56);
  vec3 c=band*(0.2+0.8*cloud)*(0.7+0.3*grain)*mix(arm,core,bulge*0.9+0.1)*dust*0.5;
  c+=bulge*core*0.45*dust;
  float hii=pow(max(fbm(d*9.0+w*3.0,8)+0.08,0.0),3.0)*band;
  c+=hii*vec3(1.0,0.26,0.5)*1.4*dust;
  float oiii=pow(max(fbm(d*4.0+11.0+w,7)+0.05,0.0),4.0)*(0.25+band);
  c+=oiii*vec3(0.2,0.62,0.8)*0.8*dust;
  float far=0.5+0.5*fbm(d*1.8+w,5);
  c+=vec3(0.02,0.014,0.04)*far;
  o=vec4(clamp(c*0.3,0.0,1.0),clamp(band*dust*1.2+bulge*0.8+0.2,0.0,1.0));
}`;

/* THE SHOT: everything a ray meets, lit, in light (tone-mapped later, unless DIRECT) */
const RENDER = `#version 300 es
precision highp float;
out vec4 o;
uniform vec2 uRes, uShift, uSunPx;
uniform float uFocal, uTime, uBg, uSunVis;
uniform vec3 uCam, uFwd, uRight, uUp, uSun;
uniform mat3 uSpin, uTilt, uSkyM;
uniform vec4 uMoon, uMoon2;
uniform sampler2D uAlb, uSky, uRing, uMoonT;
uniform float uHasMoon, uGalaxy, uGalK, uDust, uFocusD;
uniform int uDustN;
uniform float uPartK;   /* the scene's resolution over the canvas's: a point of light keeps its light however coarse the drawing */
uniform vec3 uVel;
uniform vec2 uAlbSize;
/* this world's own look: the map's colour turned (a hue matrix), whether it has rings, the haze's tint */
uniform mat3 uHue; uniform float uRingK; uniform vec3 uHazeT;
/* or a grade: the map's light and shade recoloured along three colours (dark, middle, light), uGradeK of it */
uniform vec3 uG0, uG1, uG2; uniform float uGradeK;
${NOISE}
const float FLAT=0.935;                 /* polar radius over equatorial: the spin's bulge */
const float RA=1.018, HR=0.0045;        /* a thin haze over the cloud tops */
const vec3 BR=vec3(5.0,7.5,16.0);
const vec3 SUNI=vec3(1.0,0.97,0.92)*7.0;
const float RIN=1.24, ROUT=2.34;

vec2 sph(vec3 ro,vec3 rd,float r){float b=dot(ro,rd),c=dot(ro,ro)-r*r,h=b*b-c;if(h<0.0)return vec2(-1.0);h=sqrt(h);return vec2(-b-h,-b+h);}
/* the planet, flattened: rays are squashed into the planet's frame, where it is round */
vec3 squash(vec3 v){ vec3 q=uTilt*v; q.y/=FLAT; return q; }
vec2 planetHit(vec3 ro,vec3 rd,float r){
  vec3 qo=squash(ro), qd=squash(rd); float k=length(qd);
  vec2 t=sph(qo,qd/k,r); return t.y<0.0?vec2(-1.0):t/k;
}
/* how much sun reaches a point past the planet: its shadow, soft for the deep atmosphere */
float lightThrough(vec3 x){
  vec3 q=squash(x), l=normalize(squash(uSun));
  float tb=dot(q,l), pd=length(q-l*tb);
  return tb>0.0?1.0:smoothstep(0.985,1.03,pd);
}
float ringAt(vec3 X,float lod){
  vec3 q=uTilt*X, lt=uTilt*uSun; if(abs(lt.y)<1e-4)return 0.0;
  float t=-q.y/lt.y; if(t<=0.0)return 0.0;
  float r=length((q+lt*t).xz); if(r<RIN||r>ROUT)return 0.0;
  return textureLod(uRing,vec2((r-RIN)/(ROUT-RIN),0.5),lod).a;
}

vec3 stars(vec3 d,float dens){
  vec3 c=vec3(0.0); float pxA=1.0/uFocal;
  for(int i=0;i<4;i++){
    float fi=float(i), sc=(i==0?18.0:i==1?60.0:i==2?190.0:520.0);
    vec3 g=d*sc, id=floor(g);
    float h1=hash13(id+fi*31.0), h2=hash13(id.yzx+fi*17.0+5.0), h3=hash13(id.zxy+fi*13.0+11.0), h4=hash13(id+vec3(7.0,3.0,1.0)+fi);
    vec3 sp=normalize((id+0.3+0.4*vec3(h1,h2,h4))/sc);
    float px=acos(clamp(dot(d,sp),-1.0,1.0))/pxA;
    float keep=step(1.0-(i==0?0.3:i==1?0.25+0.2*dens:i==2?0.12+0.45*dens:0.7*dens),h3);
    float m=(i==0?1.5+pow(h1,3.0)*14.0:i==1?0.4+pow(h2,3.0)*3.0:i==2?0.12+pow(h1,2.0)*0.8:0.05+0.12*h2)*keep;
    float tint=fract(h1*13.7+h2*7.1);
    vec3 col=tint<0.25?vec3(0.66,0.76,1.0):tint<0.6?vec3(1.0,0.97,0.94):tint<0.85?vec3(1.0,0.87,0.7):vec3(1.0,0.7,0.52);
    c+=col*m*exp(-px*px*1.8);
  }
  return c*uPartK*uPartK;
}
vec3 sky(vec3 rd){
  vec3 d=uSkyM*rd;
  vec2 uv=vec2(atan(d.x,d.z)/TAU+0.5,asin(clamp(d.y,-1.0,1.0))/PI+0.5);
  vec2 uv2=vec2(fract(uv.x+0.5),uv.y), dx=dFdx(uv), dy=dFdy(uv), dx2=dFdx(uv2), dy2=dFdy(uv2);
  if(abs(dx2.x)<abs(dx.x))dx.x=dx2.x; if(abs(dy2.x)<abs(dy.x))dy.x=dy2.x;
  vec4 s=textureGrad(uSky,uv,dx,dy);
  /* Gaia's Milky Way, its stars denser where the band is; or the drawn galaxy if it could not be had */
  float dens=uGalaxy>0.5?clamp(dot(s.rgb,vec3(0.3,0.5,0.2))*2.5+0.12,0.0,1.0):s.a;
  vec3 c=s.rgb*(uGalaxy>0.5?uGalK:0.5)+stars(d,dens)*0.09;
  float a=acos(clamp(dot(rd,uSun),-1.0,1.0));
  c+=vec3(1.0,0.97,0.9)*4000.0*smoothstep(0.0052,0.0046,a);
  return c;
}

vec4 ring(vec3 ro,vec3 rd,out float t){
  vec3 o3=uTilt*ro, d=uTilt*rd; t=-1.0;
  if(abs(d.y)<1e-6)return vec4(0.0);
  float tt=-o3.y/d.y; if(tt<=0.0)return vec4(0.0);
  vec3 x=o3+d*tt; float r=length(x.xz);
  /* how much of the ring plane one pixel covers here, so the rings' inner and outer edges are smoothed over it */
  float fw=tt/(uFocal*max(abs(d.y),0.03));
  if(r<RIN-fw||r>ROUT+fw)return vec4(0.0);
  float edge=smoothstep(RIN-fw,RIN+fw,r)*(1.0-smoothstep(ROUT-fw,ROUT+fw,r));
  t=tt;
  float u=(r-RIN)/(ROUT-RIN);
  vec4 rs=textureGrad(uRing,vec2(u,0.5),vec2(dFdx(u),0.0),vec2(dFdy(u),0.0));
  float ang=atan(x.z,x.x);
  /* a little clumping round the ring, as the particles' wakes give it */
  float clump=0.94+0.12*snoise(vec3(cos(ang)*r*30.0,sin(ang)*r*30.0,r*140.0));
  float tau=-log(max(1.0-rs.a,0.004))*clump;
  float mu=max(abs(d.y),0.01);
  float a=1.0-exp(-tau/mu);
  vec3 lt=uTilt*uSun; float mu0=max(abs(lt.y),0.01);
  vec3 X=transpose(uTilt)*x;
  float sh=lightThrough(X);
  float ph=dot(rd,uSun);
  vec3 c;
  /* the lit face: the photograph's colour; the dark face: light let through the thin rings, little through the thick */
  /* ring particles are rough ice: bright with the sun behind the eye, dimmer as they are lit from the side and
     behind; the thin rings' fine dust instead glows when the light comes through them */
  float pa=acos(clamp(-ph,-1.0,1.0));
  float back=0.12+0.88*exp(-(pa-0.87)*1.4);
  float fwd=pow(max(ph,0.0),24.0)*pow(1.0-rs.a,3.0)*0.8;
  if(sign(lt.y)==sign(o3.y)) c=rs.rgb*SUNI*0.07*(mu0/(mu0+mu))*min(back,1.6)+rs.rgb*SUNI*0.05*fwd;
  else { float g=0.6, hg=(1.0-g*g)/pow(1.0+g*g-2.0*g*ph,1.5); c=rs.rgb*SUNI*0.05*(1.0-exp(-tau/mu0))*exp(-tau*0.5/mu)*hg/max(a,0.02); }
  c*=sh;
  /* the planet's own light on the ring's dark side */
  c+=rs.rgb*vec3(0.05,0.035,0.07)*0.25;
  a*=edge;
  return vec4(c*a,a);
}

vec3 moon(vec3 P,vec4 M,vec3 rd){
  vec3 m=normalize(P-M.xyz);
  vec3 alb, nb=m;
  if(uHasMoon>0.5){
    /* the Moon's own surface, in gold: its colour, and its craters lit from its elevation */
    vec2 uv=vec2(atan(m.x,m.z)/TAU+0.5,asin(clamp(m.y,-1.0,1.0))/PI+0.5);
    vec2 uv2=vec2(fract(uv.x+0.5),uv.y), dx=dFdx(uv), dy=dFdy(uv), dx2=dFdx(uv2), dy2=dFdy(uv2);
    if(abs(dx2.x)<abs(dx.x))dx.x=dx2.x; if(abs(dy2.x)<abs(dy.x))dy.x=dy2.x;
    alb=textureGrad(uMoonT,uv,dx,dy).rgb;
    vec2 sz=vec2(textureSize(uMoonT,0));
    float coslat=max(sqrt(1.0-m.y*m.y),0.05);
    vec2 ex=vec2(max(1.0/sz.x,abs(dx.x)+abs(dy.x)),0.0), ey=vec2(0.0,max(1.0/sz.y,abs(dx.y)+abs(dy.y)));
    float hE=(textureGrad(uMoonT,uv+ex,dx,dy).a-textureGrad(uMoonT,uv-ex,dx,dy).a)/(2.0*ex.x*TAU*coslat);
    float hN=(textureGrad(uMoonT,uv+ey,dx,dy).a-textureGrad(uMoonT,uv-ey,dx,dy).a)/(2.0*ey.y*PI);
    vec3 E=normalize(vec3(m.z,0.0,-m.x)+1e-5), Nn=cross(m,E);
    nb=normalize(m-(E*hE+Nn*hN)*0.03);
  } else {
    float cr=0.0, s=1.0;
    for(int i=0;i<4;i++){float n=snoise(m*(4.0*s)+float(i)*7.3); cr+=smoothstep(0.6,0.88,1.0-abs(n))*0.5/s; s*=2.2;}
    float n=fbm(m*5.0,6);
    alb=mix(srgb(98,82,58),srgb(184,156,108),0.5+0.5*n)*(1.0-0.3*cr);
    nb=normalize(m+0.12*vec3(snoise(m*16.0),snoise(m*16.0+3.0),snoise(m*16.0+6.0)));
  }
  /* regolith: between Lambert and Lommel-Seeliger, so the disc is flatter-lit than a ball, as the Moon is */
  float ndl=max(dot(nb,uSun),0.0), ndv=max(dot(nb,-rd),0.02);
  float f=mix(ndl,2.0*ndl/(ndl+ndv),0.55);
  vec3 c=alb*SUNI*f*lightThrough(P)/PI;
  c+=alb*vec3(0.06,0.04,0.1)*max(dot(m,normalize(-M.xyz)),0.0)*0.4;
  return c;
}

vec3 cloudDeck(vec3 P,vec3 rd){
  /* in the planet's frame: the squashed point, the true normal, and where it is on the map */
  vec3 q=squash(P);
  vec3 n=normalize(transpose(uTilt)*vec3(q.x,q.y/FLAT,q.z));
  vec3 pp=uSpin*transpose(uTilt)*normalize(q);
  vec2 uv=vec2(atan(pp.x,pp.z)/TAU+0.5,asin(clamp(pp.y,-1.0,1.0))/PI+0.5);
  vec2 uv2=vec2(fract(uv.x+0.5),uv.y), dx=dFdx(uv), dy=dFdy(uv), dx2=dFdx(uv2), dy2=dFdy(uv2);
  if(abs(dx2.x)<abs(dx.x))dx.x=dx2.x; if(abs(dy2.x)<abs(dy.x))dy.x=dy2.x;
  vec4 a=textureGrad(uAlb,uv,dx*0.7,dy*0.7);
  vec3 alb=clamp(uHue*a.rgb,0.0,1.0);
  if(uGradeK>0.0){ float gl=pow(clamp(dot(a.rgb,vec3(0.2126,0.7152,0.0722))*1.6,0.0,1.0),0.9); vec3 gr=gl<0.5?mix(uG0,uG1,gl*2.0):mix(uG1,uG2,gl*2.0-1.0); alb=mix(alb,gr,uGradeK); }
  /* finer than the map: streaks drawn out along the bands, fading where they would shimmer */
  float px=length(dx)*uAlbSize.x;
  float near=1.0-smoothstep(0.6,2.5,px);
  if(near>0.0){
    vec3 sp=pp*vec3(1.0,3.2,1.0);
    float d=snoise(sp*900.0)*0.6+snoise(sp*2300.0+7.0)*0.4;
    alb*=1.0+0.035*d*near;
  }
  /* the deck's relief: bright cloud stands a little higher */
  float coslat=max(sqrt(1.0-pp.y*pp.y),0.05);
  vec2 ex=vec2(max(1.0/uAlbSize.x,abs(dx.x)+abs(dy.x)),0.0), ey=vec2(0.0,max(1.0/uAlbSize.y,abs(dx.y)+abs(dy.y)));
  const vec3 LW=vec3(0.2126,0.7152,0.0722);
  float hE=(dot(textureGrad(uAlb,uv+ex,dx,dy).rgb,LW)-dot(textureGrad(uAlb,uv-ex,dx,dy).rgb,LW))/(2.0*ex.x*TAU*coslat);
  float hN=(dot(textureGrad(uAlb,uv+ey,dx,dy).rgb,LW)-dot(textureGrad(uAlb,uv-ey,dx,dy).rgb,LW))/(2.0*ey.y*PI);
  vec3 E=normalize(vec3(pp.z,0.0,-pp.x)+1e-5), Nn=cross(pp,E);
  vec3 bump=transpose(uSpin)*(E*hE+Nn*hN);
  vec3 nb=normalize(n-bump*0.0012);
  float mu=dot(n,uSun), ndv=max(dot(n,-rd),0.0);
  /* light through a deep atmosphere: a soft terminator, warming as it goes, darkening to the limb */
  float wrap=clamp((dot(nb,uSun)+0.025)/1.025,0.0,1.0);
  float lit=pow(wrap,1.1)*pow(max(ndv,0.02),0.12);
  vec3 tint=mix(vec3(1.0,0.62,0.42),vec3(1.0),smoothstep(-0.05,0.35,mu));
  float rsh=1.0-0.75*ringAt(P,6.0)*uRingK;
  vec3 c=alb*SUNI*tint*lit*rsh/PI*1.3;
  /* the rings' light on the night side */
  c+=alb*vec3(0.05,0.04,0.07)*0.08*(1.0-smoothstep(-0.1,0.2,mu));
  return c;
}

/* THE DUST: ice and dust drifting near the planet, thickest by the rings. Walked cell by cell along the
   ray; each mote is a point of sunlight, soft and large when near the lens (out of focus), streaked by
   the camera's own motion during the exposure */
vec3 dust(vec3 ro,vec3 rd,float tMax){
  if(uDust<=0.0)return vec3(0.0);
  const float CS=0.07;
  vec3 p=ro/CS, cell=floor(p), st=sign(rd), tD=abs(1.0/rd);
  vec3 tN=(cell+max(st,0.0)-p)/rd;
  vec3 acc=vec3(0.0);
  float ph=dot(rd,uSun), g=0.65, hg=(1.0-g*g)/pow(1.0+g*g-2.0*g*ph,1.5);
  for(int i=0;i<30;i++){
    if(i>=uDustN)break;
    float t0=min(tN.x,min(tN.y,tN.z))*CS;
    float h=hash13(cell);
    if(h<0.06){
      vec3 o=vec3(hash13(cell+7.1),hash13(cell+3.3),hash13(cell+9.9));
      vec3 pp=(cell+0.2+0.6*o)*CS+(o-0.5)*uTime*0.0025;
      float r=length(pp), y=abs((uTilt*pp).y);
      float w=smoothstep(14.0,7.0,r)*(0.35+0.65*exp(-y/0.7))*step(1.02,r);
      if(w>0.0){
        /* the mote's path across the lens during the exposure: the ray's closest approach to it */
        vec3 a=pp, b=pp-uVel;
        vec3 ab=b-a; float L2=max(dot(ab,ab),1e-9);
        vec3 ao=ro-a; float bd=dot(ab,rd), c1=dot(ao,rd), c2=dot(ab,ao);
        float den=L2-bd*bd;
        float sseg=clamp((c2-bd*c1)/max(den,1e-9),0.0,1.0);
        vec3 qq=a+ab*sseg; float z=dot(qq-ro,rd);
        if(z>0.015&&z<tMax){
          float dpx=length(qq-ro-rd*z)/z*uFocal;
          float coc=clamp(18.0*abs(1.0/z-1.0/uFocusD)/(1.0/0.12),0.8,0.42*CS/z*uFocal);
          float streak=max(1.0,length(uVel)/z*uFocal);
          /* a near mote gathers more light into the lens, spread over its blur */
          float e=exp(-dpx*dpx/(coc*coc))/(coc*coc+streak*0.6)*min(0.25/(z*z),60.0);
          float lit=smoothstep(0.985,1.03,length(qq-uSun*min(dot(qq,uSun),0.0)));
          acc+=e*w*lit*(0.6+0.4*hash13(cell+5.0));
        }
      }
    }
    if(t0>tMax)break;
    if(tN.x<tN.y){ if(tN.x<tN.z){cell.x+=st.x;tN.x+=tD.x;}else{cell.z+=st.z;tN.z+=tD.z;} }
    else{ if(tN.y<tN.z){cell.y+=st.y;tN.y+=tD.y;}else{cell.z+=st.z;tN.z+=tD.z;} }
  }
  return acc*SUNI*vec3(1.0,0.95,0.9)*(0.35+hg*0.25)*0.35*uDust*uPartK*uPartK;
}

void main(){
  vec2 q=(gl_FragCoord.xy-0.5*uRes-uShift)/uFocal;
  vec3 ro=uCam, rd=normalize(uFwd+uRight*q.x+uUp*q.y);
  vec3 col=uBg>0.001?sky(rd)*uBg:vec3(0.0); float alpha=uBg;
  vec2 tp=planetHit(ro,rd,1.0), ta=planetHit(ro,rd,RA);
  vec2 tm=sph(ro-uMoon.xyz,rd,uMoon.w), tm2=sph(ro-uMoon2.xyz,rd,uMoon2.w);
  float tOp=1e9; int hit=0;
  if(tp.x>0.0){tOp=tp.x; hit=1;}
  if(tm.x>0.0&&tm.x<tOp){tOp=tm.x; hit=2;}
  if(uMoon2.w>0.0&&tm2.x>0.0&&tm2.x<tOp){tOp=tm2.x; hit=3;}
  float tr; vec4 rc=ring(ro,rd,tr); if(uRingK<0.5) tr=-1.0;
  bool ringOn=tr>0.0&&tr<tOp;
  if(tOp<1e8){ vec3 P=ro+rd*tOp; col=hit==1?cloudDeck(P,rd):moon(P,hit==2?uMoon:uMoon2,rd); alpha=1.0; }
  /* the moons' limbs, smoothed: a pixel their edge passes through is shaded by how much of it the moon covers (the
     ray's nearest miss of it, against a pixel's width out there), so the edge does not crawl as the camera drifts */
  for(int k=0;k<2;k++){
    vec4 M=k==0?uMoon:uMoon2; if(M.w<=0.0)continue;
    vec3 oc=M.xyz-ro; float b=dot(oc,rd); if(b<=0.0)continue;
    vec3 nr=oc-rd*b; float d=length(nr);
    float cov=clamp((M.w-d)*uFocal/b+0.5,0.0,1.0);
    if(cov<=0.0||cov>=1.0)continue;
    if(hit==k+2){
      /* on the moon: what is behind its edge shows through the part of the pixel it leaves */
      vec3 back=tp.x>0.0?cloudDeck(ro+rd*tp.x,rd):(uBg>0.001?sky(rd)*uBg:vec3(0.0));
      col=mix(back,col,cov); alpha=mix(tp.x>0.0?1.0:uBg,1.0,cov);
    } else if(b-M.w<tOp){
      /* just off it: the limb covers a little of the pixel */
      col=mix(col,moon(M.xyz-normalize(nr)*M.w,M,rd),cov); alpha=mix(alpha,1.0,cov);
    }
  }
  if(ringOn&&ta.x>0.0&&tr>ta.y){col=col*(1.0-rc.a)+rc.rgb; alpha=alpha+(1.0-alpha)*rc.a;}
  /* the haze over the cloud tops: violet at the limb, lit where the sun is */
  if(ta.y>0.0&&max(ta.x,0.0)<tOp){
    float t0=max(ta.x,0.0), t1=min(ta.y,tOp); const int N=8; float ds=(t1-t0)/float(N);
    vec3 s=vec3(0.0); float od=0.0;
    vec3 ls=normalize(squash(uSun));
    float rsh=1.0-0.6*ringAt(ro+rd*(0.5*(t0+t1)),7.0)*uRingK;
    for(int i=0;i<N;i++){ vec3 x=ro+rd*(t0+ds*(float(i)+0.5)); vec3 qx=squash(x); float h=max(length(qx)-1.0,0.0);
      /* the haze is lit by how high the sun stands over it: it fades through dusk, no hard edge */
      float up=dot(normalize(qx),ls); float lit=smoothstep(-0.07,0.2,up);
      float dR=exp(-h/HR)*ds; od+=dR; s+=dR*lit*exp(-BR*od); }
    s*=rsh;
    float mu=dot(rd,uSun), g=0.7, hg=(1.0-g*g)/pow(1.0+g*g-2.0*g*mu,1.5)*0.08;
    col=col*exp(-BR*od*0.25)+SUNI*s*BR*(0.0597*(1.0+mu*mu)+hg*0.5)*uHazeT*0.6;
  }
  if(ringOn&&(ta.x<=0.0||tr<ta.x)){col=col*(1.0-rc.a)+rc.rgb; alpha=alpha+(1.0-alpha)*rc.a;}
  col+=dust(ro,rd,min(tOp,tr>0.0?tr:1e9));
  /* the light in the lens: a soft halo round the sun, and a thin streak */
  if(uSunVis>0.001){
    float sa=acos(clamp(dot(rd,uSun),-1.0,1.0));
    vec3 glare=vec3(1.0,0.86,0.68)*(1.2*exp(-sa/0.01)+0.12*exp(-sa/0.06)+0.025*exp(-sa/0.3));
    vec2 dp=gl_FragCoord.xy-uSunPx;
    glare+=vec3(0.72,0.62,1.0)*0.2*exp(-abs(dp.y)/(uRes.y*0.003))*exp(-abs(dp.x)/(uRes.x*0.3));
    col+=glare*uSunVis;
  }
#ifdef DIRECT
  col=clamp(col*(2.51*col+0.03)/(col*(2.43*col+0.59)+0.14),0.0,1.0);
  col=pow(col,vec3(1.0/2.2))+(hash13(vec3(gl_FragCoord.xy,uTime))-0.5)/255.0;
#endif
  o=vec4(max(col,0.0),alpha);
}`;

/* BLOOM: down a chain of halves (13 taps; the first keeps only the bright), and back up (a tent) */
const DOWN = `#version 300 es
precision highp float;
uniform sampler2D uSrc; uniform vec2 uTexel, uOut, uPart; uniform float uFirst;
out vec4 o;
vec3 s(vec2 uv){ vec3 c=texture(uSrc,min(uv*uPart,uPart-uTexel*0.5)).rgb; if(uFirst>0.5){ float l=max(c.r,max(c.g,c.b)); c*=max(l-1.3,0.0)/max(l,1e-4); } return c; }
void main(){
  vec2 uv=gl_FragCoord.xy/uOut, t=uTexel;
  vec3 a=s(uv+t*vec2(-2,2)),b=s(uv+t*vec2(0,2)),c=s(uv+t*vec2(2,2)),d=s(uv+t*vec2(-2,0)),e=s(uv),f=s(uv+t*vec2(2,0)),g=s(uv+t*vec2(-2,-2)),h=s(uv+t*vec2(0,-2)),i=s(uv+t*vec2(2,-2)),j=s(uv+t*vec2(-1,1)),k=s(uv+t*vec2(1,1)),l=s(uv+t*vec2(-1,-1)),m=s(uv+t*vec2(1,-1));
  o=vec4(e*0.125+(a+c+g+i)*0.03125+(b+d+f+h)*0.0625+(j+k+l+m)*0.125,1.0);
}`;
const UP = `#version 300 es
precision highp float;
uniform sampler2D uSrc; uniform vec2 uTexel, uOut;
out vec4 o;
void main(){
  vec2 uv=gl_FragCoord.xy/uOut, t=uTexel;
  vec3 r=texture(uSrc,uv).rgb*4.0;
  r+=(texture(uSrc,uv+vec2(-t.x,0)).rgb+texture(uSrc,uv+vec2(t.x,0)).rgb+texture(uSrc,uv+vec2(0,-t.y)).rgb+texture(uSrc,uv+vec2(0,t.y)).rgb)*2.0;
  r+=texture(uSrc,uv-t).rgb+texture(uSrc,uv+t).rgb+texture(uSrc,uv+vec2(t.x,-t.y)).rgb+texture(uSrc,uv+vec2(-t.x,t.y)).rgb;
  o=vec4(r/16.0,1.0);
}`;
/* THE FILM: the light and its bloom, tone-mapped (AgX), a breath of vignette and grain */
const FILM = `#version 300 es
precision highp float;
uniform sampler2D uHdr, uBloom; uniform vec2 uRes, uBlurC, uPart, uTexel; uniform float uTime, uExpo, uBloomK, uBlur, uFringe, uGrain;
out vec4 o;
/* the scene is drawn into the corner of its target it is given (uPart of it): read in that, clamped inside it */
vec4 H(vec2 uv){ return texture(uHdr,min(clamp(uv,vec2(0.0),vec2(1.0))*uPart,uPart-uTexel*0.5)); }
/* … and, where the scene was drawn smaller than the canvas, read with a sharp bicubic (Catmull-Rom, nine taps) so
   the edges of the rings and the planet's detail stay crisp as it is brought up */
vec3 HC(vec2 uv){
  if(uPart.x>0.999) return H(uv).rgb;
  vec2 size=1.0/uTexel, lim=uPart-uTexel*0.5;
  vec2 sp=clamp(uv,vec2(0.0),vec2(1.0))*uPart*size, tc=floor(sp-0.5)+0.5, f=sp-tc;
  vec2 w0=f*(-0.5+f*(1.0-0.5*f)), w1=1.0+f*f*(-2.5+1.5*f), w2=f*(0.5+f*(2.0-1.5*f)), w3=f*f*(-0.5+0.5*f);
  vec2 w12=w1+w2, t0=min((tc-1.0)*uTexel,lim), t3=min((tc+2.0)*uTexel,lim), t12=min((tc+w2/w12)*uTexel,lim);
  t0=max(t0,uTexel*0.5);
  vec3 c=(texture(uHdr,vec2(t0.x,t0.y)).rgb*w0.x+texture(uHdr,vec2(t12.x,t0.y)).rgb*w12.x+texture(uHdr,vec2(t3.x,t0.y)).rgb*w3.x)*w0.y
        +(texture(uHdr,vec2(t0.x,t12.y)).rgb*w0.x+texture(uHdr,vec2(t12.x,t12.y)).rgb*w12.x+texture(uHdr,vec2(t3.x,t12.y)).rgb*w3.x)*w12.y
        +(texture(uHdr,vec2(t0.x,t3.y)).rgb*w0.x+texture(uHdr,vec2(t12.x,t3.y)).rgb*w12.x+texture(uHdr,vec2(t3.x,t3.y)).rgb*w3.x)*w3.y;
  return max(c,vec3(0.0));
}
float hash13(vec3 p){p=fract(p*0.1031);p+=dot(p,p.zyx+31.32);return fract((p.x+p.y)*p.z);}
vec3 agxCurve(vec3 x){vec3 x2=x*x, x4=x2*x2; return 15.5*x4*x2-40.14*x4*x+31.96*x4-6.868*x2*x+0.4298*x2+0.1191*x-0.00232;}
vec3 agx(vec3 c){
  const mat3 I=mat3(0.856627153315983,0.137318972929847,0.11189821299995,0.0951212405381588,0.761241990602591,0.0767994186031903,0.0482516061458583,0.101439036467562,0.811302368396859);
  const mat3 O=mat3(1.1271005818144368,-0.1413297634984383,-0.14132976349843826,-0.11060664309660323,1.157823702216272,-0.11060664309660294,-0.016493938717834573,-0.016493938717834257,1.2519364065950405);
  c=I*c; c=clamp((log2(max(c,1e-10))+12.47393)/16.5,0.0,1.0); c=agxCurve(c); c=O*c;
  return clamp(pow(max(c,0.0),vec3(2.2)),0.0,1.0);
}
/* the lens's own colour fringing, stronger out to the edges; and the dolly's blur, out from where the camera is going */
vec3 lens(vec2 uv){
  vec2 r=uv-0.5; float f=uFringe*dot(r,r);
  vec3 c=vec3(HC(uv+r*f).r,HC(uv).g,HC(uv-r*f).b);
  if(uBlur>0.5){
    vec2 dir=(uv-uBlurC/uRes); vec2 stp=dir*(uBlur/max(length(dir*uRes),1.0))/7.0;
    vec3 acc=c; for(int i=1;i<8;i++){ vec2 u2=uv-stp*float(i); acc+=vec3(H(u2+r*f).r,H(u2).g,H(u2-r*f).b); }
    c=acc/8.0;
  }
  return c;
}
void main(){
  vec2 uv=gl_FragCoord.xy/uRes;
  vec4 h=vec4(HC(uv),H(uv).a);
  h.rgb=lens(uv);
  /* sharpening, contrast-adaptive: lifts fine detail, never past its neighbours, so no halos */
  vec2 px=uTexel/uPart;
  vec3 n=H(uv+vec2(0,px.y)).rgb, sd=H(uv-vec2(0,px.y)).rgb, e=H(uv+vec2(px.x,0)).rgb, w=H(uv-vec2(px.x,0)).rgb;
  vec3 mn=min(min(min(n,sd),min(e,w)),h.rgb), mx=max(max(max(n,sd),max(e,w)),h.rgb);
  vec3 amp=sqrt(clamp(min(mn,2.0-mx)/max(mx,1e-4),0.0,1.0));
  vec3 k=-amp*0.13*smoothstep(0.55,0.95,uPart.x);
  vec3 sharp=clamp((h.rgb+(n+sd+e+w)*k)/(1.0+4.0*k),mn,mx);
  vec3 c=(sharp+texture(uBloom,uv).rgb*uBloomK)*uExpo;
  vec2 v=uv-0.5; c*=1.0-0.45*dot(v,v);
  c=agx(c);
  /* a touch more colour than AgX's neutral: slide film rather than negative */
  float l=dot(c,vec3(0.2126,0.7152,0.0722)); c=max(mix(vec3(l),c,1.2),0.0);
  c=pow(c,vec3(1.0/2.2));
  /* grain, as film has it: most in the mid-tones, little in the blacks and the highlights */
  float lum=dot(c,vec3(0.2126,0.7152,0.0722));
  float gr=(hash13(vec3(gl_FragCoord.xy,floor(uTime*24.0)))+hash13(vec3(gl_FragCoord.yx*1.7,floor(uTime*24.0)+3.0))-1.0);
  c+=gr*uGrain*(0.25+3.0*lum*(1.0-lum));
  c+=(hash13(vec3(gl_FragCoord.xy,uTime*60.0))-0.5)*(1.5/255.0);
  float a=max(h.a,clamp(max(c.r,max(c.g,c.b)),0.0,1.0)*(1.0-h.a));
  o=vec4(c,a);
}`;

function ringProfile(n) {
  /* the rings, from the inside out: a faint inner ring of plateaus, a broad
     bright one, a dark division, an outer ring with two gaps of its own,
     and a thread beyond — with ringlets at every scale all through */
  const px = new Uint8Array(n * 4);
  let s = 90210;
  const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
  const RIN = 1.24, ROUT = 2.34;
  const sm = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  const lin = (c) => Math.round(255 * Math.pow(Math.max(0, Math.min(1, c)), 1 / 2.2));
  /* a random walk at three scales: the ringlets */
  const walk = (steps, amp) => { const a = []; let v = 0; for (let i = 0; i <= steps; i++) { v = v * 0.7 + (rnd() - 0.5) * amp; a.push(v); } return (x) => { const f = x * steps, i = Math.min(steps - 1, Math.floor(f)), t = f - i; return a[i] + (a[i + 1] - a[i]) * t; }; };
  const w1 = walk(90, 0.5), w2 = walk(700, 0.6), w3 = walk(3200, 0.5);
  /* the plateaus of the inner ring: sharp-edged bright strips */
  const plateaus = Array.from({ length: 9 }, () => [1.26 + rnd() * 0.25, 0.002 + rnd() * 0.008]);
  for (let i = 0; i < n; i++) {
    const x = (i + 0.5) / n, r = RIN + x * (ROUT - RIN);
    let d = 0, col = [0.6, 0.55, 0.5];
    if (r < 1.53) { d = 0.07 + 0.08 * sm(1.4, 1.53, r); for (const [c, w] of plateaus) if (Math.abs(r - c) < w) d = 0.32; col = [0.5, 0.45, 0.46]; d *= sm(1.24, 1.27, r); }
    else if (r < 1.95) { d = 0.55 + 0.4 * sm(1.53, 1.65, r) - 0.12 * sm(1.88, 1.95, r); col = [0.94, 0.84, 0.68]; }
    else if (r < 2.03) { d = 0.025 + 0.03 * Math.abs(Math.sin(r * 900)); col = [0.5, 0.44, 0.42]; }
    else if (r < 2.27) { d = 0.42 - 0.12 * sm(2.06, 2.27, r); col = [0.84, 0.76, 0.66]; if (Math.abs(r - 2.214) < 0.0075) d = 0.015; if (Math.abs(r - 2.265) < 0.0018) d = 0.02; }
    else if (Math.abs(r - 2.326) < 0.0025) { d = 0.5; col = [0.92, 0.86, 0.78]; }
    const m = 1 + w1(x) * 0.9 + w2(x) * 0.8 + w3(x) * 0.7;
    d = Math.max(0, Math.min(1, d * m));
    const tint = 1 + w1(x) * 0.35 + w2(x) * 0.15;
    px[i * 4] = lin(col[0] * tint); px[i * 4 + 1] = lin(col[1] * tint); px[i * 4 + 2] = lin(col[2] * (2 - tint));
    px[i * 4 + 3] = Math.round(d * 255);
  }
  return px;
}

/* a world's pictures: the planet's map, its rings, the moon, the galaxy (smaller on a small screen) */
function picturesOf(opts) {
  const small = opts.small ?? (matchMedia("(pointer: coarse)").matches || Math.min(screen.width, screen.height) < 800);
  return {
    small,
    MAP: opts.map ?? new URL(small ? "../img/install/planet-2k.webp" : "../img/install/planet.webp", import.meta.url).href,
    RINGS: opts.rings ?? new URL("../img/install/rings.png", import.meta.url).href,
    MOON: opts.moon ?? new URL("../img/install/moon.webp", import.meta.url).href,
    GALAXY: opts.galaxy ?? new URL(small ? "../img/install/galaxy-2k.webp" : "../img/install/galaxy.webp", import.meta.url).href,
  };
}
/** start a world's pictures down the wire, before the world itself is made (that is a chore; the network is not) */
export function fetchWorld(opts = {}) {
  const p = picturesOf(opts);
  for (const url of [p.MAP, p.RINGS, p.MOON, p.GALAXY]) fetchOnce(url).catch(() => {});
}

export function createWorld(canvas, opts = {}) {
  const gl = canvas.getContext("webgl2", { alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false, powerPreference: "high-performance" });
  if (!gl) return null;
  const floatOK = !!gl.getExtension("EXT_color_buffer_float");
  const aniso = gl.getExtension("EXT_texture_filter_anisotropic");
  const { small, MAP, RINGS, MOON, GALAXY } = picturesOf(opts);
  const KW = opts.sky ?? (small ? 2048 : 4096), KH = KW / 2;
  /* this world's look: the map's hue turned by opts.hue degrees (about the grey axis, in linear light), a little
     richer by opts.sat; rings unless opts.ringsOn is false; the haze tinted opts.haze */
  const HUE = (() => {
    const a = ((opts.hue || 0) * Math.PI) / 180, c = Math.cos(a), sn = Math.sin(a), k = 1 / 3, q = Math.sqrt(k);
    const m = [c + (1 - c) * k, (1 - c) * k - q * sn, (1 - c) * k + q * sn, (1 - c) * k + q * sn, c + (1 - c) * k, (1 - c) * k - q * sn, (1 - c) * k - q * sn, (1 - c) * k + q * sn, c + (1 - c) * k];
    const sat = opts.sat ?? 1, L = [0.2126, 0.7152, 0.0722];
    const S = [0, 1, 2].flatMap((r) => [0, 1, 2].map((cc) => L[cc] * (1 - sat) + (r === cc ? sat : 0)));
    const o = []; for (let r = 0; r < 3; r++) for (let cc = 0; cc < 3; cc++) o.push(S[r * 3] * m[cc] + S[r * 3 + 1] * m[3 + cc] + S[r * 3 + 2] * m[6 + cc]);
    return new Float32Array([o[0], o[3], o[6], o[1], o[4], o[7], o[2], o[5], o[8]]);   /* column-major */
  })();
  const RING_K = opts.ringsOn === false ? 0 : 1, HAZE = opts.haze || [0.85, 0.82, 1.0];
  const GRADE = opts.grade || null;   /* [[dark], [middle], [light], how much] in linear light */

  /* the shaders are made in the background where the browser can (KHR_parallel_shader_compile), and looked at only
     once they are done (made), so making them never holds the door up; bake() waits for them */
  const par = gl.getExtension("KHR_parallel_shader_compile");
  const compile = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); return s; };
  const vs = compile(gl.VERTEX_SHADER, VERT);
  const program = (src) => {
    const p = gl.createProgram(), fs = compile(gl.FRAGMENT_SHADER, src); gl.attachShader(p, vs); gl.attachShader(p, fs);
    gl.bindAttribLocation(p, 0, "p"); gl.linkProgram(p);
    return { p, fs, u: {} };
  };
  /* in light where the GPU can draw in floats; straight to the screen where it cannot */
  const hdr = floatOK;
  const P = {
    sky: program(SKY),
    render: program(hdr ? RENDER : RENDER.replace("precision highp float;", "precision highp float;\n#define DIRECT")),
    down: hdr ? program(DOWN) : null, up: hdr ? program(UP) : null, film: hdr ? program(FILM) : null,
  };
  const made = new Promise((resolve) => {
    const all = Object.values(P).filter(Boolean);
    const done = () => {
      try {
        for (const pr of all) {
          if (!gl.getProgramParameter(pr.p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(pr.p) || gl.getShaderInfoLog(pr.fs) || gl.getShaderInfoLog(vs));
          const n = gl.getProgramParameter(pr.p, gl.ACTIVE_UNIFORMS);
          for (let i = 0; i < n; i++) { const a = gl.getActiveUniform(pr.p, i); pr.u[a.name] = gl.getUniformLocation(pr.p, a.name); }
        }
        resolve(true);
      } catch (e) { console.warn("orbit: the world could not be drawn", e); resolve(false); }
    };
    if (!par) { done(); return; }
    const poll = () => (all.every((pr) => gl.getProgramParameter(pr.p, par.COMPLETION_STATUS_KHR)) ? done() : setTimeout(poll, 40));
    poll();
  });
  /* each picture is put on the GPU as a chore of its own (chores.js), one after another, never while the door comes up */
  const inTurn = (fn) => chore(fn, 60, opts.tag);

  const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const vao = gl.createVertexArray(); gl.bindVertexArray(vao);
  gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

  const tex = (w, h, internal, format, type, data = null, wrapS = gl.REPEAT) => {
    const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, internal, w, h, 0, format, type, data);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrapS);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    return t;
  };
  const mip = (t) => {
    gl.bindTexture(gl.TEXTURE_2D, t); gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    if (aniso) gl.texParameterf(gl.TEXTURE_2D, aniso.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(8, gl.getParameter(aniso.MAX_TEXTURE_MAX_ANISOTROPY_EXT)));
  };
  const fb = (t) => { const f = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, f); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0); return f; };

  /* the textures: the planet's map (loaded), the galaxy (baked), the rings (loaded; drawn until they come) */
  let albT = null, SW = 1, SH = 1;
  const skyT = tex(KW, KH, gl.SRGB8_ALPHA8, gl.RGBA, gl.UNSIGNED_BYTE), skyF = fb(skyT);
  const RN = 8192;
  const ringT = tex(RN, 1, gl.SRGB8_ALPHA8, gl.RGBA, gl.UNSIGNED_BYTE, ringProfile(RN), gl.CLAMP_TO_EDGE);
  mip(ringT);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);

  const pass = (prog, fbo, w, h, setup, scissor = null) => {
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo); gl.viewport(0, 0, w, h);
    if (scissor) { gl.enable(gl.SCISSOR_TEST); gl.scissor(...scissor); } else gl.disable(gl.SCISSOR_TEST);
    gl.useProgram(prog.p); gl.bindVertexArray(vao);
    setup?.(prog.u);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.disable(gl.SCISSOR_TEST);
  };
  const bind = (unit, t, loc) => { gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, t); gl.uniform1i(loc, unit); };

  /* the map arrives over the network; the galaxy is baked a strip a frame, so the door keeps its frames */
  const loadMap = fetchOnce(MAP)
    .then((b) => createImageBitmap(b, { colorSpaceConversion: "none", premultiplyAlpha: "none" }))
    .then((img) => inTurn(() => {
      albT = tex(img.width, img.height, gl.SRGB8_ALPHA8, gl.RGBA, gl.UNSIGNED_BYTE, img); mip(albT);
      SW = img.width; SH = img.height; img.close?.();
    }));
  const maxTex = gl.getParameter(gl.MAX_TEXTURE_SIZE);
  const loadRings = fetchOnce(RINGS)
    .then((b) => createImageBitmap(b, { colorSpaceConversion: "none", premultiplyAlpha: "none", ...(maxTex < 8192 ? { resizeWidth: maxTex, resizeHeight: 1, resizeQuality: "high" } : {}) }))
    .then((img) => inTurn(() => {
      gl.bindTexture(gl.TEXTURE_2D, ringT); gl.texImage2D(gl.TEXTURE_2D, 0, gl.SRGB8_ALPHA8, gl.RGBA, gl.UNSIGNED_BYTE, img); mip(ringT); img.close?.();
    }), (e) => console.warn("orbit: the rings are drawn, not photographed", e));
  let moonT = null;
  const loadMoon = fetchOnce(MOON)
    .then((b) => createImageBitmap(b, { colorSpaceConversion: "none", premultiplyAlpha: "none" }))
    .then((img) => inTurn(() => { moonT = tex(img.width, img.height, gl.SRGB8_ALPHA8, gl.RGBA, gl.UNSIGNED_BYTE, img); mip(moonT); img.close?.(); }),
      (e) => console.warn("orbit: the moon is drawn, not photographed", e));
  let galT = null;
  const loadGalaxy = fetchOnce(GALAXY)
    .then((b) => createImageBitmap(b, { colorSpaceConversion: "none", premultiplyAlpha: "none" }))
    .then((img) => inTurn(() => { galT = tex(img.width, img.height, gl.SRGB8_ALPHA8, gl.RGBA, gl.UNSIGNED_BYTE, img); mip(galT); img.close?.(); }),
      (e) => console.warn("orbit: the galaxy is drawn, not Gaia's", e));
  const jobs = [];
  const STRIPS = 4;
  for (let i = 0; i < STRIPS; i++) jobs.push(() => pass(P.sky, skyF, KW, KH, (u) => gl.uniform2f(u.uSize, KW, KH), [0, (KH / STRIPS) * i, KW, KH / STRIPS]));
  jobs.push(() => mip(skyT));
  let next = 0, skyDone = false, baked = false;
  function bakeSome(n) {
    gl.disable(gl.BLEND);
    for (let i = 0; i < n && next < jobs.length; i++) jobs[next++]();
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    if (next >= jobs.length) skyDone = true;
  }
  let baking = null;
  /* ready when the map is in and the galaxy is baked; resolves false if the map cannot be had */
  function bake() {
    if (!baking) baking = new Promise((res) => {
      const step = () => { if (galT) skyDone = true; else bakeSome(1); if (!skyDone) requestAnimationFrame(step); else Promise.all([loadMap, loadRings, loadMoon]).then(() => { baked = true; res(true); }, (e) => { console.warn("orbit: no map", e); res(false); }); };
      Promise.all([made, loadGalaxy]).then(([ok]) => (ok ? requestAnimationFrame(step) : res(false)));
    });
    return baking;
  }

  /* the frame's own targets: the light, and the bloom's chain of halves */
  let W = 1, H = 1, hdrT = null, chain = [];
  const LEVELS = 6;
  function resize(w, h, scale) {
    W = Math.max(1, Math.round(w * scale)); H = Math.max(1, Math.round(h * scale));
    if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; }
    if (!hdr || (hdrT && hdrT.w === W && hdrT.h === H)) return;
    [hdrT, ...chain].forEach((c) => { if (c) { gl.deleteTexture(c.t); gl.deleteFramebuffer(c.f); } });
    const target = (cw, ch) => { const t = tex(cw, ch, gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT, null, gl.CLAMP_TO_EDGE); return { t, f: fb(t), w: cw, h: ch }; };
    hdrT = target(W, H);
    chain = [];
    let cw = W, ch = H;
    for (let i = 0; i < LEVELS; i++) { cw = Math.max(1, cw >> 1); ch = Math.max(1, ch >> 1); chain.push(target(cw, ch)); }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }
  const m3 = (m) => new Float32Array(m);
  /* view: { cam, fwd, right, up, focal (px of the drawing), shift [x,y] (px, y up), sun, spin, tilt, sky (mat3, column-major),
     moon [x,y,z,r], time, bg, sunVis, sunPx [x,y], expo } */
  function draw(v) {
    if (!baked) return;
    gl.disable(gl.BLEND);
    /* the scene may be drawn at a part of the canvas's resolution (v.part), into that corner of its target, and
       brought up to the canvas by the film; everything given in canvas pixels is brought down with it */
    const k = hdr ? Math.min(1, Math.max(0.2, v.part ?? 1)) : 1;
    const RW = Math.max(1, Math.round(W * k)), RH = Math.max(1, Math.round(H * k)), kx = RW / W, ky = RH / H;
    pass(P.render, hdr ? hdrT.f : null, RW, RH, (u) => {
      gl.uniform2f(u.uRes, RW, RH); gl.uniform2f(u.uShift, v.shift[0] * kx, v.shift[1] * ky); gl.uniform2f(u.uSunPx, v.sunPx[0] * kx, v.sunPx[1] * ky);
      gl.uniform1f(u.uFocal, v.focal * kx); gl.uniform1i(u.uDustN, v.dustN ?? 30); gl.uniform1f(u.uPartK, kx); gl.uniform1f(u.uTime, v.time % 1000); gl.uniform1f(u.uBg, v.bg); gl.uniform1f(u.uSunVis, v.sunVis);
      gl.uniform3fv(u.uCam, v.cam); gl.uniform3fv(u.uFwd, v.fwd); gl.uniform3fv(u.uRight, v.right); gl.uniform3fv(u.uUp, v.up); gl.uniform3fv(u.uSun, v.sun);
      gl.uniformMatrix3fv(u.uSpin, false, m3(v.spin)); gl.uniformMatrix3fv(u.uTilt, false, m3(v.tilt)); gl.uniformMatrix3fv(u.uSkyM, false, m3(v.sky));
      gl.uniform4fv(u.uMoon, v.moon); gl.uniform4fv(u.uMoon2, v.moon2 || [0, 0, 0, 0]);
      gl.uniform3fv(u.uVel, v.vel || [0, 0, 0]); gl.uniform1f(u.uDust, v.dust ?? 1); gl.uniform1f(u.uFocusD, v.focusD || 5); gl.uniform1f(u.uGalaxy, galT ? 1 : 0); gl.uniform1f(u.uGalK, v.galK ?? 0.35); gl.uniform2f(u.uAlbSize, SW, SH); gl.uniformMatrix3fv(u.uHue, false, HUE); gl.uniform1f(u.uRingK, RING_K); gl.uniform3fv(u.uHazeT, HAZE);
      gl.uniform1f(u.uGradeK, GRADE ? GRADE[3] : 0); if (GRADE) { gl.uniform3fv(u.uG0, GRADE[0]); gl.uniform3fv(u.uG1, GRADE[1]); gl.uniform3fv(u.uG2, GRADE[2]); }
      bind(0, albT, u.uAlb); bind(1, galT || skyT, u.uSky); bind(2, ringT, u.uRing); bind(3, moonT || ringT, u.uMoonT); gl.uniform1f(u.uHasMoon, moonT ? 1 : 0);
    });
    if (!hdr) return;
    let src = hdrT;
    chain.forEach((c, i) => {
      pass(P.down, c.f, c.w, c.h, (u) => { bind(0, src.t, u.uSrc); gl.uniform2f(u.uTexel, 1 / src.w, 1 / src.h); gl.uniform2f(u.uOut, c.w, c.h); gl.uniform1f(u.uFirst, i === 0 ? 1 : 0); gl.uniform2f(u.uPart, i === 0 ? kx : 1, i === 0 ? ky : 1); });
      src = c;
    });
    gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE);
    for (let i = chain.length - 1; i > 0; i--) {
      const from = chain[i], to = chain[i - 1];
      pass(P.up, to.f, to.w, to.h, (u) => { bind(0, from.t, u.uSrc); gl.uniform2f(u.uTexel, 1 / from.w, 1 / from.h); gl.uniform2f(u.uOut, to.w, to.h); });
    }
    gl.disable(gl.BLEND);
    pass(P.film, null, W, H, (u) => {
      bind(0, hdrT.t, u.uHdr); bind(1, chain[0].t, u.uBloom);
      gl.uniform2f(u.uRes, W, H); gl.uniform2f(u.uPart, kx, ky); gl.uniform2f(u.uTexel, 1 / W, 1 / H);
      gl.uniform1f(u.uTime, v.time % 1000); gl.uniform1f(u.uExpo, v.expo); gl.uniform1f(u.uBloomK, 0.2);
      gl.uniform1f(u.uBlur, v.blur || 0); gl.uniform2fv(u.uBlurC, v.blurC || [W / 2, H / 2]); gl.uniform1f(u.uFringe, v.fringe ?? 0.012); gl.uniform1f(u.uGrain, v.grain ?? 0.028);
    });
  }
  /* waits for everything asked of the GPU so far to be done: for timing frames */
  const finish = () => { gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4)); };
  return {
    gl, bake, draw, resize, finish,
    get baked() { return baked; },
    lose() { gl.getExtension("WEBGL_lose_context")?.loseContext(); },
  };
}
