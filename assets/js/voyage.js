/*
 * The flight's world, drawn in WebGL2 beneath the flight's own canvas
 * (engine.js), which keeps the traffic, the endings and the mark on top.
 *
 * Here: the Earth the door shows (tools/dawn.py) as a globe that falls away —
 * the same camera, 800 km over the Atlantic facing the sunrise, projected onto
 * whatever circle the flight gives the world each frame, so it moves exactly
 * as the flight's world does while its shading stays true: the cities on the
 * night side, the air lit along the limb, the sunlit crescent opening as the
 * camera climbs. Behind it, the Milky Way as Gaia saw it and the fine stars
 * (on the docs' flight, a galaxy in three dimensions is where it goes: seen
 * from outside, dived into, and rested in, its band across the sky as the
 * docs page shows it, the constellations lighting on it);
 * in front, the streaks of the climb, light in depth layers about the way
 * ahead; at the end, the star the flight arrives at. Then the film: bloom,
 * the door's own tone curve, grain.
 *
 * Imagery: NASA's Black Marble (city lights) and Blue Marble (land, clouds),
 * NASA Earth Observatory; the Milky Way: NASA/Goddard SVS, Gaia DR2:
 * ESA/Gaia/DPAC. Reduced to small maps for here (assets/img/flight).
 */

const IMG = (p) => new URL(`../img/${p}`, import.meta.url).href;
const TEX = {
  lights: IMG("flight/earth-lights.webp"), day: IMG("flight/earth-day.webp"), clouds: IMG("flight/earth-clouds.webp"),
  euro: IMG("flight/europe-lights.webp"), sky: IMG("install/galaxy-2k.webp"), moon: IMG("install/moon.webp"),
};
/* the Europe lights cover lon 2..24, lat 38..55: the door's own view, sharper */
const EURO = [2, 24, 38, 55];

const VERT = `#version 300 es
void main(){ vec2 p=vec2((gl_VertexID<<1)&2,gl_VertexID&2); gl_Position=vec4(p*2.0-1.0,0.0,1.0); }`;

const SCENE = `#version 300 es
precision highp float;
uniform vec2 uRes; uniform float uPx, uTime;
uniform vec2 uVP; uniform float uSpeed, uRmax; uniform vec4 uOff, uLen; uniform vec3 uTint;
uniform vec3 uCirc; uniform float uEarthA, uD; uniform mat3 uB; uniform vec3 uSun; uniform vec4 uHas;
uniform sampler2D uLights, uDay, uClouds, uEuro, uSky; uniform vec4 uEuroBox;
uniform mat3 uSkyM; uniform float uStarA, uDens;
uniform float uBloom, uPre; uniform vec2 uBloomPt;
uniform vec4 uMoonS; uniform vec2 uMoonV; uniform float uMoonSpin; uniform sampler2D uMoonT;
uniform float uNeb, uNebOff;
/* the docs' flight: the 3D galaxy, drawn beforehand at half size (GAL), its share of the sky, and how far it has come
   to the docs page's own view (dimmer down the middle, where the words go) */
uniform sampler2D uGalTex; uniform float uG3, uGalPage; uniform mat3 uGCamR;
/* the docs' constellations igniting at the end: x, y, size, intensity; and their colours */
uniform vec4 uCS[64]; uniform vec3 uCC[64]; uniform int uCN;
out vec4 o;
const float PI=3.14159265, TAU=6.2831853;
float hash13(vec3 p){p=fract(p*0.1031);p+=dot(p,p.zyx+31.32);return fract((p.x+p.y)*p.z);}
float hash12(vec2 p){return hash13(vec3(p,7.31));}
float vnoise(vec3 p){
  vec3 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
  return mix(mix(mix(hash13(i),hash13(i+vec3(1,0,0)),f.x),mix(hash13(i+vec3(0,1,0)),hash13(i+vec3(1,1,0)),f.x),f.y),
             mix(mix(hash13(i+vec3(0,0,1)),hash13(i+vec3(1,0,1)),f.x),mix(hash13(i+vec3(0,1,1)),hash13(i+vec3(1,1,1)),f.x),f.y),f.z);
}
float fbm3(vec3 p){ float s=0.0,a=0.5; for(int i=0;i<5;i++){ s+=a*vnoise(p); p=p*2.03+vec3(1.7,9.2,3.1); a*=0.5; } return s; }

/* ── the sky ── */
vec3 stars(vec3 d,float f){
  vec3 c=vec3(0.0); float pxA=1.0/f;
  for(int i=0;i<3;i++){
    float fi=float(i), sc=(i==0?24.0:i==1?80.0:240.0);
    vec3 g=d*sc, id=floor(g);
    float h1=hash13(id+fi*31.0), h2=hash13(id.yzx+fi*17.0+5.0), h3=hash13(id.zxy+fi*13.0+11.0);
    vec3 sp=normalize((id+0.3+0.4*vec3(h1,h2,hash13(id+7.0+fi)))/sc);
    float px=acos(clamp(dot(d,sp),-1.0,1.0))/pxA;
    float base=i==0?0.6:i==1?0.55:0.45;
    float keep=step(mix(i==0?0.82:0.97,base,uDens),h3);
    float m=(i==0?0.6+pow(h1,3.0)*6.0:i==1?0.25+pow(h2,3.0)*1.5:0.08+0.3*h2)*keep;
    float tint=fract(h1*13.7+h2*7.1);
    vec3 col=tint<0.25?vec3(0.66,0.76,1.0):tint<0.6?vec3(1.0,0.97,0.94):tint<0.85?vec3(1.0,0.87,0.7):vec3(1.0,0.7,0.52);
    c+=col*m*exp(-px*px*1.6);
  }
  return c;
}
vec3 sky(vec2 css){
  float f=uRes.y/uPx*0.95;
  vec3 d=normalize(vec3((css.x-uRes.x/uPx*0.5)/f,(uRes.y/uPx*0.5-css.y)/f,1.0));
  vec3 s=uSkyM*d;
  vec2 uv=vec2(atan(s.x,s.z)/TAU+0.5,0.5-asin(clamp(s.y,-1.0,1.0))/PI);
  /* the night itself: black, with only the faintest warmth of the galaxy's own light */
  vec3 c=vec3(0.0011,0.0010,0.0010);
  if(uHas.w>0.5) c+=pow(texture(uSky,uv).rgb,vec3(2.2))*0.055;
  c+=stars(s,f*uPx)*0.16*uStarA;
  return c;
}
/* the docs' constellations, lit one by one: each star a hot white core in its figure's colour, a glow round it,
   the brightest with a fine cross; flaring as it lights and settling to the page's own */
vec3 ignite(vec2 css){
  vec3 acc=vec3(0.0); float H=uRes.y/uPx, reach=H*0.14;
  for(int i=0;i<64;i++){
    if(i>=uCN) break;
    vec4 st=uCS[i]; if(st.w<=0.001) continue;
    vec2 d=css-st.xy; float r2=dot(d,d); if(r2>reach*reach) continue;
    float r=sqrt(r2), sz=st.z, win=1.0-smoothstep(reach*0.5,reach,r);
    vec3 col=uCC[i];
    float core=exp(-r2/(sz*sz*1.1));
    float halo=exp(-r/(sz*4.0))*0.22+exp(-r/(sz*12.0))*0.012;
    float spk=sz>2.6?(exp(-abs(d.y)/0.55)*exp(-abs(d.x)/(sz*8.0))+exp(-abs(d.x)/0.55)*exp(-abs(d.y)/(sz*8.0)))*0.3:0.0;
    acc+=(mix(vec3(1.0),col,0.3)*core*5.0+col*(halo+spk)*2.2)*st.w*win;
  }
  return acc;
}

/* ── the streaks: light passing, in four depths, each a ring of lanes about the way ahead ── */
vec3 streaks(vec2 css){
  vec2 p=css-uVP; float r=length(p); if(r<6.0) return vec3(0.0);
  float a=atan(p.y,p.x), u=log(r);
  vec3 acc=vec3(0.0);
  for(int i=0;i<4;i++){
    float z=0.35+0.22*float(i);
    float N=floor(520.0+520.0*float(i));
    float sct=a/TAU*N, s0=floor(sct);
    float du=0.62, off=uOff[i], len=uLen[i];
    for(int k=0;k<2;k++){
      float s=s0+float(k)-(fract(sct)<0.5?1.0:0.0);
      float hs=hash12(vec2(s,float(i)*7.0));
      float aj=(s+0.5+0.6*(hash12(vec2(s,3.1+float(i)))-0.5))/N*TAU;
      float da=a-aj; da=mod(da+PI,TAU)-PI;
      float perp=abs(da)*r;
      float near=clamp(r/uRmax,0.0,1.0);
      float w=(0.45+1.5*near*z)/uPx*uPx;
      if(perp>w*4.0) continue;
      float uu=u-off-hs*du; float cell=floor(uu/du);
      for(int j=0;j<2;j++){
        float cj=cell+float(j);
        float hc=hash13(vec3(s,cj,float(i)));
        if(hc>0.15*mix(0.12,1.0,uDens)) continue;
        float head=off+hs*du+(cj+hash13(vec3(cj,s,9.0+float(i))))*du;
        float L=max(len,w*1.2/r);
        float along=(u-(head-L))/L;
        if(along<0.0||along>1.0+w/(r*L)) continue;
        float tail=pow(clamp(along,0.0,1.0),1.6);
        float core=exp(-perp*perp/(w*w));
        float tcol=hash13(vec3(s,cj,4.0));
        vec3 col=tcol<0.07?uTint:tcol<0.35?vec3(0.72,0.8,1.0):tcol<0.85?vec3(1.0,0.97,0.93):vec3(1.0,0.86,0.7);
        float hb=hash13(vec3(cj,s,17.0+float(i)));
        float bright=(0.2+1.4*near)*(0.35+0.65*z)*(0.25+2.2*hb*hb*hb*hb);
        col*=mix(vec3(1.18,0.92,0.72),vec3(0.86,0.97,1.2),clamp(along,0.0,1.0)*0.85+0.15);
        acc+=col*core*tail*bright*smoothstep(10.0,60.0,r);
      }
    }
  }
  return acc;
}

/* ── the Earth ── */
float chapman(float X,float h,float c){
  float cc=sqrt(X+h), ce=cc*exp(-h);
  if(c>=0.0) return ce/(cc*c+1.0);
  float x0=sqrt(1.0-c*c)*(X+h), c0=sqrt(x0);
  return 2.0*c0*exp(X-x0)-ce/(1.0-cc*c);
}
const vec3 BR=vec3(36.95,86.38,210.9);      /* Rayleigh, per Earth radius */
const float HR=8.0/6371.0, BM=25.46, BMX=28.0, HM=1.2/6371.0, RA=1.0+100.0/6371.0;
const vec3 BO=vec3(0.650,1.881,0.085)*6371.0e-3*0.6;
const vec3 SUNL=vec3(1.0,0.96,0.90)*20.0;
vec3 tauSun(float hh,float mu){
  /* the Earth in the way: no sun */
  float hz=-sqrt(max(0.0,1.0-1.0/((1.0+hh)*(1.0+hh))));
  if(mu<hz) return vec3(1e4);
  return BR*HR*chapman(1.0/HR,hh/HR,mu)+BMX*HM*chapman(1.0/HM,hh/HM,mu)+BO*0.012*chapman(1.0/(15.0/6371.0),max(hh-0.0039,0.0)/(15.0/6371.0),mu);
}
vec2 sph(vec3 ro,vec3 rd,float R){ float b=dot(ro,rd), c=dot(ro,ro)-R*R, d=b*b-c; if(d<0.0) return vec2(-1.0); d=sqrt(d); return vec2(-b-d,-b+d); }
vec3 surface(vec3 P,vec3 rd,out float ca){
  float lat=asin(clamp(P.z,-1.0,1.0)), lon=atan(P.y,P.x);
  vec2 uv=vec2(lon/TAU+0.5,0.5-lat/PI);
  float mu=dot(P,uSun);
  vec3 lights=uHas.x>0.5?pow(texture(uLights,uv).rgb,vec3(2.2)):vec3(0.0);
  float dlat=degrees(lat), dlon=degrees(lon);
  if(uHas.y>0.5&&dlon>uEuroBox.x&&dlon<uEuroBox.y&&dlat>uEuroBox.z&&dlat<uEuroBox.w){
    vec2 eu=vec2((dlon-uEuroBox.x)/(uEuroBox.y-uEuroBox.x),(uEuroBox.w-dlat)/(uEuroBox.w-uEuroBox.z));
    float edge=min(min(eu.x,1.0-eu.x),min(eu.y,1.0-eu.y));
    lights=mix(lights,pow(texture(uEuro,eu).rgb,vec3(2.2)),smoothstep(0.0,0.06,edge));
  }
  float cl=uHas.z>0.5?texture(uClouds,uv).r:0.0; ca=smoothstep(0.22,0.85,cl);
  vec3 alb=uHas.z>0.5?pow(texture(uDay,uv).rgb,vec3(2.2)):vec3(0.06,0.07,0.1);
  /* the sun on the ground and on the cloud tops, through the air above them */
  vec3 Ts=exp(-tauSun(0.0,mu)), Tc=exp(-tauSun(8.0/6371.0,mu));
  float lit=smoothstep(-0.02,0.06,mu)*max(mu,0.0)+0.02*smoothstep(-0.05,0.02,mu);
  float clit=smoothstep(-0.04,0.05,mu)*max(mu+0.03,0.0);
  /* the twilight sky's own light, and a little moonlight */
  vec3 tw=vec3(0.25,0.35,0.7)*0.35*exp(min(mu,0.0)*28.0)*step(mu,0.15)+vec3(0.55,0.62,0.78)*0.018;
  vec3 ground=alb*(SUNL*0.4*Ts*lit/PI+tw);
  vec3 cloud=vec3(0.85)*(SUNL*0.3*Tc*clit/PI+tw*1.3);
  float night=1.0-smoothstep(-0.12,0.02,mu);
  vec3 c=mix(ground,cloud,ca)+lights*0.9*night*(1.0-0.8*ca)+lights*0.12*night*ca;
  return c;
}
vec3 earth(vec2 css,out float cover){
  cover=0.0;
  vec2 d=vec2(css.x-uCirc.x,uCirc.y-css.y)/uCirc.z;
  float F=sqrt(uD*uD-1.0);
  vec3 rd=normalize(uB*vec3(d.x,d.y,F)), ro=-uB[2]*uD;
  vec3 L=vec3(0.0), T=vec3(1.0);
  vec2 ta=sph(ro,rd,RA), tg=sph(ro,rd,1.0);
  bool ground=tg.x>0.0;
  float t1=ground?tg.x:ta.y;
  if(ta.y>0.0){
    float t0=max(ta.x,0.0);
    const int N=16; float ds=(t1-t0)/float(N);
    float j=0.5+0.6*(hash13(vec3(gl_FragCoord.xy,uTime*31.0))-0.5);
    float mv=dot(rd,uSun), pr=3.0/(16.0*PI)*(1.0+mv*mv), g=0.8, pm=(1.0-g*g)/(4.0*PI*pow(1.0+g*g-2.0*g*mv,1.5));
    for(int i=0;i<N;i++){
      vec3 x=ro+rd*(t0+ds*(float(i)+j)); float r=length(x), hh=r-1.0;
      float dr=exp(-hh/HR), dm=exp(-hh/HM);
      vec3 ext=BR*dr+BMX*dm;
      vec3 Tsun=exp(-tauSun(hh,dot(x/r,uSun)));
      vec3 ins=(BR*dr*pr+BM*dm*pm)*Tsun*SUNL+BR*dr*SUNL*0.012*exp(min(dot(x/r,uSun),0.0)*38.0);
      vec3 st=exp(-ext*ds);
      L+=T*ins*(1.0-st)/max(ext,vec3(1e-6)); T*=st;
    }
  }
  if(ground){
    float ca; vec3 P=ro+rd*tg.x;
    L+=T*surface(P,rd,ca);
    /* the edge of the disc, smoothed over a pixel */
    cover=clamp((1.0-length(d))*uCirc.z*uPx+0.5,0.0,1.0);
  }
  /* (the sun itself is the flight's own glow, which matches the door's; this lens would stretch it) */
  return L;
}

/* ── the passage: a nebula streaming past, two depths of it about the way ahead ── */
vec3 nebula(vec2 css,out float dust){
  dust=0.0; if(uNeb<=0.001) return vec3(0.0);
  vec2 p=css-uVP; float r=length(p), a=atan(p.y,p.x), u=log(max(r,1.0));
  vec3 acc=vec3(0.0);
  for(int i=0;i<2;i++){
    float k=i==0?1.5:3.1, sp=i==0?1.0:0.62;
    vec3 q=vec3(cos(a)*k,sin(a)*k,(u-uNebOff*sp)*k*0.85+float(i)*13.0);
    float f=fbm3(q);
    /* filaments: the gas drawn out in threads; knots where it is densest; lanes of dust between */
    float fil=1.0-abs(2.0*vnoise(q*vec3(2.6,2.6,1.3)+3.0)-1.0); fil=fil*fil*fil;
    float d=smoothstep(0.44,0.82,f)*(0.35+0.65*fil);
    float knot=pow(smoothstep(0.62,0.95,f),3.0);
    float lane=smoothstep(0.5,0.75,vnoise(q*vec3(1.8,1.8,0.9)+11.0))*smoothstep(0.35,0.6,f);
    float hue=vnoise(q*0.45+5.0);
    vec3 col=mix(mix(vec3(0.42,0.16,1.0),vec3(1.0,0.22,0.52),smoothstep(0.3,0.68,hue)),vec3(0.16,0.58,0.86),smoothstep(0.66,0.9,hue));
    float near=smoothstep(40.0,uRmax*0.45,r);
    acc+=(col*d*1.2+vec3(1.0,0.86,0.9)*knot*1.6)*(0.3+0.9*near)*(i==0?1.0:0.55)*(1.0-lane*0.8);
    dust+=(d*0.25+lane*0.55)*near;
  }
  dust=clamp(dust*uNeb,0.0,0.7); return acc*uNeb*1.1;
}

/* ── the moon passed on the way out: the install's gold moon, growing as it sweeps by ── */
vec4 moonAt(vec2 css){
  vec2 d=(css-uMoonS.xy)/uMoonS.z; float rr=dot(d,d); if(rr>1.0) return vec4(0.0);
  vec3 n=vec3(d.x,-d.y,sqrt(1.0-rr));
  float cs=cos(uMoonSpin), sn=sin(uMoonSpin); vec3 m=vec3(cs*n.x+sn*n.z,n.y,-sn*n.x+cs*n.z);
  vec2 uv=vec2(atan(m.x,m.z)/TAU+0.5,0.5-asin(clamp(m.y,-1.0,1.0))/PI);
  vec3 alb=pow(texture(uMoonT,uv).rgb,vec3(2.2)); float l=dot(alb,vec3(0.2126,0.7152,0.0722)); alb=mix(vec3(l),alb,0.5);
  vec3 L=normalize(vec3(-0.25,-0.8,-0.15));
  float lit=smoothstep(-0.05,0.25,dot(n,L))*max(dot(n,L),0.0);
  vec3 c=alb*SUNL*lit*0.7+alb*0.006;
  float cov=clamp((1.0-sqrt(rr))*uMoonS.z*uPx+0.5,0.0,1.0);
  return vec4(c*cov,cov);
}
vec4 moon(vec2 css){
  if(uMoonS.w<=0.0||length(css-uMoonS.xy)>uMoonS.z+length(uMoonV)+2.0) return vec4(0.0);
  vec4 acc=vec4(0.0);
  /* its blur over the exposure: twelve fixed steps, so the edges are steady frame to frame */
  for(int i=0;i<12;i++) acc+=moonAt(css+uMoonV*((float(i)+0.5)/12.0-0.5));
  return acc/12.0*uMoonS.w;
}

/* ── the star at the end: seen ahead as the flight brakes, then blooming ──
   Built as a star is seen through a lens: a limb-darkened photosphere with its granulation and a red chromosphere at
   the rim; a corona of streamers drifting outwards; the ciliary glare, hundreds of hair-fine rays fringed with colour;
   six diffraction spikes, banded along their length, the red reaching furthest; a level anamorphic streak; a faint
   rainbow halo. All of it HDR, so the film's bloom carries it. */
vec3 arrival(vec2 css){
  float e=pow(uBloom,1.2), lum=e+uPre*0.3;
  if(lum<=0.001) return vec3(0.0);
  vec2 p=css-uBloomPt; float r=length(p), H=uRes.y/uPx, Wd=uRes.x/uPx, a=atan(p.y,p.x);
  vec2 dir=r>0.0?p/r:vec2(1.0,0.0);
  float Rd=H*(0.004+0.065*e);                        /* the star's disc */
  vec3 c=vec3(0.0);
  /* the photosphere: limb-darkened, granulated, white-gold at the centre, deeper gold at the limb */
  if(r<Rd){
    float x=r/Rd, mu=sqrt(1.0-x*x);
    /* granules: bright cells parted by darker lanes, the cells foreshortened towards the limb */
    vec2 q=p/(Rd*0.075); q+=(p/max(r,1e-3))*dot(p/max(r,1e-3),q)*(1.0/max(mu,0.25)-1.0)*0.5;
    float g1=1.0-abs(vnoise(vec3(q,uTime*0.5))*2.0-1.0), g2=1.0-abs(vnoise(vec3(q*2.7+7.0,uTime*0.9))*2.0-1.0);
    float gran=smoothstep(0.25,0.95,g1*0.7+g2*0.3);
    float I=(1.0-0.66*(1.0-mu)-0.1*(1.0-mu*mu))*(0.84+0.28*gran);
    /* bright, but held within the film's range, so its surface reads: the cells, the darkening to the limb */
    c+=mix(vec3(1.0,0.46,0.14),vec3(1.0,0.89,0.7),pow(mu,0.6))*I*mix(16.0,4.2,smoothstep(0.0,0.35,e))*lum;
  }
  /* the chromosphere: a thin red rim */
  c+=vec3(1.0,0.4,0.18)*exp(-pow((r-Rd)/(Rd*0.025+0.5),2.0))*mix(3.0,1.2,smoothstep(0.0,0.4,e))*lum;
  /* the corona: streamers in two scales, drifting outwards and turning slowly, white-gold to amber to a faint violet */
  float lr=log(max(r,Rd)/Rd);
  float n1=vnoise(vec3(cos(a)*5.0,sin(a)*5.0,lr*1.4-uTime*0.12)), n2=vnoise(vec3(cos(a)*17.0,sin(a)*17.0,lr*2.6-uTime*0.2+3.0));
  float stream=0.35+1.1*n1*n1+0.55*n2*n2*n2;
  vec3 ccol=mix(mix(vec3(1.0,0.93,0.8),vec3(1.0,0.66,0.32),smoothstep(0.0,1.6,lr)),vec3(0.62,0.42,0.9),smoothstep(1.8,3.6,lr));
  c+=ccol*stream*pow(Rd/max(r,Rd),1.7)*2.6*lum*smoothstep(Rd*0.98,Rd*1.05,r);
  /* the ciliary glare: hair-fine rays of every length about the core, two sets, fringed with colour at their tips */
  for(int k=0;k<2;k++){
    float N=k==0?211.0:137.0, sa=a/TAU*N+float(k)*0.37, id=floor(sa);
    float h1=hash12(vec2(id,float(k)*7.0)), h2=hash12(vec2(id+3.0,float(k)*13.0));
    float perp=abs(fract(sa)-0.5)*(TAU/N)*r;
    float L=H*(0.03+0.32*h1*h1*h1)*(0.35+0.85*e);
    float t=r/L;
    vec3 tip=mix(vec3(0.85,0.92,1.0),vec3(1.0,0.75,0.55),smoothstep(0.3,1.2,t));
    c+=tip*exp(-perp*perp/0.45)*exp(-t*2.2)*smoothstep(Rd*0.6,Rd*1.4,r)*(0.25+h2*1.4)*1.6*lum;
  }
  /* the diffraction spikes: six, banded, dispersed (each colour reaching its own length, the red the furthest) */
  for(int k=0;k<3;k++){
    float an=0.52+float(k)*PI/3.0;
    vec2 ax=vec2(cos(an),sin(an));
    float al=abs(dot(p,ax)), pe=abs(dot(p,vec2(-ax.y,ax.x)));
    float len=H*(0.05+0.24*e), w=0.7+al*0.003;
    vec3 L3=len*vec3(1.0,0.86,0.72);
    vec3 spike=exp(-pow(vec3(al)/L3,vec3(1.6)))*exp(-pe*pe/(w*w));
    float band=0.7+0.3*pow(sin(al/(H*0.012)),2.0);
    c+=spike*band*(1.0-exp(-al/(Rd*2.0+4.0)))*2.4*lum;
  }
  /* and two faint secondary spikes, the support's, square to the rest */
  { vec2 ax=vec2(cos(0.52+PI*0.5/3.0),sin(0.52+PI*0.5/3.0)); float al=abs(dot(p,ax)), pe=abs(dot(p,vec2(-ax.y,ax.x)));
    c+=vec3(0.9,0.92,1.0)*exp(-pow(al/(H*(0.03+0.12*e)),1.6))*exp(-pe*pe/0.5)*0.5*lum; }
  /* the anamorphic streak: a thin hot core and a wide cool veil */
  c+=vec3(0.5,0.68,1.0)*exp(-abs(p.y)/1.2)*exp(-abs(p.x)/(Wd*(0.05+0.42*e)))*1.3*lum;
  c+=vec3(0.32,0.45,1.0)*exp(-abs(p.y)/(H*0.012))*exp(-abs(p.x)/(Wd*(0.08+0.3*e)))*0.22*lum;
  /* a lens halo: a faint ring, each colour at its own radius */
  float rh=H*(0.11+0.12*e);
  c+=vec3(exp(-pow((r-rh*0.965)/(H*0.005),2.0)),exp(-pow((r-rh)/(H*0.005),2.0)),exp(-pow((r-rh*1.035)/(H*0.005),2.0)))*0.14*lum;
  /* the sky takes the light: a wide warm scatter */
  c+=vec3(1.0,0.8,0.52)*exp(-r/(H*0.45))*0.16*lum+vec3(1.0,0.82,0.6)*exp(-max(r-Rd,0.0)/(H*0.05))*0.7*lum*smoothstep(Rd*0.9,Rd*1.1,r);
  return c;
}

/* the shockwave of the arrival: a ring running outwards that bends the starlight it crosses */
vec2 shockBend(vec2 css,out float ring){
  ring=0.0; if(uBloom<=0.0||uBloom>=1.0) return css;
  vec2 p=css-uBloomPt; float r=length(p), H=uRes.y/uPx;
  float rs=uBloom*H*1.25, w=H*0.03, fade=1.0-uBloom;
  float g=exp(-pow((r-rs)/w,2.0));
  ring=g*fade;
  return css-(r>0.0?p/r:vec2(0.0))*g*w*0.8*fade*sign(r-rs+0.0001);
}

void main(){
  vec2 css=vec2(gl_FragCoord.x,uRes.y-gl_FragCoord.y)/uPx;
  float ring; vec2 bent=shockBend(css,ring);
  vec3 c=uG3<0.999?sky(bent):vec3(0.0);
  if(uG3>0.001){
    vec3 gv=texture(uGalTex,gl_FragCoord.xy/uRes).rgb;
    float mid=exp(-pow((css.x/(uRes.x/uPx)-0.5)/0.2,2.0));
    /* behind it, the far sky: a sparse field of stars, turning with the camera */
    float f=uRes.y/uPx*0.95;
    vec3 dv=uGCamR*normalize(vec3((css.x-uRes.x/uPx*0.5)/f,(uRes.y/uPx*0.5-css.y)/f,1.0));
    vec3 far=stars(dv,f*uPx)*0.07*(1.0-0.5*uGalPage);
    c=mix(c,vec3(0.0011,0.001,0.001)+far+gv*(1.0-0.55*mid*uGalPage),uG3);
  }
  /* the way ahead: a faint light on the vanishing point, more of it the faster */
  float rv=length(css-uVP), dg=length(uRes/uPx);
  float sp=abs(uSpeed);
  c+=vec3(0.2,0.19,0.17)*sp*0.08*exp(-rv/(dg*0.45));
  float dust; vec3 neb=nebula(css,dust);
  /* inside the galaxy its own stars are the streaks: the lanes are not drawn there at all */
  if(uG3<0.999) c=c*(1.0-dust)+streaks(css)*mix(0.45,1.0,uDens)*(1.0-dust*0.6)*(1.0-uG3)+neb;
  /* the doppler: cool ahead, warm at the edges, only at the fastest */
  float dp=pow(max(sp-0.55,0.0)/0.45,2.0);
  c*=mix(vec3(1.0),mix(vec3(0.95,0.98,1.08),vec3(1.12,0.97,0.88),smoothstep(0.2,0.9,rv/dg)),dp*0.5);
  if(uEarthA>0.0){
    float cov; vec3 e=earth(css,cov);
    c=mix(c,vec3(0.0),cov*uEarthA)+e*uEarthA;
  }
  vec4 mo=moon(css); c=c*(1.0-mo.a)+mo.rgb;
  c+=arrival(css);
  if(uCN>0) c+=ignite(css);
  /* the shock's own light: a bright edge, red outside and blue in */
  if(ring>0.001){
    vec2 p=css-uBloomPt; float r=length(p), H=uRes.y/uPx, rs=uBloom*H*1.25, w=H*0.006;
    vec3 band=vec3(exp(-pow((r-rs-w*0.5)/w,2.0)),exp(-pow((r-rs)/w,2.0)),exp(-pow((r-rs+w*0.5)/w,2.0)));
    c+=mix(vec3(dot(band,vec3(0.34))),band,0.35)*vec3(1.0,0.86,0.66)*0.32*(1.0-uBloom)*(1.0-uBloom);
  }
  o=vec4(c,1.0);
}`;

const DOWN = `#version 300 es
precision highp float;
uniform sampler2D uSrc; uniform vec2 uTexel, uOut; uniform float uFirst; out vec4 o;
vec3 s(vec2 uv){ vec3 c=texture(uSrc,uv).rgb; if(uFirst>0.5){ float l=max(c.r,max(c.g,c.b)); c*=max(l-0.9,0.0)/max(l,1e-4); } return c; }
void main(){ vec2 uv=gl_FragCoord.xy/uOut, t=uTexel;
  vec3 a=s(uv+t*vec2(-2,2)),b=s(uv+t*vec2(0,2)),c=s(uv+t*vec2(2,2)),d=s(uv+t*vec2(-2,0)),e=s(uv),f=s(uv+t*vec2(2,0)),g=s(uv+t*vec2(-2,-2)),h=s(uv+t*vec2(0,-2)),i=s(uv+t*vec2(2,-2)),j=s(uv+t*vec2(-1,1)),k=s(uv+t*vec2(1,1)),l=s(uv+t*vec2(-1,-1)),m=s(uv+t*vec2(1,-1));
  o=vec4(e*0.125+(a+c+g+i)*0.03125+(b+d+f+h)*0.0625+(j+k+l+m)*0.125,1.0); }`;
const UPS = `#version 300 es
precision highp float;
uniform sampler2D uSrc; uniform vec2 uTexel, uOut; out vec4 o;
void main(){ vec2 uv=gl_FragCoord.xy/uOut, t=uTexel;
  vec3 r=texture(uSrc,uv).rgb*4.0;
  r+=(texture(uSrc,uv+vec2(-t.x,0)).rgb+texture(uSrc,uv+vec2(t.x,0)).rgb+texture(uSrc,uv+vec2(0,-t.y)).rgb+texture(uSrc,uv+vec2(0,t.y)).rgb)*2.0;
  r+=texture(uSrc,uv-t).rgb+texture(uSrc,uv+t).rgb+texture(uSrc,uv+vec2(t.x,-t.y)).rgb+texture(uSrc,uv+vec2(-t.x,t.y)).rgb;
  o=vec4(r/16.0,1.0); }`;
/* the film: bloom laid in, the door's own tone curve (so the Earth here is the Earth there), grain */
const FILM = `#version 300 es
precision highp float;
uniform sampler2D uHdr, uBloom; uniform vec2 uRes; uniform float uTime, uExpo; out vec4 o;
float hash13(vec3 p){p=fract(p*0.1031);p+=dot(p,p.zyx+31.32);return fract((p.x+p.y)*p.z);}
void main(){
  vec2 uv=gl_FragCoord.xy/uRes;
  vec2 r=uv-0.5; float f=0.004*dot(r,r);
  vec3 c=vec3(texture(uHdr,uv+r*f).r,texture(uHdr,uv).g,texture(uHdr,uv-r*f).b);
  c+=texture(uBloom,uv).rgb*0.22;
  c=1.0-exp(-max(c,0.0)*uExpo);
  float l=dot(c,vec3(0.2126,0.7152,0.0722)); c=max(mix(vec3(l),c,1.08),0.0);
  c=pow(c,vec3(1.0/2.2));
  float gr=hash13(vec3(gl_FragCoord.xy,floor(uTime*24.0)))+hash13(vec3(gl_FragCoord.yx*1.7,floor(uTime*24.0)+3.0))-1.0;
  c+=gr*0.03*(0.2+3.0*l*(1.0-l))+(hash13(vec3(gl_FragCoord.xy,uTime*60.0))-0.5)/255.0;
  o=vec4(c,1.0);
}`;

/* ── THE GALAXY, for the docs' flight: a spiral of stars, gas and dust in three dimensions, seen by a camera that
   flies at it from outside, dives into an arm and comes to rest inside the disc looking at the core, where it is the
   Milky Way's band across the sky. Galaxy space: the disc in x–z, y up, its radius about 1. Drawn at half the
   frame's size by marching each ray through the disc's slab: light given off by the stars (gold in the bulge,
   blue-white along the arms, pink where hydrogen glows) and taken away by the dust (in lanes on the arms' inner
   edges, in filaments) — front to back, jittered so the steps never band. The stars themselves are points
   (STARV below), so they pass with their true parallax. ── */
const GAL = `#version 300 es
precision highp float;
uniform vec2 uRes; uniform vec3 uCamP; uniform mat3 uCamR; uniform float uF, uTime, uGain;
out vec4 o;
float hash13(vec3 p){p=fract(p*0.1031);p+=dot(p,p.zyx+31.32);return fract((p.x+p.y)*p.z);}
float vnoise(vec3 p){
  vec3 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
  return mix(mix(mix(hash13(i),hash13(i+vec3(1,0,0)),f.x),mix(hash13(i+vec3(0,1,0)),hash13(i+vec3(1,1,0)),f.x),f.y),
             mix(mix(hash13(i+vec3(0,0,1)),hash13(i+vec3(1,0,1)),f.x),mix(hash13(i+vec3(0,1,1)),hash13(i+vec3(1,1,1)),f.x),f.y),f.z);
}
/* two arms, a logarithmic spiral about 18 degrees open, with a phase to shift along them */
float arm(vec3 p,float off,float k){
  float r=length(p.xz), th=atan(p.z,p.x), ph=th-log(max(r,0.03))*3.1+off;
  return pow(0.5+0.5*cos(2.0*ph),k);
}
vec4 field(vec3 p){
  float r=length(p.xz), y=p.y;
  float n=vnoise(p*6.0), n2=vnoise(p*vec3(24.0,48.0,24.0)+3.0), n3=vnoise(p*vec3(64.0,90.0,64.0)+9.0);
  /* the arms, their line worried by the noise, so they break into spurs and feathers */
  vec3 q=p+vec3(n-0.5,0.0,n2-0.5)*0.07;
  float a=arm(q,0.0,4.0), a4=arm(q*1.0,1.2,6.0)*0.35;
  float vert=exp(-abs(y)/0.028);
  float disc=exp(-r/0.36)*vert*smoothstep(1.3,0.8,r);
  float bul=exp(-(r*r+y*y*3.2)/0.012);
  /* the light: a faint old disc, the arms bright with young stars in clumps, the bulge gold */
  float clump=0.35+1.5*n2*n3+0.4*n3*n3;
  float young=disc*(a+a4)*clump;
  vec3 em=vec3(1.0,0.84,0.64)*disc*(0.16+0.18*n)+vec3(0.72,0.84,1.0)*young*2.4+vec3(1.0,0.78,0.5)*bul*5.0;
  /* hydrogen: pink knots strung along the arms */
  em+=vec3(1.0,0.3,0.42)*smoothstep(0.66,0.9,n2*0.55+n3*0.55)*young*5.0;
  /* dust: a thin layer, dark lanes on the arms' inner edges, torn into filaments */
  float ad=arm(q,-0.55,3.0);
  float fil=1.0-abs(2.0*n3-1.0);
  float dust=exp(-r/0.55)*exp(-abs(y)/0.009)*smoothstep(1.2,0.55,r)*(0.1+2.4*ad)*smoothstep(0.3,0.75,n*0.4+n2*0.3+fil*0.3+ad*0.2);
  return vec4(em,dust*65.0);
}
void main(){
  vec2 uv=gl_FragCoord.xy;
  vec3 ro=uCamP, rd=normalize(uCamR*vec3((uv.x-uRes.x*0.5)/uF,(uv.y-uRes.y*0.5)/uF,1.0));
  /* only the slab of the disc is marched: where the ray is in it */
  const float SL=0.16;
  float t0=0.0, t1=60.0;
  if(abs(rd.y)>1e-4){ float ta=(-SL-ro.y)/rd.y, tb=(SL-ro.y)/rd.y; t0=max(0.0,min(ta,tb)); t1=min(t1,max(ta,tb)); }
  else if(abs(ro.y)>SL){ o=vec4(0.0); return; }
  /* and inside the disc's reach */
  float b=dot(ro.xz,rd.xz), aa=dot(rd.xz,rd.xz), c=dot(ro.xz,ro.xz)-1.45*1.45, d=b*b-aa*c;
  if(d<0.0){ o=vec4(0.0); return; }
  d=sqrt(d); t0=max(t0,(-b-d)/aa); t1=min(t1,(-b+d)/aa);
  if(t1<=t0){ o=vec4(0.0); return; }
  float span=t1-t0, jit=hash13(vec3(uv,fract(uTime)*97.0));
  vec3 col=vec3(0.0); float T=1.0, t=t0;
  for(int i=0;i<52;i++){
    float dt=clamp(t*0.085,0.006,span/34.0+0.004);
    float ts=t+dt*jit;
    if(ts>t1||T<0.015) break;
    vec4 f=field(ro+rd*ts);
    /* close by, the disc is its stars (the points), not a glow: the light fades in with distance, so the camera
       inside the disc sees the band, not a fog */
    f.rgb*=smoothstep(0.04,0.45,ts); f.a*=smoothstep(0.005,0.08,ts);
    col+=T*f.rgb*dt; T*=exp(-f.a*dt);
    t+=dt;
  }
  o=vec4(col*uGain,1.0-T);
}`;
/* the galaxy's stars: each a point in galaxy space, drawn as the short streak it makes between the last frame's
   camera and this one (its light shared along it), or as a soft point; brighter as it is nearer */
const STARV = `#version 300 es
layout(location=0) in vec4 aP; layout(location=1) in vec3 aC;
uniform vec3 uCamP, uPrevP; uniform mat3 uCamR, uPrevR; uniform vec2 uRes; uniform float uF, uK, uPts;
out vec3 vC;
void main(){
  bool odd=(gl_VertexID&1)==1;
  vec3 qc=transpose(uCamR)*(aP.xyz-uCamP), qp=transpose(uPrevR)*(aP.xyz-uPrevP);
  if(qc.z<0.003||qp.z<0.003||(odd&&uPts>0.5)){ gl_Position=vec4(2.0,2.0,2.0,1.0); vC=vec3(0.0); gl_PointSize=1.0; return; }
  vec2 sc=qc.xy/qc.z*uF, sp=qp.xy/qp.z*uF;
  vec2 s=odd?sp:sc;
  gl_Position=vec4(s/(uRes*0.5),0.0,1.0);
  float br=aP.w*uK/(qc.z*qc.z+0.0006);
  /* a star deep in the disc and far off is seen through the dust, as the glow is: dimmed with its distance */
  br*=exp(-length(aP.xyz-uCamP)*3.2*exp(-abs(aP.y)/0.02)*smoothstep(1.25,0.6,length(aP.xz)));
  float len=length(sc-sp);
  vC=aC*min(br,24.0)/(1.0+len*0.8);
  gl_PointSize=uPts>0.5?clamp(1.0+sqrt(min(br,24.0))*0.45,1.0,3.6):1.0;
}`;
const STARF = `#version 300 es
precision highp float;
uniform float uPts; in vec3 vC; out vec4 o;
void main(){ vec2 d=gl_PointCoord-0.5; float a=uPts>0.5?exp(-dot(d,d)*14.0):1.0; o=vec4(vC*a,1.0); }`;
/* the galaxy's stars, made once: most in the disc and thickest along the arms, some in the bulge, and a cloud of
   them about the place the flight comes to rest, so there are stars close by to pass */
const REST = [0.56, 0, 0];
function galaxyStars(n) {
  let sd = 4242; const rnd = () => (sd = (sd * 16807) % 2147483647) / 2147483647;
  const gauss = () => Math.sqrt(-2 * Math.log(rnd() + 1e-9)) * Math.cos(6.2832 * rnd());
  const P = new Float32Array(n * 2 * 4), C = new Float32Array(n * 2 * 3);
  for (let i = 0; i < n; i++) {
    let x, y, z, col, w;
    const kind = rnd();
    if (kind < 0.8) {
      /* the disc, along the arms */
      let r, th, tries = 0;
      do { r = Math.min(1.25, -Math.log(rnd() + 1e-9) * 0.33 + 0.04); th = rnd() * 6.2832; tries++; }
      while (tries < 8 && rnd() > Math.pow(0.5 + 0.5 * Math.cos(2 * (th - Math.log(Math.max(r, 0.03)) * 3.1)), 2) * 0.85 + 0.15);
      x = r * Math.cos(th); z = r * Math.sin(th); y = gauss() * 0.04;
      const yb = rnd(); col = yb < 0.35 ? [0.7, 0.8, 1] : yb < 0.8 ? [1, 0.97, 0.92] : [1, 0.82, 0.62];
      w = 0.25 + Math.pow(rnd(), 6) * 3;
    } else if (kind < 0.93) {
      /* the bulge */
      x = gauss() * 0.09; z = gauss() * 0.09; y = gauss() * 0.055;
      col = rnd() < 0.7 ? [1, 0.85, 0.62] : [1, 0.72, 0.5]; w = 0.3 + Math.pow(rnd(), 5) * 2;
    } else {
      /* the neighbourhood the flight comes to */
      const rr = Math.pow(rnd(), 0.5) * 0.22;
      const u = rnd() * 2 - 1, ph = rnd() * 6.2832, sq = Math.sqrt(1 - u * u);
      x = REST[0] + rr * sq * Math.cos(ph); z = REST[2] + rr * sq * Math.sin(ph); y = REST[1] + rr * u * 0.35;
      const yb = rnd(); col = yb < 0.25 ? [0.72, 0.8, 1] : yb < 0.7 ? [1, 0.97, 0.93] : yb < 0.92 ? [1, 0.86, 0.68] : [1, 0.62, 0.45];
      w = 0.04 + Math.pow(rnd(), 9) * 0.6;
    }
    for (let k = 0; k < 2; k++) { P.set([x, y, z, w], (i * 2 + k) * 4); C.set(col, (i * 2 + k) * 3); }
  }
  return { P, C };
}

/* the door's camera (tools/dawn.py): over the Atlantic, facing the sunrise over Europe */
const RE = 6371, ALT = 800, LAT = 46, LON = -27, HEAD = 72, SUN_UNDER = 0.15;
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const norm = (a) => mul(a, 1 / Math.hypot(...a));
function doorCamera() {
  const r = Math.PI / 180, la = LAT * r, lo = LON * r, hd = HEAD * r;
  const Z = [Math.cos(la) * Math.cos(lo), Math.cos(la) * Math.sin(lo), Math.sin(la)];
  const E = [-Math.sin(lo), Math.cos(lo), 0], N = cross(Z, E);
  const H = add(mul(N, Math.cos(hd)), mul(E, Math.sin(hd))), R = cross(H, Z);
  const D0 = (RE + ALT) / RE, F = 3000 / Math.tan(Math.asin(1 / D0));
  /* the sun: the horizon point it rises at, turned SUN_UNDER degrees under it */
  const sd = norm(add(add(mul(R, 0), mul(H, 3000)), mul(Z, -F)));
  const ax = norm(cross(sd, mul(Z, -1))), a = SUN_UNDER * r;
  const S = norm(add(add(mul(sd, Math.cos(a)), mul(cross(ax, sd), Math.sin(a))), mul(ax, dot(ax, sd) * (1 - Math.cos(a)))));
  return { B: [...R, ...H, ...mul(Z, -1)], S, D0 };
}

export function createVoyage(under) {
  if (typeof document === "undefined" || !under?.parentNode) return null;
  const canvas = document.createElement("canvas");
  canvas.id = "warpgl"; canvas.setAttribute("aria-hidden", "true");
  const gl = canvas.getContext("webgl2", { antialias: false, alpha: false, depth: false, powerPreference: "high-performance" });
  if (!gl || !gl.getExtension("EXT_color_buffer_float")) return null;
  gl.getExtension("OES_texture_float_linear");
  under.parentNode.insertBefore(canvas, under);

  const shader = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
  const vs = shader(gl.VERTEX_SHADER, VERT);
  const program = (src) => {
    const p = gl.createProgram(); gl.attachShader(p, vs); gl.attachShader(p, shader(gl.FRAGMENT_SHADER, src)); gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    const u = {}; const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < n; i++) { const a = gl.getActiveUniform(p, i); u[a.name.replace(/\[0\]$/, "")] = gl.getUniformLocation(p, a.name); }
    return { p, u };
  };
  let P;
  const programVF = (vsrc, fsrc) => {
    const p = gl.createProgram(); gl.attachShader(p, shader(gl.VERTEX_SHADER, vsrc)); gl.attachShader(p, shader(gl.FRAGMENT_SHADER, fsrc)); gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    const u = {}; const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < n; i++) { const a = gl.getActiveUniform(p, i); u[a.name.replace(/\[0\]$/, "")] = gl.getUniformLocation(p, a.name); }
    return { p, u };
  };
  try { P = { scene: program(SCENE), down: program(DOWN), up: program(UPS), film: program(FILM), gal: program(GAL), stars: programVF(STARV, STARF) }; }
  catch (e) { console.warn(e); canvas.remove(); return null; }
  const vao = gl.createVertexArray();

  const tex = (w, h, fmt, f, type, data = null) => {
    const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, fmt, w, h, 0, f, type, data);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  };
  const target = (w, h) => { const t = tex(w, h, gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT); const f = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, f); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0); return { t, f, w, h }; };

  /* the maps: asked for a little after the page is up, each used as soon as it has come */
  const maps = {};
  const load = (key) => fetch(TEX[key]).then((r) => (r.ok ? r.blob() : Promise.reject(r.status)))
    .then((b) => createImageBitmap(b, { colorSpaceConversion: "none", premultiplyAlpha: "none" }))
    .then((bm) => {
      const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, bm);
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, key === "euro" ? gl.CLAMP_TO_EDGE : gl.REPEAT);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      maps[key] = t;
    }).catch(() => { /* drawn without it */ });
  /* the maps, the warm-up and the measure, asked for once (main.js asks while the door is quiet); `ready` says when */
  let warming = null;
  function warm() {
    try { makeStars(); } catch { /* drawn without them */ }
    if (!warming) warming = Promise.all(["sky", "lights", "euro", "clouds", "day", "moon"].map(load))
      .then(() => new Promise((r) => setTimeout(r, 50))).then(() => calibrate());
    return warming;
  }
  /* once everything has come, a few frames drawn unseen at the heaviest point of the flight (the nebula, the streaks
     at full speed): the shaders compiled and the maps on the GPU before the first flight, rather than during it,
     and the drawing's size chosen so a frame takes about 11 ms here */
  function calibrate() {
    if (document.hidden || (lastDraw && performance.now() - lastDraw < 5000)) return;
    if (W < 2) resize(innerWidth, innerHeight);
    const st = { t: 1900, v: 1, K: 7.4, vp: [W / 2, -0.55 * H], rmax: Math.hypot(W, H) * 1.55, tint: [1, 0.8, 0.4],
      progress: 0.4, world: null, bloom: 0, tu: 1900, star: true, dt: 0 };
    const sync = () => gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
    try {
      draw(st); draw({ ...st, world: { cx: W / 2, cy: H * 3, R: H * 2.4, alpha: 1, c: 0.1 }, tu: 900 }); sync();
      const t0 = performance.now(); for (let i = 0; i < 3; i++) draw(st); sync();
      const ms = (performance.now() - t0) / 3;
      const next = Math.min(0.9, Math.max(0.4, part * Math.sqrt(11 / Math.max(ms, 1))));
      if (Math.abs(next - part) > 0.02) { part = next; resize(W, H); }
      /* the docs' galaxy, inside the disc where it is heaviest: drawn once to make it ready, then timed */
      if (starVao) {
        const P = [0.8, 0.08, 0.38], f = (() => { const l = Math.hypot(...P); return P.map((x) => -x / l); })();
        const r = (() => { const c = [f[2], 0, -f[0]], l = Math.hypot(...c); return c.map((x) => x / l); })();
        const up = [f[1] * r[2] - f[2] * r[1], f[2] * r[0] - f[0] * r[2], f[0] * r[1] - f[1] * r[0]];
        const g = { ...st, tu: 3000, galaxy3d: { w: 1, P, R: [...r, ...up, ...f], gain: 5.5, starK: 0.09, page: 0 } };
        draw(g); sync();
        const g0 = performance.now(); for (let i = 0; i < 2; i++) draw(g); sync();
        const gms = (performance.now() - g0) / 2;
        /* its share over the rest of the frame: the galaxy pass is drawn smaller until the whole frame fits */
        const nq = Math.min(0.5, Math.max(0.28, gq * Math.sqrt(Math.max(1, 13 - ms * 0.6) / Math.max(1, gms - ms * 0.6))));
        if (Math.abs(nq - gq) > 0.02) { gq = nq; CW = 0; resize(W, H); }
      }
    } catch { /* drawn as it is */ }
    lastDraw = 0;
  }
  const blank = tex(1, 1, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));

  const cam = doorCamera();
  /* gq: the galaxy's own drawing size, as a part of the frame's (measured in calibrate, so it costs about 5 ms) */
  let W = 1, H = 1, part = 0.75, hdr = null, chain = [], frames = [], CW = 0, CH = 0, lastDraw = 0, galT = null, gq = 0.45;
  /* the galaxy's stars, put on the GPU once (warm) */
  let starVao = null, starN = 0;
  function makeStars() {
    if (starVao) return;
    const { P: pos, C: col } = galaxyStars(48000);
    starVao = gl.createVertexArray(); gl.bindVertexArray(starVao);
    const b1 = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b1); gl.bufferData(gl.ARRAY_BUFFER, pos, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 4, gl.FLOAT, false, 0, 0);
    const b2 = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b2); gl.bufferData(gl.ARRAY_BUFFER, col, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null); starN = pos.length / 4;
  }
  /* the streaks' travel, per depth: log radius, integrated from the flight's own speed */
  const off = [0, 0.3, 0.7, 0.15];

  function resize(w, h) {
    W = w; H = h;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    /* the whole frame is moving: drawn at a part of the screen's density, no more than about 1.6 million pixels */
    const px = Math.min(dpr * part, Math.sqrt(1.6e6 / Math.max(1, W * H)));
    const cw = Math.max(1, Math.round(W * px)), ch = Math.max(1, Math.round(H * px));
    canvas.style.width = W + "px"; canvas.style.height = H + "px";
    if (cw === CW && ch === CH) return;
    CW = cw; CH = ch; canvas.width = cw; canvas.height = ch;
    for (const c of [hdr, ...chain]) if (c) { gl.deleteTexture(c.t); gl.deleteFramebuffer(c.f); }
    if (galT) { gl.deleteTexture(galT.t); gl.deleteFramebuffer(galT.f); }
    hdr = target(cw, ch); chain = []; galT = target(Math.max(1, Math.round(cw * gq)), Math.max(1, Math.round(ch * gq)));
    let a = cw, b = ch;
    for (let i = 0; i < 5; i++) { a = Math.max(1, a >> 1); b = Math.max(1, b >> 1); chain.push(target(a, b)); }
  }
  const pass = (prog, fbo, w, h, setup) => {
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo); gl.viewport(0, 0, w, h);
    gl.useProgram(prog.p); gl.bindVertexArray(vao); setup(prog.u); gl.drawArrays(gl.TRIANGLES, 0, 3);
  };
  const bind = (unit, t, loc) => { gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, t); gl.uniform1i(loc, unit); };

  /* the flight's speed moves the streaks: each depth outwards at its own rate */
  let nebOff = 0;
  function advance(v, dt, K) { for (let i = 0; i < 4; i++) off[i] += v * dt * K * (0.35 + 0.22 * i) * 0.55; nebOff += v * dt * K * 0.16; }

  /* s: { t (ms), v (signed speed), K, vp [x,y], rmax, tint [r,g,b], progress (0..1 of the climb),
          world: { cx, cy, R, alpha, c } | null, bloom (0..1), bloomPt [x,y], dt (ms) } */
  function draw(s) {
    if (!hdr) resize(W, H);
    /* the size is never changed mid-flight (a change reallocates every target, and that is a hitch): a slow flight
       is noted, and the next one is drawn smaller, the change made while nothing is flying */
    lastDraw = performance.now();
    if (s.dt) { frames.push(s.dt); if (frames.length === 40) {
      const avg = frames.slice(5).reduce((a, b) => a + b, 0) / 35;
      const next = avg > 26 ? Math.max(0.4, part * 0.82) : avg < 13 ? Math.min(0.9, part * 1.08) : part;
      if (Math.abs(next - part) > 0.02) setTimeout(function later() {
        if (performance.now() - lastDraw < 400) { setTimeout(later, 1000); return; }
        part = next; resize(W, H);
      }, 1000);
    } }
    const px = CW / W;
    const sp = Math.abs(s.v), shutter = 0.016 * (1 + 0.9 * sp * sp);
    const len = [0, 1, 2, 3].map((i) => Math.abs(s.v) * s.K * (0.35 + 0.22 * i) * shutter * 0.55 * 2.0);
    const w = s.world;
    /* the camera's height over the Earth grows as the world shrinks on the screen */
    const D = w ? cam.D0 * Math.pow(1 + 6 * Math.pow(w.c, 1.3), 0.6) : cam.D0;
    /* the sky turns as the climb tilts towards the way ahead */
    const pitch = -0.32 + 0.55 * s.progress, yaw = 2.5 + 0.12 * s.progress, roll = 0.62;
    const cx = Math.cos(pitch), sx = Math.sin(pitch), cy = Math.cos(yaw), sy = Math.sin(yaw), cz = Math.cos(roll), sz = Math.sin(roll);
    /* Ry · Rx · Rz, column-major */
    const Rz = [cz, sz, 0, -sz, cz, 0, 0, 0, 1], Rx = [1, 0, 0, 0, cx, sx, 0, -sx, cx], Ry = [cy, 0, -sy, 0, 1, 0, sy, 0, cy];
    const mm = (a, b) => { const o = []; for (let c = 0; c < 3; c++) for (let r = 0; r < 3; r++) o.push(a[r] * b[c * 3] + a[3 + r] * b[c * 3 + 1] + a[6 + r] * b[c * 3 + 2]); return o; };
    const SK = mm(Ry, mm(Rx, Rz));
    gl.disable(gl.BLEND);
    const g3 = s.galaxy3d && s.galaxy3d.w > 0.001 ? s.galaxy3d : null;
    if (g3) pass(P.gal, galT.f, galT.w, galT.h, (u) => {
      gl.uniform2f(u.uRes, galT.w, galT.h); gl.uniform3fv(u.uCamP, g3.P); gl.uniformMatrix3fv(u.uCamR, false, new Float32Array(g3.R));
      gl.uniform1f(u.uF, galT.h * 0.95); gl.uniform1f(u.uTime, (s.t / 1000) % 1000); gl.uniform1f(u.uGain, g3.gain);
    });
    pass(P.scene, hdr.f, CW, CH, (u) => {
      gl.uniform2f(u.uRes, CW, CH); gl.uniform1f(u.uPx, px); gl.uniform1f(u.uTime, (s.t / 1000) % 1000);
      gl.uniform2f(u.uVP, s.vp[0], s.vp[1]); gl.uniform1f(u.uSpeed, s.v); gl.uniform1f(u.uRmax, s.rmax);
      gl.uniform4fv(u.uOff, off); gl.uniform4fv(u.uLen, len); gl.uniform3fv(u.uTint, s.tint);
      gl.uniform3f(u.uCirc, w ? w.cx : 0, w ? w.cy : 0, w ? w.R : 1); gl.uniform1f(u.uEarthA, w ? w.alpha : 0); gl.uniform1f(u.uD, D);
      gl.uniformMatrix3fv(u.uB, false, new Float32Array(cam.B)); gl.uniform3fv(u.uSun, cam.S);
      gl.uniform4f(u.uHas, maps.lights ? 1 : 0, maps.euro ? 1 : 0, maps.clouds && maps.day ? 1 : 0, maps.sky ? 1 : 0);
      gl.uniform4f(u.uEuroBox, ...EURO);
      gl.uniformMatrix3fv(u.uSkyM, false, new Float32Array(SK)); gl.uniform1f(u.uStarA, 1);
      /* how thick the field is: the door's sparse sky at rest, filling in as the flight gathers speed */
      { const q = Math.min(1, Math.max(0, (Math.abs(s.v) - 0.03) / 0.6)); gl.uniform1f(u.uDens, q * q * (3 - 2 * q)); }
      const tu = s.tu ?? s.t, sm = (a, b, x) => { const q = Math.min(1, Math.max(0, (x - a) / (b - a))); return q * q * (3 - 2 * q); };
      /* the nebula, through the cruise */
      gl.uniform1f(u.uNeb, s.galaxy3d ? 0 : sm(1200, 1750, tu) * (1 - sm(2350, 2950, tu))); gl.uniform1f(u.uNebOff, nebOff);
      /* the moon, through the acceleration: from near the way ahead, out past the lower right, growing */
      const mAt = (m) => { const tx = W * 0.8, ty = H * 0.68, dx = tx - s.vp[0], dy = ty - s.vp[1], dl = Math.hypot(dx, dy) || 1;
        const r0 = Math.min(dl * 0.35, H * 0.3), r1 = dl + H * 0.75, e = Math.pow(m, 2.3);
        return [s.vp[0] + (dx / dl) * (r0 + (r1 - r0) * e), s.vp[1] + (dy / dl) * (r0 + (r1 - r0) * e), H * (0.003 + 0.6 * Math.pow(m, 3.2))]; };
      const mt = (tu - 700) / 800;
      if (maps.moon && mt > 0 && mt < 1 && s.moon !== false && !s.galaxy3d) {
        const a = mAt(mt), b = mAt(Math.max(0, mt - (1 / 60) / 0.8));
        /* it comes out of the distance: tiny, and faint until it is a third of the way */
        gl.uniform4f(u.uMoonS, a[0], a[1], a[2], sm(0, 0.35, mt)); gl.uniform2f(u.uMoonV, (a[0] - b[0]) * 0.5, (a[1] - b[1]) * 0.5);
      } else gl.uniform4f(u.uMoonS, 0, 0, 1, 0);
      gl.uniform1f(u.uMoonSpin, 0.6 + tu * 0.00025);
      bind(5, maps.moon || blank, u.uMoonT);
      gl.uniform1f(u.uPre, s.bloom != null && s.star !== false ? sm(2500, 3300, tu) : 0);
      gl.uniform1f(u.uBloom, s.bloom || 0); gl.uniform2f(u.uBloomPt, s.bloomPt?.[0] ?? W / 2, s.bloomPt?.[1] ?? H / 2);
      bind(0, maps.lights || blank, u.uLights); bind(1, maps.day || blank, u.uDay); bind(2, maps.clouds || blank, u.uClouds);
      bind(3, maps.euro || blank, u.uEuro); bind(4, maps.sky || blank, u.uSky);
      /* the docs' flight: the Milky Way, and the constellations lighting */
      const cs = s.cstars || [], n = Math.min(64, cs.length);
      if (n) {
        const a = new Float32Array(64 * 4), c = new Float32Array(64 * 3);
        for (let i = 0; i < n; i++) { const t = cs[i]; a.set([t[0], t[1], t[2], t[3]], i * 4); c.set([t[4], t[5], t[6]], i * 3); }
        gl.uniform4fv(u.uCS, a); gl.uniform3fv(u.uCC, c);
      }
      gl.uniform1i(u.uCN, n);
      gl.uniform1f(u.uG3, g3 ? g3.w : 0); bind(6, g3 ? galT.t : blank, u.uGalTex);
      gl.uniform1f(u.uGalPage, g3 ? g3.page || 0 : 0);
      gl.uniformMatrix3fv(u.uGCamR, false, new Float32Array(g3 ? g3.R : [1, 0, 0, 0, 1, 0, 0, 0, 1]));
    });
    /* the galaxy's stars, added into the same light before the bloom: streaks, then their points */
    if (g3 && starVao) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, hdr.f); gl.viewport(0, 0, CW, CH);
      gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE);
      gl.useProgram(P.stars.p); gl.bindVertexArray(starVao);
      const u = P.stars.u;
      gl.uniform3fv(u.uCamP, g3.P); gl.uniform3fv(u.uPrevP, g3.prevP || g3.P);
      gl.uniformMatrix3fv(u.uCamR, false, new Float32Array(g3.R)); gl.uniformMatrix3fv(u.uPrevR, false, new Float32Array(g3.prevR || g3.R));
      gl.uniform2f(u.uRes, CW, CH); gl.uniform1f(u.uF, CH * 0.95); gl.uniform1f(u.uK, (g3.starK ?? 0.0006) * g3.w);
      gl.uniform1f(u.uPts, 0); gl.drawArrays(gl.LINES, 0, starN);
      gl.uniform1f(u.uPts, 1); gl.drawArrays(gl.POINTS, 0, starN);
      gl.bindVertexArray(null); gl.disable(gl.BLEND);
    }
    let src = hdr;
    chain.forEach((c, i) => { pass(P.down, c.f, c.w, c.h, (u) => { bind(0, src.t, u.uSrc); gl.uniform2f(u.uTexel, 1 / src.w, 1 / src.h); gl.uniform2f(u.uOut, c.w, c.h); gl.uniform1f(u.uFirst, i === 0 ? 1 : 0); }); src = c; });
    gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE);
    for (let i = chain.length - 1; i > 0; i--) { const from = chain[i], to = chain[i - 1];
      pass(P.up, to.f, to.w, to.h, (u) => { bind(0, from.t, u.uSrc); gl.uniform2f(u.uTexel, 1 / from.w, 1 / from.h); gl.uniform2f(u.uOut, to.w, to.h); }); }
    gl.disable(gl.BLEND);
    pass(P.film, null, CW, CH, (u) => { bind(0, hdr.t, u.uHdr); bind(1, chain[0].t, u.uBloom); gl.uniform2f(u.uRes, CW, CH);
      gl.uniform1f(u.uTime, (s.t / 1000) % 1000); gl.uniform1f(u.uExpo, 0.35); });
  }
  function clear() { gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.clearColor(0.012, 0.012, 0.014, 1); gl.clear(gl.COLOR_BUFFER_BIT); }
  return { canvas, resize, draw, advance, clear, warm, reset() { off.splice(0, 4, 0, 0.3, 0.7, 0.15); nebOff = 0; frames = []; } };
}
