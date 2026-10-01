/*
 * THE WORLD: the install's planet, drawn for real.
 *
 * One WebGL2 fragment shader ray-traces the scene: a purple world of oceans,
 * continents, mountains and ice under weather that turns, its night side lit
 * gold by the homes on it; a scattering atmosphere; rings with their own
 * divisions and shadows; a small gold moon; and the galaxy behind. The
 * planet's surface and the galaxy are baked once on the GPU into textures,
 * so each frame only lights them.
 *
 * createWorld(canvas) → null when WebGL2 is not there; otherwise
 *   { bake(sync), baked, draw(view), resize(w, h, scale), lose() }
 */

const VERT = `#version 300 es
in vec2 p; void main(){ gl_Position = vec4(p, 0.0, 1.0); }`;

/* simplex noise (Gustavson / McEwan), fbm and ridged fbm */
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
vec3 rotAx(vec3 p,vec3 a,float t){return p*cos(t)+cross(a,p)*sin(t)+a*dot(a,p)*(1.0-cos(t));}
vec3 srgb(int r,int g,int b){return pow(vec3(r,g,b)/255.0,vec3(2.2));}
float hash13(vec3 p){p=fract(p*0.1031);p+=dot(p,p.zyx+31.32);return fract((p.x+p.y)*p.z);}
float worley(vec3 p){vec3 i=floor(p),f=fract(p);float d=1.0;for(int z=-1;z<=1;z++)for(int y=-1;y<=1;y++)for(int x=-1;x<=1;x++){vec3 o=vec3(x,y,z);vec3 h=vec3(hash13(i+o),hash13(i+o+19.1),hash13(i+o+47.3));vec3 r=o+h-f;d=min(d,dot(r,r));}return sqrt(d);}
`;

/* THE SURFACE, baked: albedo (sRGB) and the data — height, sea, lights, cloud */
const SURFACE = `#version 300 es
precision highp float;
uniform vec2 uSize;
layout(location=0) out vec4 oAlb;
layout(location=1) out vec4 oDat;
${NOISE}
void main(){
  vec2 uv=gl_FragCoord.xy/uSize;
  float lon=(uv.x-0.5)*6.2831853, lat=(uv.y-0.5)*3.1415927;
  vec3 p=vec3(cos(lat)*sin(lon),sin(lat),cos(lat)*cos(lon));

  /* the ground: continents from a slow swell, warped and broken at the coast, mountains ridged along them */
  vec3 q=p+vec3(3.1,-1.7,0.4);
  vec3 w=vec3(fbm(q*1.3,4),fbm(q*1.3+vec3(5.2,1.3,2.8),4),fbm(q*1.3+vec3(1.7,9.2,4.1),4));
  float swell=snoise(q*0.75+w*0.3)*0.55+snoise(q*1.4+w*0.5)*0.25;
  float c=swell+0.42*fbm(q*2.6+w*1.1,11);
  float landE=c-0.08;
  float land=step(0.0,landE);
  float rid=ridged(p*3.0+w*0.7,10);
  float range=smoothstep(0.1,0.5,snoise(q*1.1+w*0.8+vec3(7.0,2.0,1.0))*0.5+0.5);
  float mtn=smoothstep(0.0,0.16,landE)*rid*rid*range*1.6;
  float fine=fbm(p*48.0+w,5);
  float h=landE*0.6+mtn*0.55+0.02*fine*land;

  /* climate: warm at the equator, dry in the subtropics and the interiors, ice only at the poles */
  float alat=abs(lat)/1.5707963;
  float temp=1.0-alat*alat*1.3-max(mtn,0.0)*0.55+0.08*fbm(p*3.0+7.0,5);
  float moist=0.68+0.55*fbm(p*2.1+w*0.7+vec3(11.0,3.0,7.0),7);
  moist-=0.3*exp(-pow((alat-0.3)/0.1,2.0));
  moist-=0.25*smoothstep(0.08,0.4,landE);
  moist+=0.2*exp(-pow(alat/0.12,2.0));

  float n1=0.5+0.5*fbm(p*7.0+w*2.0,6), n2=0.5+0.5*fbm(p*15.0-w,5), n3=0.5+0.5*fbm(p*30.0,4);
  vec3 desert=mix(srgb(156,104,80),srgb(178,140,98),n1);
  desert=mix(desert,srgb(122,58,40),smoothstep(0.62,0.9,n2)*0.7);
  vec3 steppe=mix(srgb(112,80,96),srgb(104,88,74),n2);
  vec3 forest=mix(srgb(48,20,60),srgb(86,28,74),n1);
  forest=mix(forest,srgb(30,22,52),smoothstep(0.55,0.85,n3)*0.7);
  vec3 tundra=mix(srgb(98,88,104),srgb(128,118,126),n2);
  vec3 rock=mix(srgb(60,52,64),srgb(104,90,92),n3);
  vec3 col=mix(desert,steppe,smoothstep(0.22,0.4,moist));
  col=mix(col,forest,smoothstep(0.4,0.58,moist));
  col=mix(col,tundra,smoothstep(0.35,0.12,temp));
  col=mix(col,rock,smoothstep(0.15,0.55,mtn));
  float snow=max(smoothstep(0.06,-0.04,temp+0.05*fine),smoothstep(0.85,1.05,mtn+0.1*fine));
  col=mix(col,srgb(236,234,248),snow);
  col*=0.8+0.4*n3;
  col*=mix(1.0,0.7+0.45*ridged(p*110.0+w,5),land*(1.0-snow*0.7));
  col=mix(srgb(186,164,136),col,smoothstep(0.0,0.01,landE));

  /* the sea: turquoise over the shelves, violet, then the abyss */
  float depth=max(-landE,0.0);
  vec3 sea=mix(srgb(46,84,118),srgb(40,34,104),smoothstep(0.0,0.09,depth));
  sea=mix(sea,srgb(30,12,76),smoothstep(0.05,0.22,depth));
  sea=mix(sea,srgb(13,4,36),smoothstep(0.18,0.55,depth));
  sea*=0.88+0.24*n1;
  float seaIce=smoothstep(0.86,0.92,alat+0.04*fbm(p*9.0,5));
  sea=mix(sea,srgb(214,222,240),seaIce);
  float ocean=(1.0-smoothstep(-0.004,0.004,landE))*(1.0-seaIce);
  col=mix(sea,col,land);

  /* the lights of the homes: lowland, coastal, temperate; towns, and the roads between them */
  float habit=land*(1.0-snow)*smoothstep(0.15,0.4,temp)*smoothstep(0.35,0.05,mtn)*(0.45+0.55*smoothstep(0.1,0.0,landE));
  float region=smoothstep(-0.15,0.35,fbm(p*5.0+3.0,5));
  float towns=pow(max(snoise(p*150.0),0.0),2.0)+0.7*pow(max(snoise(p*420.0),0.0),2.5);
  float roads=smoothstep(0.92,1.0,1.0-abs(snoise(p*60.0+w)))*0.6;
  float grain=step(0.97,hash13(floor(vec3(uv*uSize,1.0))))*0.8;
  float city=clamp(habit*region*(towns*2.6+roads*1.4+grain),0.0,1.0);

  /* the weather: storms spun up at the mid-latitudes, streaks drawn out along them */
  vec3 cp=p; float eye=0.0;
  for(int i=0;i<7;i++){
    float fi=float(i);
    vec3 ci=normalize(vec3(sin(fi*12.9+1.0),(fi<3.5?1.0:-1.0)*(0.38+0.18*sin(fi*3.7)),cos(fi*4.1+3.0)));
    float d=length(cp-ci); eye+=exp(-d*d/0.012)-1.6*exp(-d*d/0.00015);
    cp=rotAx(cp,ci,sign(ci.y)*(5.0+2.0*sin(fi*5.3))*exp(-d*d/0.03));
  }
  vec3 cw=vec3(fbm(cp*1.7+3.0,4),fbm(cp*1.7+7.0,4),fbm(cp*1.7+13.0,4));
  vec3 cs=cp*vec3(1.0,1.7,1.0)*1.7+cw*0.85;
  float base=fbm(cs,11);
  float belts=0.14*exp(-pow(lat/0.12,2.0))-0.16*exp(-pow((abs(lat)-0.45)/0.13,2.0))+0.1*exp(-pow((abs(lat)-0.95)/0.18,2.0));
  float cl=smoothstep(-0.05,0.55,base+belts+0.35*eye);
  float wisp=fbm(cs*3.3+cw*2.0,6), tufts=fbm(cs*9.0+cw*3.0,5);
  cl=pow(cl,1.6)*(0.45+0.55*smoothstep(-0.45,0.35,wisp));
  cl=clamp(cl-0.12*smoothstep(-0.1,0.5,tufts)*(1.0-cl),0.0,1.0);
  /* open cells of convection where the weather is thin, and puffs at the edges of the thick */
  vec3 cq=cp*38.0+cw*3.0+2.5*vec3(fbm(cp*9.0,4),fbm(cp*9.0+4.0,4),fbm(cp*9.0+8.0,4));
  float cells=smoothstep(0.25,0.8,worley(cq))*(0.6+0.4*fbm(cp*60.0,3))*smoothstep(0.1,0.55,fbm(cp*4.0+cw+21.0,5)+0.2);
  float puffs=1.0-smoothstep(0.1,0.6,worley(cp*130.0+cw*3.0));
  cl=max(cl,0.22*cells*(1.0-cl)*smoothstep(0.55,0.2,alat));
  cl=clamp(cl*(0.75+0.35*puffs)+0.08*puffs*smoothstep(0.05,0.3,cl),0.0,1.0);
  cl=max(cl,0.05*smoothstep(0.0,0.6,fbm(cp*vec3(1.0,3.0,1.0)*3.0+cw*2.0,6)));
  cl=clamp(cl,0.0,1.0);

  oAlb=vec4(col,1.0);
  oDat=vec4(h*0.5+0.5,ocean,city,cl);
}`;

/* THE GALAXY, baked: the band, its dust, its nebulae; alpha is how dense the stars are */
const SKY = `#version 300 es
precision highp float;
uniform vec2 uSize;
out vec4 o;
${NOISE}
void main(){
  vec2 uv=gl_FragCoord.xy/uSize;
  float lon=(uv.x-0.5)*6.2831853, lat=(uv.y-0.5)*3.1415927;
  vec3 d=vec3(cos(lat)*sin(lon),sin(lat),cos(lat)*cos(lon));
  vec3 gN=normalize(vec3(0.0,1.0,0.0));
  vec3 gC=vec3(0.0,0.0,1.0);
  vec3 w=vec3(fbm(d*2.5,5),fbm(d*2.5+5.0,5),fbm(d*2.5+9.0,5));
  float b=dot(d,gN)+0.06*fbm(d*3.0+w,6);
  float toCore=acos(clamp(dot(normalize(d-gN*dot(d,gN)),gC),-1.0,1.0));
  float thick=0.08+0.07*exp(-toCore*toCore/0.5);
  float band=exp(-b*b/(thick*thick));
  float bulge=exp(-(b*b)/0.03-toCore*toCore/0.22);
  float cloud=0.5+0.5*fbm(d*5.0+w*1.6,9);
  float lanes=smoothstep(0.3,0.8,ridged(d*4.5+w*2.2,9))*exp(-b*b/(thick*thick*0.35));
  float dust=1.0-0.94*lanes;
  vec3 arm=vec3(0.62,0.66,0.95), core=vec3(1.0,0.74,0.5);
  vec3 c=band*(0.25+0.75*cloud)*mix(arm,core,bulge*0.9+0.15)*dust*0.55;
  c+=bulge*core*0.5*dust;
  float hii=pow(max(fbm(d*8.0+w*3.0,7)+0.1,0.0),3.0)*band;
  c+=hii*vec3(1.0,0.28,0.55)*1.8*dust;
  float oiii=pow(max(fbm(d*4.0+11.0+w,6)+0.05,0.0),4.0)*(0.3+band);
  c+=oiii*vec3(0.2,0.7,0.8)*1.2*dust;
  float far=0.5+0.5*fbm(d*1.8+w,5);
  c+=vec3(0.03,0.018,0.06)*far+vec3(0.0,0.01,0.025)*(1.0-far);
  float stars=clamp(band*dust*1.2+bulge*0.8+0.25,0.0,1.0);
  o=vec4(clamp(c*0.32,0.0,1.0),stars);
}`;

/* THE SHOT: everything a ray meets, lit */
const RENDER = `#version 300 es
precision highp float;
out vec4 o;
uniform vec2 uRes, uShift, uSunPx;
uniform float uFocal, uTime, uBg, uSunVis, uExpo, uCloudT;
uniform vec3 uCam, uFwd, uRight, uUp, uSun;
uniform mat3 uSpin, uTilt, uSkyM;
uniform vec4 uMoon;
uniform sampler2D uAlb, uDat, uSky, uRing;
uniform vec2 uDatSize;
${NOISE}
const float RA=1.055, HR=0.011, HM=0.005;
const vec3 BR=vec3(2.5,2.1,6.2);
const float BM=3.0;
const vec3 SUNI=vec3(1.0,0.96,0.9)*9.0;
const float RIN=1.34, ROUT=2.42;
const float PI=3.14159265;

vec2 sph(vec3 ro,vec3 rd,float r){float b=dot(ro,rd),c=dot(ro,ro)-r*r,h=b*b-c;if(h<0.0)return vec2(-1.0);h=sqrt(h);return vec2(-b-h,-b+h);}
vec3 toSun(vec3 x){
  float tb=dot(x,uSun); float pd=length(x-uSun*tb);
  float sh=tb>0.0?1.0:smoothstep(0.97,1.025,pd);
  if(sh<=0.0)return vec3(0.0);
  vec2 e=sph(x,uSun,RA); float L=max(e.y,0.0), ds=L/5.0, r=0.0, m=0.0;
  for(int i=0;i<5;i++){float h=max(length(x+uSun*(ds*(float(i)+0.5)))-1.0,0.0);r+=exp(-h/HR);m+=exp(-h/HM);}
  return sh*exp(-(BR*r+BM*1.1*m)*ds);
}
float ringShadow(vec3 P){vec3 pt=uTilt*P, lt=uTilt*uSun; if(abs(lt.y)<1e-4)return 1.0; float t=-pt.y/lt.y; if(t<=0.0)return 1.0; vec3 x=pt+lt*t; float r=length(x.xz);
  float e=smoothstep(RIN,RIN+0.06,r)*smoothstep(ROUT,ROUT-0.04,r); return 1.0-0.62*e*textureLod(uRing,vec2(clamp((r-RIN)/(ROUT-RIN),0.0,1.0),0.5),6.5).a;}

void atmos(vec3 ro,vec3 rd,float t0,float t1,inout vec3 col){
  const int N=14; float ds=(t1-t0)/float(N);
  vec3 sR=vec3(0.0), sM=vec3(0.0); float oR=0.0, oM=0.0, glow=0.0;
  for(int i=0;i<N;i++){
    vec3 x=ro+rd*(t0+ds*(float(i)+0.5)); float h=max(length(x)-1.0,0.0);
    float dR=exp(-h/HR)*ds, dM=exp(-h/HM)*ds; oR+=dR; oM+=dM;
    vec3 Tv=exp(-(BR*oR+BM*1.1*oM));
    vec3 Ts=toSun(x)*ringShadow(x);
    sR+=dR*Ts*Tv; sM+=dM*Ts*Tv;
    glow+=exp(-pow((h-0.012)/0.002,2.0))*ds;
  }
  float mu=dot(rd,uSun), g=0.82;
  float pR=0.0597*(1.0+mu*mu);
  float pM=0.1193*(1.0-g*g)*(1.0+mu*mu)/((2.0+g*g)*pow(1.0+g*g-2.0*g*mu,1.5));
  vec3 T=exp(-(BR*oR+BM*1.1*oM));
  col=col*T+SUNI*(sR*BR*pR+sM*BM*pM*vec3(1.0,0.93,0.86));
  col+=vec3(0.3,1.0,0.6)*glow*0.06;
}

vec3 stars(vec3 d,float dens){
  vec3 c=vec3(0.0); float pxA=1.0/uFocal;
  for(int i=0;i<3;i++){
    float fi=float(i), sc=(i==0?22.0:i==1?80.0:260.0);
    vec3 g=d*sc, id=floor(g);
    float h1=hash13(id+fi*31.0), h2=hash13(id.yzx+fi*17.0+5.0), h3=hash13(id.zxy+fi*13.0+11.0), h4=hash13(id+vec3(7.0,3.0,1.0)+fi);
    vec3 sp=normalize((id+0.3+0.4*vec3(h1,h2,h4))/sc);
    float ang=acos(clamp(dot(d,sp),-1.0,1.0));
    float px=ang/pxA;
    float keep=step(1.0-(i==0?0.3:i==1?0.3*dens+0.08:0.55*dens+0.05),h3);
    float m=(i==0?0.4+pow(h1,4.0)*3.0:i==1?0.1+pow(h2,3.0)*0.9:0.04+pow(h1,2.0)*0.3)*keep;
    float tint=fract(h1*13.7+h2*7.1);
    vec3 sc3=tint<0.25?vec3(0.62,0.74,1.0):tint<0.6?vec3(1.0,0.97,0.94):tint<0.85?vec3(1.0,0.86,0.66):vec3(1.0,0.66,0.5);
    float cell=0.3/sc/pxA;
    float halo=i==0?0.05*exp(-px/max(1.5,cell*0.12))*smoothstep(cell,cell*0.5,px):0.0;
    c+=sc3*m*(exp(-px*px*1.6)+halo);
  }
  return c;
}

vec3 sky(vec3 rd){
  vec3 d=uSkyM*rd;
  vec2 uv=vec2(atan(d.x,d.z)/6.2831853+0.5,asin(clamp(d.y,-1.0,1.0))/PI+0.5);
  vec2 uv2=vec2(fract(uv.x+0.5),uv.y), dx=dFdx(uv), dy=dFdy(uv), dx2=dFdx(uv2), dy2=dFdy(uv2);
  if(abs(dx2.x)<abs(dx.x))dx.x=dx2.x; if(abs(dy2.x)<abs(dy.x))dy.x=dy2.x;
  vec4 s=textureGrad(uSky,uv,dx,dy);
  vec3 c=s.rgb*1.1+stars(d,s.a);
  float a=acos(clamp(dot(rd,uSun),-1.0,1.0));
  c+=vec3(1.0,0.97,0.9)*1800.0*smoothstep(0.0062,0.0052,a);
  return c;
}

vec4 ring(vec3 ro,vec3 rd,out float t){
  vec3 o3=uTilt*ro, d=uTilt*rd; t=-1.0;
  if(abs(d.y)<1e-5)return vec4(0.0);
  float tt=-o3.y/d.y; if(tt<=0.0)return vec4(0.0);
  vec3 x=o3+d*tt; float r=length(x.xz);
  if(r<RIN||r>ROUT)return vec4(0.0);
  t=tt;
  float u=(r-RIN)/(ROUT-RIN);
  vec4 rs=textureGrad(uRing,vec2(u,0.5),vec2(dFdx(u),0.0),vec2(dFdy(u),0.0));
  float ang=atan(x.z,x.x);
  float clump=0.85+0.3*snoise(vec3(cos(ang)*r*40.0,sin(ang)*r*40.0,r*90.0));
  float tau=rs.a*2.4*clump;
  float mu=max(abs(d.y),0.015);
  float a=1.0-exp(-tau/mu);
  vec3 lt=uTilt*uSun; float mu0=max(abs(lt.y),0.015);
  vec3 X=transpose(uTilt)*x;
  float tb=dot(X,uSun), pd=length(X-uSun*tb);
  float sh=tb>0.0?1.0:smoothstep(0.99,1.035,pd);
  vec3 Ts=toSun(X);
  float ph=dot(rd,uSun);
  vec3 c;
  if(sign(lt.y)==sign(o3.y)) c=rs.rgb*Ts*(mu0/(mu0+mu))*1.4*(0.75+0.25*(1.0-ph));
  else { float g=0.55; float hg=(1.0-g*g)/pow(1.0+g*g-2.0*g*ph,1.5); c=rs.rgb*Ts*(1.0-exp(-tau/mu0))*exp(-tau*0.6/mu)*hg*0.6+rs.rgb*Ts*0.04; }
  c*=sh;
  c+=rs.rgb*vec3(0.045,0.03,0.08)*0.3;
  return vec4(c*a,a);
}

vec3 moon(vec3 P,vec3 rd){
  vec3 m=normalize(P-uMoon.xyz);
  float cr=0.0, s=1.0;
  for(int i=0;i<3;i++){float n=snoise(m*(5.0*s)+float(i)*7.3); cr+=smoothstep(0.55,0.85,1.0-abs(n))*0.5/s; s*=2.3;}
  float n=fbm(m*6.0,5);
  vec3 alb=mix(srgb(120,98,62),srgb(196,166,108),0.5+0.5*n)*(1.0-0.35*cr);
  vec3 nb=normalize(m+0.18*vec3(snoise(m*14.0),snoise(m*14.0+3.0),snoise(m*14.0+6.0)));
  float tb=dot(P,uSun), pd=length(P-uSun*tb);
  float sh=tb>0.0?1.0:smoothstep(0.99,1.06,pd);
  vec3 c=alb*SUNI*0.3*max(dot(nb,uSun),0.0)*sh;
  c+=alb*vec3(0.08,0.05,0.16)*max(dot(m,normalize(-uMoon.xyz)),0.0);
  return c;
}

vec3 surface(vec3 P,vec3 rd){
  vec3 n=normalize(P);
  vec3 pp=uSpin*n;
  vec2 uv=vec2(atan(pp.x,pp.z)/6.2831853+0.5,asin(clamp(pp.y,-1.0,1.0))/PI+0.5);
  vec2 uv2=vec2(fract(uv.x+0.5),uv.y);
  vec2 dx=dFdx(uv), dy=dFdy(uv), dx2=dFdx(uv2), dy2=dFdy(uv2);
  if(abs(dx2.x)<abs(dx.x))dx.x=dx2.x; if(abs(dy2.x)<abs(dy.x))dy.x=dy2.x;
  vec3 alb=textureGrad(uAlb,uv,dx,dy).rgb;
  vec4 dat=textureGrad(uDat,uv,dx,dy);
  float ocean=dat.g, city=dat.b;
  float coslat=max(sqrt(1.0-pp.y*pp.y),0.05);
  vec2 ex=vec2(max(1.0/uDatSize.x,abs(dx.x)+abs(dy.x)),0.0), ey=vec2(0.0,max(1.0/uDatSize.y,abs(dx.y)+abs(dy.y)));
  float hE=(textureGrad(uDat,uv+ex,dx,dy).r-textureGrad(uDat,uv-ex,dx,dy).r)*2.0/(2.0*ex.x*6.2831853*coslat);
  float hN=(textureGrad(uDat,uv+ey,dx,dy).r-textureGrad(uDat,uv-ey,dx,dy).r)*2.0/(2.0*ey.y*PI);
  vec3 E=normalize(vec3(pp.z,0.0,-pp.x)+1e-5); vec3 Nn=cross(pp,E);
  vec3 nbP=normalize(pp-(E*hE+Nn*hN)*0.05*(1.0-ocean));
  vec3 nb=transpose(uSpin)*nbP;
  /* the weather, a little faster than the ground */
  vec2 uvc=uv+vec2(uCloudT,0.0);
  float cl=textureGrad(uDat,uvc,dx,dy).a;
  float cE=(textureGrad(uDat,uvc+ex,dx,dy).a-textureGrad(uDat,uvc-ex,dx,dy).a)/(2.0*ex.x*6.2831853*coslat);
  float cN=(textureGrad(uDat,uvc+ey,dx,dy).a-textureGrad(uDat,uvc-ey,dx,dy).a)/(2.0*ey.y*PI);
  vec3 cn=transpose(uSpin)*normalize(pp-(E*cE+Nn*cN)*0.0035);
  vec3 Lp=uSpin*uSun;
  vec3 ps=normalize(pp+(Lp-pp*dot(Lp,pp))*0.012);
  vec2 uvs=vec2(atan(ps.x,ps.z)/6.2831853+0.5+uCloudT,asin(clamp(ps.y,-1.0,1.0))/PI+0.5);
  float cs=textureGrad(uDat,uvs,dx,dy).a;

  vec3 Ts=toSun(n*1.02)*ringShadow(n);
  vec3 sunL=SUNI*Ts;
  float ndl=max(dot(nb,uSun),0.0), mu=dot(n,uSun);
  float twi=smoothstep(-0.25,0.3,mu);
  vec3 amb=vec3(0.035,0.04,0.11)*twi;
  vec3 g=alb*(sunL*ndl*(1.0-0.7*cs)/PI+amb);
  /* the sea: the sun's glitter, and a little sky */
  vec3 V=-rd;
  vec3 nw=normalize(n+0.035*vec3(snoise(pp*900.0),snoise(pp*900.0+5.0),snoise(pp*900.0+9.0))*(1.0-clamp(length(dx)*uDatSize.x*0.2,0.0,1.0)));
  vec3 H=normalize(uSun+V);
  float nh=max(dot(nw,H),0.0), r2=0.025;
  float D=r2/(PI*pow(nh*nh*(r2-1.0)+1.0,2.0));
  float F=0.02+0.98*pow(1.0-max(dot(V,H),0.0),5.0);
  g+=ocean*sunL*vec3(1.0,0.9,0.78)*(1.0-0.8*cs)*D*F*ndl*0.22;
  g+=ocean*vec3(0.02,0.03,0.08)*F*twi;
  /* the clouds, lit from their own tops */
  float cdl=max(dot(cn,uSun)*0.85+0.15,0.0)*smoothstep(-0.15,0.08,mu);
  vec3 cloudC=mix(vec3(0.62,0.64,0.78),vec3(0.9,0.88,0.92),smoothstep(0.1,0.8,cl))*(sunL*cdl/PI+amb*1.5);
  vec3 col=mix(g,cloudC,cl);
  /* the night: the homes, gold, through what weather is over them */
  float night=1.0-smoothstep(-0.14,0.06,mu);
  col+=vec3(1.0,0.66,0.3)*city*city*night*(1.0-0.85*cl)*2.4;
  float glowCity=textureLod(uDat,uv,5.0).b;
  col+=vec3(1.0,0.55,0.25)*glowCity*(0.25+cl)*night*0.5;
  return col;
}

vec3 aces(vec3 x){return clamp((x*(2.51*x+0.03))/(x*(2.43*x+0.59)+0.14),0.0,1.0);}

void main(){
  vec2 q=(gl_FragCoord.xy-0.5*uRes-uShift)/uFocal;
  vec3 ro=uCam, rd=normalize(uFwd+uRight*q.x+uUp*q.y);
  vec3 col=sky(rd)*uBg; float alpha=uBg;
  vec2 tp=sph(ro,rd,1.0), ta=sph(ro,rd,RA);
  vec2 tm=sph(ro-uMoon.xyz,rd,uMoon.w);
  float tOp=1e9;
  if(tp.x>0.0){tOp=tp.x;}
  if(tm.x>0.0&&tm.x<tOp){tOp=tm.x;}
  float tr; vec4 rc=ring(ro,rd,tr);
  bool ringOn=tr>0.0&&tr<tOp;
  if(tOp<1e8){ vec3 P=ro+rd*tOp; col=(tp.x>0.0&&tOp==tp.x)?surface(P,rd):moon(P,rd); alpha=1.0; }
  if(ringOn&&ta.x>0.0&&tr>ta.y){col=col*(1.0-rc.a)+rc.rgb; alpha=alpha+(1.0-alpha)*rc.a;}
  if(ta.y>0.0&&max(ta.x,0.0)<tOp){ atmos(ro,rd,max(ta.x,0.0),min(ta.y,tOp),col); }
  if(ringOn&&(ta.x<=0.0||tr<ta.x)){col=col*(1.0-rc.a)+rc.rgb; alpha=alpha+(1.0-alpha)*rc.a;}
  /* the light in the lens */
  float sa=acos(clamp(dot(rd,uSun),-1.0,1.0));
  vec3 glare=vec3(1.0,0.86,0.66)*(0.9*exp(-sa/0.012)+0.16*exp(-sa/0.07)+0.035*exp(-sa/0.35));
  vec2 dp=gl_FragCoord.xy-uSunPx;
  glare+=vec3(0.75,0.62,1.0)*0.22*exp(-abs(dp.y)/(uRes.y*0.004))*exp(-abs(dp.x)/(uRes.x*0.35));
  col+=glare*uSunVis;
  col*=uExpo;
  col=aces(col);
  col=pow(col,vec3(1.0/2.2));
  col+=(hash13(vec3(gl_FragCoord.xy,uTime))-0.5)/255.0;
  o=vec4(max(col,0.0),alpha);
}`;

function ringProfile(n) {
  /* the rings: a faint inner ring, a bright broad one, a division, an outer
     one with a gap of its own, and a thread beyond; ringlets all through */
  const px = new Uint8Array(n * 4);
  let s = 90210;
  const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
  const waves = Array.from({ length: 90 }, () => [20 + rnd() * 1400, rnd() * 6.283, 0.03 + rnd() * 0.1]);
  const RIN = 1.34, ROUT = 2.42;
  const lin = (c) => Math.round(255 * Math.pow(c, 1 / 2.2));
  const sm = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  for (let i = 0; i < n; i++) {
    const r = RIN + ((i + 0.5) / n) * (ROUT - RIN);
    let d = 0, col;
    if (r < 1.55) { d = (0.04 + 0.16 * sm(1.4, 1.55, r)) * sm(1.34, 1.4, r); col = [0.36, 0.28, 0.42]; }
    else if (r < 1.98) { d = 0.5 + 0.4 * sm(1.55, 1.75, r) - 0.2 * sm(1.86, 1.98, r); col = [0.9 - 0.25 * sm(1.55, 1.98, r), 0.7 - 0.22 * sm(1.6, 1.98, r), 0.48 - 0.12 * sm(1.6, 1.98, r)]; }
    else if (r < 2.06) { d = 0.03; col = [0.4, 0.3, 0.32]; }
    else if (r < 2.3) { d = 0.4 - 0.12 * sm(2.06, 2.3, r); col = [0.74, 0.5, 0.46]; if (Math.abs(r - 2.24) < 0.008) d = 0.02; }
    else if (Math.abs(r - 2.37) < 0.006) { d = 0.45; col = [0.92, 0.8, 0.68]; }
    else { d = 0; col = [0.6, 0.6, 0.6]; }
    let m = 1;
    for (const [f, ph, a] of waves) m += a * Math.sin(r * f + ph);
    d = Math.max(0, Math.min(1, d * m));
    const tint = 0.82 + 0.3 * Math.sin(r * 37 + 1.3) * Math.sin(r * 11.3);
    px[i * 4] = lin(Math.min(1, col[0] * tint)); px[i * 4 + 1] = lin(Math.min(1, col[1] * tint)); px[i * 4 + 2] = lin(Math.min(1, col[2] * (2 - tint)));
    px[i * 4 + 3] = Math.round(d * 255);
  }
  return px;
}

export function createWorld(canvas, opts = {}) {
  const gl = canvas.getContext("webgl2", { alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false, powerPreference: "high-performance" });
  if (!gl) return null;
  const floatOK = !!gl.getExtension("EXT_color_buffer_float");
  const aniso = gl.getExtension("EXT_texture_filter_anisotropic");
  const small = opts.small ?? (matchMedia("(pointer: coarse)").matches || Math.min(screen.width, screen.height) < 800);
  const SW = opts.surface ?? (small ? 2048 : 4096), SH = SW / 2;
  const KW = small ? 1024 : 2048, KH = KW / 2;

  const compile = (type, src) => {
    const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    return s;
  };
  const vs = compile(gl.VERTEX_SHADER, VERT);
  const program = (src) => {
    const p = gl.createProgram(); gl.attachShader(p, vs); gl.attachShader(p, compile(gl.FRAGMENT_SHADER, src));
    gl.bindAttribLocation(p, 0, "p"); gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    const u = {}; const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < n; i++) { const a = gl.getActiveUniform(p, i); u[a.name] = gl.getUniformLocation(p, a.name); }
    return { p, u };
  };
  let surfP, skyP, renderP;
  try { surfP = program(SURFACE); skyP = program(SKY); renderP = program(RENDER); }
  catch (e) { console.warn("orbit: the world could not be drawn", e); return null; }

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
  const albT = tex(SW, SH, gl.SRGB8_ALPHA8, gl.RGBA, gl.UNSIGNED_BYTE);
  const datT = floatOK ? tex(SW, SH, gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT) : tex(SW, SH, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE);
  const skyT = tex(KW, KH, gl.SRGB8_ALPHA8, gl.RGBA, gl.UNSIGNED_BYTE);
  const RN = 4096;
  const ringT = tex(RN, 1, gl.SRGB8_ALPHA8, gl.RGBA, gl.UNSIGNED_BYTE, ringProfile(RN), gl.CLAMP_TO_EDGE);
  mip(ringT);
  const fbS = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, fbS);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, albT, 0);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, datT, 0);
  gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
  const fbK = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, fbK);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, skyT, 0);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);

  /* the bake, a strip at a time, so the door keeps its frames while it happens */
  const STRIPS = small ? 8 : 16;
  let strip = 0, baked = false;
  function bakeStrip() {
    gl.bindVertexArray(vao); gl.disable(gl.BLEND);
    if (strip < STRIPS) {
      const h = SH / STRIPS;
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbS); gl.viewport(0, 0, SW, SH);
      gl.enable(gl.SCISSOR_TEST); gl.scissor(0, strip * h, SW, h);
      gl.useProgram(surfP.p); gl.uniform2f(surfP.u.uSize, SW, SH);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    } else {
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbK); gl.viewport(0, 0, KW, KH); gl.disable(gl.SCISSOR_TEST);
      gl.useProgram(skyP.p); gl.uniform2f(skyP.u.uSize, KW, KH);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
    gl.disable(gl.SCISSOR_TEST);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    strip++;
    if (strip > STRIPS) { mip(albT); mip(datT); mip(skyT); baked = true; }
  }
  let baking = null;
  function bake(sync = false) {
    if (baked) return Promise.resolve();
    if (sync) { while (!baked) bakeStrip(); return Promise.resolve(); }
    if (!baking) baking = new Promise((res) => { const step = () => { if (baked) { res(); return; } bakeStrip(); requestAnimationFrame(step); }; requestAnimationFrame(step); });
    return baking;
  }

  let W = 1, H = 1;
  function resize(w, h, scale) {
    W = Math.max(1, Math.round(w * scale)); H = Math.max(1, Math.round(h * scale));
    if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; }
  }
  const m3 = (m) => new Float32Array(m);
  /* view: { cam:[x,y,z], fwd, right, up, focal(px of the drawing), shift:[x,y](px, y up), sun:[x,y,z], spin, tilt, sky (mat3 arrays, column-major),
     moon:[x,y,z,r], time, bg, sunVis, sunPx:[x,y], expo, cloudT } */
  function draw(v) {
    if (!baked) bake(true);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, W, H);
    gl.useProgram(renderP.p); gl.bindVertexArray(vao);
    const u = renderP.u;
    gl.uniform2f(u.uRes, W, H); gl.uniform2f(u.uShift, v.shift[0], v.shift[1]); gl.uniform2f(u.uSunPx, v.sunPx[0], v.sunPx[1]);
    gl.uniform1f(u.uFocal, v.focal); gl.uniform1f(u.uTime, v.time % 1000); gl.uniform1f(u.uBg, v.bg); gl.uniform1f(u.uSunVis, v.sunVis);
    gl.uniform1f(u.uExpo, v.expo); gl.uniform1f(u.uCloudT, v.cloudT);
    gl.uniform3fv(u.uCam, v.cam); gl.uniform3fv(u.uFwd, v.fwd); gl.uniform3fv(u.uRight, v.right); gl.uniform3fv(u.uUp, v.up); gl.uniform3fv(u.uSun, v.sun);
    gl.uniformMatrix3fv(u.uSpin, false, m3(v.spin)); gl.uniformMatrix3fv(u.uTilt, false, m3(v.tilt)); gl.uniformMatrix3fv(u.uSkyM, false, m3(v.sky));
    gl.uniform4fv(u.uMoon, v.moon); gl.uniform2f(u.uDatSize, SW, SH);
    [[albT, "uAlb"], [datT, "uDat"], [skyT, "uSky"], [ringT, "uRing"]].forEach(([t, n], i) => { gl.activeTexture(gl.TEXTURE0 + i); gl.bindTexture(gl.TEXTURE_2D, t); gl.uniform1i(u[n], i); });
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
  return {
    gl, bake, draw, resize,
    get baked() { return baked; },
    lose() { gl.getExtension("WEBGL_lose_context")?.loseContext(); },
  };
}
