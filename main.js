/* codyklr.com concept — no deps, no modules (works from file://) */
(function(){
"use strict";
var reduce = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
var root = document.documentElement;

/* ---------- theme ---------- */
var stored=null; try{stored=localStorage.getItem("theme");}catch(e){}
var qp=(location.search.match(/theme=(dark|light)/)||[])[1]; if(qp)stored=qp;
var dark = stored ? stored==="dark" : (window.matchMedia && matchMedia("(prefers-color-scheme: dark)").matches);
function applyTheme(){ root.setAttribute("data-theme", dark?"dark":"light");
  var b=document.getElementById("theme"); if(b){b.setAttribute("aria-pressed",String(dark)); b.textContent=dark?"☾ night hike":"☀ day hike";}}
applyTheme();

var hdrEl=document.querySelector("header.bar");function setHdr(){if(hdrEl)root.style.setProperty("--hdr",hdrEl.offsetHeight+"px");}setHdr();window.addEventListener("resize",setHdr);if(document.fonts&&document.fonts.ready)document.fonts.ready.then(setHdr);
/* ---------- noise ---------- */
function hash(x,y,s){var h=(Math.imul(x,374761393)+Math.imul(y,668265263)+Math.imul(s,982451653))|0;
  h=Math.imul(h^(h>>>13),1274126177);h^=h>>>16;return (h>>>0)/4294967295;}
function sm(t){return t*t*(3-2*t);}
function vnoise(x,y,s){var xi=Math.floor(x),yi=Math.floor(y),xf=sm(x-xi),yf=sm(y-yi);
  var a=hash(xi,yi,s),b=hash(xi+1,yi,s),c=hash(xi,yi+1,s),d=hash(xi+1,yi+1,s);
  return a+(b-a)*xf+(c-a)*yf+(a-b-c+d)*xf*yf;}
function fbm(x,y,s,o){var v=0,a=.5,f=1,n=0;for(var i=0;i<o;i++){v+=a*vnoise(x*f,y*f,s+i*17);n+=a;a*=.5;f*=2;}return v/n;}

/* ---------- palette + dither ---------- */
function hex(c){c=c.trim();var n=parseInt(c.slice(1),16);return [(n>>16)&255,(n>>8)&255,n&255];}
function palette(){var cs=getComputedStyle(root);return [0,1,2,3].map(function(i){return hex(cs.getPropertyValue("--c"+i));});}
function bayer(n){ // n = 2,4,8 recursive Bayer matrix normalised to (0,1)
  var m=[[0,2],[3,1]];
  while(m.length<n){var s=m.length,r=[];for(var y=0;y<s*2;y++){r[y]=[];for(var x=0;x<s*2;x++){
    var b=m[y%s][x%s]*4;var q=(y<s?0:2)+(x<s?0:1);r[y][x]=b+[0,2,3,1][q];}}m=r;}
  var t=n*n;return m.map(function(row){return row.map(function(v){return (v+.5)/t;});});}
var BAYER={4:bayer(4),8:bayer(8)};
function ditherBayer(v,w,h,N,n,out){var M=BAYER[n];
  for(var y=0;y<h;y++)for(var x=0;x<w;x++){var i=y*w+x,t=Math.max(0,Math.min(1,v[i]))*(N-1),b=Math.floor(t);
    out[i]=Math.min(N-1,b+((t-b)>M[y%n][x%n]?1:0));}}
function ditherFS(v,w,h,N,out){var e=Float32Array.from(v);
  for(var y=0;y<h;y++)for(var x=0;x<w;x++){var i=y*w+x,o=Math.max(0,Math.min(1,e[i])),q=Math.round(o*(N-1)),err=o-q/(N-1);out[i]=q;
    if(x+1<w)e[i+1]+=err*7/16; if(y+1<h){ if(x>0)e[i+w-1]+=err*3/16; e[i+w]+=err*5/16; if(x+1<w)e[i+w+1]+=err/16; }}}
function paint(ctx,idx,w,h,pal){var img=ctx.createImageData(w,h),d=img.data;
  for(var i=0;i<idx.length;i++){var c=pal[idx[i]];d[i*4]=c[0];d[i*4+1]=c[1];d[i*4+2]=c[2];d[i*4+3]=255;}ctx.putImageData(img,0,0);}

/* ---------- scene: sun, ridges, fog -> scalar field in [0,1] ---------- */
function Scene(canvas,o){
  var w=canvas.width,h=canvas.height,self=this;
  var seed=o.seed||1,layers=o.layers||4,night=!!o.night;
  var cols=[];  // precomputed ridge heights
  for(var L=0;L<layers;L++){var a=new Float32Array(w),base=h*(.5+.11*L*(4/layers)),amp=h*(.30-.04*L),fr=.012+.01*L;
    for(var x=0;x<w;x++){var n=fbm(x*fr+L*9,L*3.1,seed+L*5,4);var crag=1-Math.abs(n*2-1);
      a[x]=base-(n*.6+crag*.4)*amp+ (L===0?-h*.04:0);} cols.push(a);}
  var sx=(o.sunX==null?.68:o.sunX)*w, sy=(o.sunY==null?.5:o.sunY)*h, sr=(o.sunR||.07)*h;
  this.field=new Float32Array(w*h); this.idx=new Uint8Array(w*h);
  this.compute=function(t,night2){
    var f=self.field,sky0=night2?.38:.74;
    for(var y=0;y<h;y++)for(var x=0;x<w;x++){
      var dx=x-sx,dy=(y-sy)*1.1,d=Math.sqrt(dx*dx+dy*dy);
      var v=sky0+.22*(y/(h*.8))+Math.max(0,1-d/(sr*5))*.28;
      if(d<sr) v=.66; // sun disc (rust)
      for(var L=0;L<layers;L++){var top=cols[L][x];
        if(y>=top){var depth=Math.min(1,(y-top)/(h*.25));
          v=.5-L*(.4/layers)-(.08*depth)+(y-top<3?.1:0);}}
      // drifting fog bands
      var fg=fbm(x*.018+t*.05,y*.07+L,seed+99,3);
      var band=Math.exp(-Math.pow((y-h*.62)/(h*.1),2))+.7*Math.exp(-Math.pow((y-h*.82)/(h*.08),2));
      var fa=Math.max(0,fg-.42)*1.6*band;
      v+=(.88-v)*Math.min(.5,fa);
      f[y*w+x]=v;}
  };
  this.draw=function(t,mode,pal,night2){
    self.compute(t,night2);
    if(mode==="fs")ditherFS(self.field,w,h,4,self.idx); else ditherBayer(self.field,w,h,4,mode===8?8:4,self.idx);
    paint(canvas.getContext("2d"),self.idx,w,h,pal);};
}

/* ---------- canvases ---------- */
var scenes=[],hero=null,mode=4;
function thumbVariant(c,kind,seed){var w=c.width,h=c.height,v=new Float32Array(w*h),idx=new Uint8Array(w*h);
  return {draw:function(t,m,pal){
    for(var y=0;y<h;y++)for(var x=0;x<w;x++){var val;
      if(kind==="grid"){ // terrain mosaic: data cells with hairline gutters
        var cx=Math.floor(x/10),cy=Math.floor(y/8),n=fbm(cx*.22,cy*.28,seed,4);
        val=.12+n*.85; if(x%10===0||y%8===0)val=.04; else if(n>.62&&(x%10>6)&&(y%8>5))val=.7;}
      else if(kind==="rings"){ // signal rings from a source, warped by noise
        var dx=x-w*.5,dy=(y-h*.55)*1.4,d=Math.sqrt(dx*dx+dy*dy)+fbm(x*.04,y*.04,seed,3)*14;
        val=(Math.sin(d*.55)*.5+.5)*Math.max(.15,1-d/(w*.55))+.05; if(d<7)val=.7;}
      else { // contour bands
        var n=fbm(x*.022,y*.034,seed,5)*9;val=n-Math.floor(n);val=val<.2?.1:val*.55+.35;}
      v[y*w+x]=val;}
    ditherFS(v,w,h,4,idx);paint(c.getContext("2d"),idx,w,h,pal);}};}
function altPal(p,which){function mx(a,b,t){return [0,1,2].map(function(i){return Math.round(a[i]+(b[i]-a[i])*t);});}
  return which==="alt"?[p[0],p[1],mx(p[1],p[3],.55),p[3]]:[p[0],mx(p[0],p[3],.25),mx(p[1],p[3],.35),p[3]];}
function isNight(){return root.getAttribute("data-theme")==="dark";}
/* integer pixel scaling: avoids Bayer moire ("banding") from fractional CSS scaling */
function fit(c,availOverride){
  if(!c._bw){c._bw=c.width;c._bh=c.height;}
  c.style.width="";var bd=c.offsetWidth-c.clientWidth,avail=(availOverride||c.parentElement.clientWidth||c._bw)-bd;
  var s=Math.max(1,Math.round(avail/c._bw)),w=Math.max(60,Math.floor(avail/s)),h=Math.round(w*c._bh/c._bw);
  if(c.width!==w)c.width=w; if(c.height!==h)c.height=h;
  c.style.width=(w*s+bd)+"px";c.style.maxWidth="100%";}
function makeEntry(c){
  var kind=c.getAttribute("data-scene"),o={seed:+c.getAttribute("data-seed")||1},v=c.getAttribute("data-variant");
  if(kind==="hero"){o.layers=4;o.sunX=.7;o.sunY=.33;o.sunR=.085;}
  else if(kind==="banner"){o.layers=3;o.sunX=.3;o.sunY=.38;o.sunR=.09;}
  else if(v&&v!=="ridge")return {c:c,s:thumbVariant(c,v,o.seed),kind:"thumb",pal:c.getAttribute("data-pal")};
  else {o.layers=v==="ridge"?5:2+(o.seed%3);o.sunX=.2+((o.seed*37)%60)/100;o.sunY=.35+((o.seed*13)%25)/100;o.sunR=.1;}
  var e={c:c,s:new Scene(c,o),kind:kind};if(kind==="hero")hero=e;
  if(kind==="thumb"&&c.getAttribute("data-pal"))e.pal=c.getAttribute("data-pal");return e;}
var tick=0,io=null,queue=[],qBusy=false,firstBuild=true;
function idle(fn){return (window.requestIdleCallback||function(f){return setTimeout(function(){f({timeRemaining:function(){return 8;}});},40);})(fn,{timeout:700});}
function drawEntry(e,pal,n){if(e.kind==="hero"||e.kind==="banner")e.s.draw(tick,mode,pal,n);else e.s.draw(0,"fs",e.pal?altPal(pal,e.pal):pal,n);e.stale=false;}
function pump(){if(qBusy||!queue.length)return;qBusy=true;idle(function(dl){var pal=palette(),n=isNight();
  while(queue.length){var e=queue.shift();if(e.stale&&e.near)drawEntry(e,pal,n);if(dl.timeRemaining&&dl.timeRemaining()<4)break;}
  qBusy=false;pump();});}
function want(e){if(e.stale&&e.near&&queue.indexOf(e)<0){queue.push(e);pump();}}
/* canvases are built lazily: hero first (sync), the rest when they come near the viewport, one per idle slice */
function build(sync){scenes=[];queue=[];if(io){io.disconnect();io=null;}
  document.querySelectorAll("canvas[data-scene]").forEach(function(c){fit(c);var e=makeEntry(c);e.stale=true;e.near=false;c._e=e;scenes.push(e);});
  refAnim();var pal=palette(),n=isNight();
  scenes.forEach(function(e){if(sync||(firstBuild&&e===hero)){e.near=true;drawEntry(e,pal,n);}});firstBuild=false;
  if("IntersectionObserver" in window&&!sync){io=new IntersectionObserver(function(es){es.forEach(function(x){var e=x.target._e;if(!e)return;e.near=x.isIntersecting;if(e.near)want(e);});kick();},{rootMargin:"300px 0px"});
    scenes.forEach(function(e){io.observe(e.c);});}
  else scenes.forEach(function(e){e.near=true;if(e.stale)drawEntry(e,pal,n);});}
function drawAll(){var pal=palette(),n=isNight();scenes.forEach(function(e){e.stale=true;if(e===hero||e.kind==="banner"){if(e.near)drawEntry(e,pal,n);}else want(e);});}
var anim=[];function refAnim(){anim=scenes.filter(function(e){return e.kind==="hero"||e.kind==="banner";});}
/* animate only hero/banner while on screen; ~10fps (6fps on phones); the loop is not scheduled at all when idle */
var last=0,rafId=0,gap=(window.matchMedia&&matchMedia("(pointer:coarse)").matches)||innerWidth<=720?166:100;
function animVisible(){return anim.some(function(e){return e.near;});}
function loop(ts){rafId=0;if(reduce||document.hidden||!animVisible())return;
  if(ts-last>=gap){last=ts;tick+=gap/1000;var pal=palette(),n=isNight();anim.forEach(function(e){if(e.near)e.s.draw(tick,mode,pal,n);});}
  rafId=requestAnimationFrame(loop);}
function kick(){if(!reduce&&!rafId&&!document.hidden&&animVisible())rafId=requestAnimationFrame(loop);}
document.addEventListener("visibilitychange",kick);
build();kick();

/* controls */
var tb=document.getElementById("theme");
if(tb)tb.addEventListener("click",function(){dark=!dark;try{localStorage.setItem("theme",dark?"dark":"light");}catch(e){}applyTheme();drawAll();drawMap();});
document.querySelectorAll("[data-dither]").forEach(function(b){b.addEventListener("click",function(){
  var v=b.getAttribute("data-dither");mode=v==="fs"?"fs":+v;
  document.querySelectorAll("[data-dither]").forEach(function(x){x.setAttribute("aria-checked",String(x===b));});drawAll();});});

/* ---------- topographic contours: marching squares over fbm -> SVG ---------- */
var svg=document.getElementById("contours");
if(svg)idle(function(){
  var GW=72,GH=48,g=[],W=1200,H=800,cw=W/(GW-1),ch=H/(GH-1);
  for(var j=0;j<GH;j++){g[j]=[];for(var i=0;i<GW;i++)g[j][i]=fbm(i*.055,j*.055,7,5);}
  var segs=[];
  for(var lv=0.30;lv<0.72;lv+=0.035){
    var d="";
    for(var j2=0;j2<GH-1;j2++)for(var i2=0;i2<GW-1;i2++){
      var tl=g[j2][i2],tr=g[j2][i2+1],br=g[j2+1][i2+1],bl=g[j2+1][i2];
      var c=(tl>lv?1:0)|(tr>lv?2:0)|(br>lv?4:0)|(bl>lv?8:0); if(c===0||c===15)continue;
      var x0=i2*cw,y0=j2*ch;
      var P={t:[x0+cw*(lv-tl)/(tr-tl),y0],r:[x0+cw,y0+ch*(lv-tr)/(br-tr)],b:[x0+cw*(lv-bl)/(br-bl),y0+ch],l:[x0,y0+ch*(lv-tl)/(bl-tl)]};
      var T={1:["l","t"],2:["t","r"],3:["l","r"],4:["r","b"],5:["l","t","r","b"],6:["t","b"],7:["l","b"],8:["l","b"],9:["t","b"],10:["t","r","l","b"],11:["r","b"],12:["l","r"],13:["t","r"],14:["l","t"]}[c];
      for(var k=0;k<T.length;k+=2){var p=P[T[k]],q=P[T[k+1]];d+="M"+p[0].toFixed(1)+" "+p[1].toFixed(1)+"L"+q[0].toFixed(1)+" "+q[1].toFixed(1);}
    }
    var path=document.createElementNS("http://www.w3.org/2000/svg","path");path.setAttribute("d",d);
    if(Math.round((lv-.30)/.035)%4===0)path.setAttribute("style","stroke-width:1.6");svg.appendChild(path);
  }
});

/* ---------- dithered globe (software renderer, orthographic, Bayer-dithered) ---------- */
var G={d:null,land:null,blur:null,hi:null,lon:-62,lat:22,zoom:1,vLon:0,fly:null,dirty:1,raf:null,last:0,vis:true,paused:false,hover:false,N:0,S:1,R:0,theme:"",active:null,selMonth:null,drag:null,justDrag:0,cols:null};
var gcv=document.getElementById("gcanvas"),gwrap=document.getElementById("gwrap"),gframe=document.getElementById("gframe"),gpins=document.getElementById("gpins"),gcard=document.getElementById("gcard");
var D2R=Math.PI/180,B4=[0,8,2,10,12,4,14,6,3,11,1,9,15,7,13,5];
var MON=["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
function gDate(s){var p=s.split("-");return MON[+p[1]-1]+" "+p[0];}
function gLabel(p){return p.label||(p.name+", "+p.region);}
function hexU(h){var n=parseInt(h.slice(1),16);return (255<<24)|((n&255)<<16)|(n>>8&255)<<8|(n>>16&255);}
var RAMPS={light:{ocean:["#16221c","#33463c","#7d8f80","#c9cfbd"],land:["#16221c","#2c4a3b","#4f7a62","#a2c2a0"],halo:"#6f9a7f",star:"#16221c"},
           dark:{ocean:["#060a08","#0c1511","#16261f","#27443a"],land:["#060a08","#1c382b","#3d6a51","#86b69a"],halo:"#86b69a",star:"#e9e4d6"}};
function gTheme(){var t=document.documentElement.getAttribute("data-theme")==="dark"?"dark":"light";if(G.cols&&G.theme===t)return;G.theme=t;var r=RAMPS[t];
  G.cols={ocean:r.ocean.map(hexU),land:r.land.map(hexU),halo:hexU(r.halo),star:hexU(r.star),arc:hexU("#d2622f"),arcHi:hexU("#f3ecd9")};}
function gLoadMask(src,cb){var im=new Image();im.onload=function(){var c=document.createElement("canvas");c.width=im.width;c.height=im.height;var x=c.getContext("2d");x.drawImage(im,0,0);var d=x.getImageData(0,0,c.width,c.height).data,a=new Uint8Array(c.width*c.height);for(var i=0;i<a.length;i++)a[i]=d[i*4];cb({a:a,w:c.width,h:c.height});};im.src=src;}
function bil(m,u,v,wrap){var x=u*m.w-.5,y=v*m.h-.5,x0=Math.floor(x),y0=Math.floor(y),fx=x-x0,fy=y-y0,w=m.w,h=m.h;
  var x1=x0+1,y1=y0+1;if(wrap){x0=((x0%w)+w)%w;x1=((x1%w)+w)%w;}else{x0=x0<0?0:x0>=w?w-1:x0;x1=x1<0?0:x1>=w?w-1:x1;}
  y0=y0<0?0:y0>=h?h-1:y0;y1=y1<0?0:y1>=h?h-1:y1;var a=m.a;
  return ((a[y0*w+x0]*(1-fx)+a[y0*w+x1]*fx)*(1-fy)+(a[y1*w+x0]*(1-fx)+a[y1*w+x1]*fx)*fy)/255;}
function gSize(){var cw=gframe.clientWidth;if(!cw)return false;var S=Math.max(1,Math.ceil(cw/300)),N=Math.floor(cw/S);if(N!==G.N||S!==G.S){G.N=N;G.S=S;G.R=N/2-6;gcv.width=N;gcv.height=N;gcv.style.width=gcv.style.height="";gwrap.style.width=gwrap.style.height=(N*S)+"px";G.img=gcv.getContext("2d").createImageData(N,N);G.u32=new Uint32Array(G.img.data.buffer);}return true;}
function gRender(){if(!G.land||!G.d||!gSize())return;gTheme();var N=G.N,R=G.R*G.zoom,cx=N/2,cy=N/2,u32=G.u32,C=G.cols,
  lam0=G.lon*D2R,ph1=G.lat*D2R,sp=Math.sin(ph1),cp=Math.cos(ph1),hb=G.d.hires.bbox,ppdw=1/(hb[2]-hb[0]),ppdh=1/(hb[3]-hb[1]),
  Lx=-.5,Ly=.5,Lz=.72,Ll=Math.sqrt(Lx*Lx+Ly*Ly+Lz*Lz);Lx/=Ll;Ly/=Ll;Lz/=Ll;
  var grat=G.zoom<3?15:5,gthr=.4/(R*D2R),dark=G.theme==="dark",ro=C.ocean,rl=C.land,hz=1.0+4.5/R,
  A=G.land,Bm=G.blur,H=G.hi;
  for(var py=0;py<N;py++){var Y=(cy-py-.5)/R;for(var px=0;px<N;px++){var X=(px+.5-cx)/R,r2=X*X+Y*Y,i=py*N+px,bay=B4[(py&3)*4+(px&3)]/16;
    if(r2>1){var rr=Math.sqrt(r2);if(rr<hz){var gl=1-(rr-1)/(hz-1);gl=gl*gl*.9;u32[i]=gl>bay?C.halo:0;}
      else u32[i]=(dark&&((px*73856093^py*19349663)>>>0)%520===0)?C.star:0;continue;}
    var Z=Math.sqrt(1-r2),sphi=Z*sp+Y*cp,phi=Math.asin(sphi),lam=lam0+Math.atan2(X,Z*cp-Y*sp),latd=phi/D2R,lond=lam/D2R;
    lond=((lond+540)%360)-180;var m,bl;
    var hx=(lond-hb[0])*ppdw,hy=(hb[3]-latd)*ppdh;
    if(hx>0&&hx<1&&hy>0&&hy<1)m=bil(H,hx,hy,false);else m=bil(A,(lond+180)/360,(90-latd)/180,true);
    bl=bil(Bm,(lond+180)/360,(90-latd)/180,true);
    var dif=X*Lx+Y*Ly+Z*Lz,sh=(dif+.08)/.5;sh=sh<0?0:sh>1?1:sh;sh=sh*sh*(3-2*sh);
    var v,ramp;if(m>.5){ramp=rl;v=(.52+.4*bl)*(.16+.84*sh);}else{ramp=ro;v=(.38+.5*(1-bl*.5))*(.14+.86*sh);if(m>0)v+=.08*m;}
    v+=(1-Z)*(1-Z)*.22*(.3+sh);  // limb glow
    var dl=((latd+grat/2)%grat+grat)%grat-grat/2,dn=((lond+grat/2)%grat+grat)%grat-grat/2,cl=Math.max(.2,Math.sqrt(1-sphi*sphi));
    if(Math.abs(dl)<gthr/Z||Math.abs(dn)<gthr/(Z*cl))v+=(G.zoom<3?.07:.04);
    v=v<0?0:v>.999?.999:v;var t=v*3,lo=t|0;u32[i]=ramp[(t-lo)>bay?lo+1:lo];}}
  gArcs(R,cx,cy,lam0,sp,cp);
  gcv.getContext("2d").putImageData(G.img,0,0);gPins(R,cx,cy,lam0,sp,cp);}
function gVec(lat,lon){var f=lat*D2R,l=lon*D2R;return [Math.cos(f)*Math.cos(l),Math.cos(f)*Math.sin(l),Math.sin(f)];}
function gView(w,lam0,sp,cp){var c0=Math.cos(lam0),s0=Math.sin(lam0),X=w[1]*c0-w[0]*s0,c=w[0]*c0+w[1]*s0;return [X,cp*w[2]-sp*c,sp*w[2]+cp*c];}
function gLine(x0,y0,x1,y1,st){var dx=x1-x0,dy=y1-y0,n=Math.ceil(Math.max(Math.abs(dx),Math.abs(dy)));if(n>400)return;var N=G.N,u=G.u32,col=G.cols.arc;
  for(var k=0;k<=n;k++){var x=Math.round(x0+dx*k/(n||1)),y=Math.round(y0+dy*k/(n||1));if(x<0||y<0||x>=N||y>=N)continue;if(((st.c++)%4)<2)u[y*N+x]=col;}}
function gArcs(R,cx,cy,lam0,sp,cp){var h=G.d.home,a=gVec(h.lat,h.lon);G.d.places.forEach(function(p){var b=gVec(p.lat,p.lon),dot=Math.max(-1,Math.min(1,a[0]*b[0]+a[1]*b[1]+a[2]*b[2])),om=Math.acos(dot);if(om<1e-4)return;var so=Math.sin(om),S=Math.max(24,Math.min(120,Math.ceil(om*90))),st={c:0},px=null,py=null,lift=.2*om;
  for(var k=0;k<=S;k++){var t=k/S,s1=Math.sin((1-t)*om)/so,s2=Math.sin(t*om)/so,w=[a[0]*s1+b[0]*s2,a[1]*s1+b[1]*s2,a[2]*s1+b[2]*s2],rr=1+lift*Math.sin(Math.PI*t),v=gView(w,lam0,sp,cp),X=v[0]*rr,Y=v[1]*rr,Z=v[2]*rr,vis=Z>0||(X*X+Y*Y)>1;
    var sx=cx+X*R,sy=cy-Y*R;if(vis&&px!==null)gLine(px,py,sx,sy,st);if(vis){px=sx;py=sy;}else{px=null;}}});}
/* pins as real buttons over the canvas (>=44px hit areas, hidden when on the far side) */
var gBtn={},gCl=[];
function gMake(){var d=G.d;function mk(id,cls,html,p){var b=document.createElement("button");b.type="button";b.className="gpin "+cls;b.setAttribute("data-id",id);b.setAttribute("aria-label",p);b.innerHTML=html;gpins.appendChild(b);return b;}
  gBtn.home=mk("home","home",'<span class="pl">'+d.home.label+'</span>',d.home.label);
  d.places.forEach(function(p){gBtn[p.id]=mk(p.id,"",'<span class="pl">'+p.name+'</span>',gLabel(p)+", "+gDate(p.date));});
  d.places.forEach(function(){var b=mk("cl","cl",'<span class="n"></span>',"Several places");b.hidden=true;gCl.push(b);});
  gpins.addEventListener("click",function(e){var b=e.target.closest(".gpin");if(!b||G.justDrag>Date.now())return;var id=b.getAttribute("data-id");
    if(id==="cl"){var ids=b.getAttribute("data-m").split(",");gFit(ids.map(gFind),true);return;}
    gSelect(id,true);});
  gpins.addEventListener("pointerover",function(e){if(e.pointerType!=="mouse")return;var b=e.target.closest(".gpin");if(b&&b.getAttribute("data-id")!=="cl"){G.hover=true;gShow(b.getAttribute("data-id"));}});
  gpins.addEventListener("pointerout",function(e){if(e.pointerType!=="mouse")return;var b=e.target.closest(".gpin");if(b&&!G.pinned){gShow(null);}});
  gpins.addEventListener("focusin",function(e){var b=e.target.closest(".gpin");if(b&&b.getAttribute("data-id")!=="cl")gShow(b.getAttribute("data-id"));});}
function gFind(id){return id==="home"?G.d.home:G.d.places.filter(function(p){return p.id===id;})[0];}
function gPins(R,cx,cy,lam0,sp,cp){var S=G.S,list=[{id:"home",p:G.d.home}].concat(G.d.places.map(function(p){return {id:p.id,p:p};})),pos={};
  list.forEach(function(o){var v=gView(gVec(o.p.lat,o.p.lon),lam0,sp,cp),vis=v[2]>.1;o.vis=vis;o.x=(cx+v[0]*R)*S;o.y=(cy-v[1]*R)*S;});
  var cls=[];gCl.forEach(function(b){b.hidden=true;});
  list.forEach(function(o){if(o.id==="home"||!o.vis){o.cl=null;return;}for(var i=0;i<cls.length;i++){var c=cls[i];if(Math.hypot(c.x-o.x,c.y-o.y)<34){c.m.push(o);o.cl=c;return;}}var c={x:o.x,y:o.y,m:[o]};cls.push(c);o.cl=c;});
  list.forEach(function(o){var b=gBtn[o.id],hide=!o.vis||(o.cl&&o.cl.m.length>1);b.hidden=hide;if(!hide){b.style.transform="translate3d("+o.x.toFixed(1)+"px,"+o.y.toFixed(1)+"px,0)";b.classList.toggle("flip",o.x>N0()*.62);
    var inM=G.selMonth===null||(o.id!=="home"&&o.p.date===G.selMonth);b.classList.toggle("dim",G.selMonth!==null&&!inM&&o.id!=="home");b.classList.toggle("on",G.active===o.id);}});
  var k=0;cls.forEach(function(c){if(c.m.length>1){var b=gCl[k++];b.hidden=false;b.style.transform="translate3d("+c.x.toFixed(1)+"px,"+c.y.toFixed(1)+"px,0)";b.querySelector(".n").textContent=c.m.length;b.setAttribute("data-m",c.m.map(function(o){return o.id;}).join(","));
    b.setAttribute("aria-label",c.m.length+" places: "+c.m.map(function(o){return o.p.name;}).join(", ")+". Zoom in.");b.classList.toggle("dim",G.selMonth!==null&&!c.m.some(function(o){return o.p.date===G.selMonth;}));}});
  gwrap.classList.toggle("zl",G.zoom>=5);
  if(G.active){var o2=list.filter(function(o){return o.id===G.active;})[0];if(o2&&o2.vis&&!gBtn[G.active].hidden){gcard.hidden=false;var w=gcard.offsetWidth,W=N0(),x=Math.max(4,Math.min(W-w-4,o2.x-w/2)),y=o2.y-gcard.offsetHeight-16;if(y<4)y=o2.y+16;gcard.style.transform="translate("+x.toFixed(0)+"px,"+y.toFixed(0)+"px)";}else if(o2&&o2.vis&&G.zoom>=1.5){gcard.hidden=true;}else gcard.hidden=true;}}
function N0(){return G.N*G.S;}
function gShow(id){G.active=id;if(!id){gcard.hidden=true;G.dirty=1;gKick();return;}var p=gFind(id);
  gcard.innerHTML='<span class="nm">'+(id==="home"?p.label:gLabel(p)+" · "+gDate(p.date))+'</span>'+(id==="home"||!p.href?"":'<a href="'+p.href+'">Read entry →</a>');gcard.hidden=false;G.dirty=1;gKick();}
function gSelect(id,pin){G.pinned=pin;gShow(id);var p=gFind(id);gFly(p.lon,p.lat,Math.max(G.zoom,id==="home"?1.6:5));
  document.querySelectorAll("#glist li").forEach(function(li){li.classList.toggle("cur",li.getAttribute("data-id")===id);});}
/* camera */
function gFly(lon,lat,zoom){zoom=Math.max(1,Math.min(24,zoom));if(reduce){G.lon=lon;G.lat=Math.max(-70,Math.min(70,lat));G.zoom=zoom;G.vLon=0;G.dirty=1;gKick();return;}
  var dl=((lon-G.lon+540)%360)-180;G.fly={t0:performance.now(),dur:900+Math.min(600,Math.abs(dl)*6),l0:G.lon,dl:dl,a0:G.lat,da:Math.max(-70,Math.min(70,lat))-G.lat,z0:G.zoom,dz:zoom-G.zoom};G.vLon=0;gKick();}
function gFit(ps,more){var la=0,lo=0,vs=ps.map(function(p){return gVec(p.lat,p.lon);}),m=[0,0,0];vs.forEach(function(v){m[0]+=v[0];m[1]+=v[1];m[2]+=v[2];});var l=Math.hypot(m[0],m[1],m[2]);m=m.map(function(x){return x/l;});
  var lat=Math.asin(m[2])/D2R,lon=Math.atan2(m[1],m[0])/D2R,sp=0;vs.forEach(function(v){sp=Math.max(sp,Math.acos(Math.max(-1,Math.min(1,v[0]*m[0]+v[1]*m[1]+v[2]*m[2]))));});
  var z=sp<.002?6:.8/sp;if(more)z=Math.max(z,G.zoom*1.8);gFly(lon,lat,Math.min(z,24));}
function gKick(){if(G.raf||!G.vis)return;G.raf=requestAnimationFrame(gFrame);}
function gFrame(ts){G.raf=null;if(!G.vis||document.hidden)return;var dt=Math.min(.1,(ts-G.last)/1000);
  var gap=(!G.fly&&!G.drag&&Math.abs(G.vLon)<=.05)?66:32;if(ts-G.last<gap&&G.last){gKick();return;}G.last=ts;var moving=false;
  if(G.fly){var f=G.fly,t=(performance.now()-f.t0)/f.dur;if(t>=1){t=1;G.fly=null;}var e=t<.5?4*t*t*t:1-Math.pow(-2*t+2,3)/2;G.lon=f.l0+f.dl*e;G.lat=f.a0+f.da*e;G.zoom=f.z0+f.dz*e;G.lon=((G.lon+540)%360)-180;moving=!!G.fly;G.dirty=1;}
  else if(!G.drag&&Math.abs(G.vLon)>.05){G.lon+=G.vLon*dt;G.vLon*=Math.exp(-4.5*dt);G.lon=((G.lon+540)%360)-180;G.dirty=1;moving=true;}
  else if(!reduce&&!G.paused&&!G.drag&&!G.hover&&!G.active&&G.zoom<1.6&&!document.querySelector("#map :focus-visible")){G.lon+=4.5*dt;G.lon=((G.lon+540)%360)-180;G.dirty=1;moving=true;}
  if(G.dirty){G.dirty=0;var t0=performance.now();gRender();G.cost=performance.now()-t0;}
  if(moving||G.drag)gKick();}
function gDrag(){var down=null;
  gwrap.addEventListener("pointerdown",function(e){if(e.button>0)return;down={id:e.pointerId,x:e.clientX,y:e.clientY,lon:G.lon,lat:G.lat,t:performance.now(),px:e.clientX,pt:performance.now(),v:0,touch:e.pointerType!=="mouse",on:false};});
  gwrap.addEventListener("pointermove",function(e){if(!down||e.pointerId!==down.id)return;var dx=e.clientX-down.x,dy=e.clientY-down.y;
    if(!down.on){if(Math.hypot(dx,dy)<6)return;if(down.touch&&Math.abs(dy)>Math.abs(dx)){down=null;return;}down.on=true;G.drag=true;G.fly=null;gwrap.classList.add("drag");try{gwrap.setPointerCapture(e.pointerId);}catch(_){}}
    var k=57.3/(G.R*G.S*G.zoom);G.lon=((down.lon-dx*k+540)%360)-180;if(!down.touch)G.lat=Math.max(-70,Math.min(70,down.lat+dy*k));
    var now=performance.now(),dtm=(now-down.pt)/1000;if(dtm>.016){down.v=(-(e.clientX-down.px)*k)/dtm*.6+down.v*.4;down.px=e.clientX;down.pt=now;}G.dirty=1;gKick();});
  function end(e){if(!down||e.pointerId!==down.id)return;if(down.on){G.drag=false;gwrap.classList.remove("drag");G.justDrag=Date.now()+80;G.vLon=reduce?0:Math.max(-120,Math.min(120,down.v));if(performance.now()-down.pt>120)G.vLon=0;G.dirty=1;gKick();}down=null;}
  gwrap.addEventListener("pointerup",end);gwrap.addEventListener("pointercancel",end);
  gwrap.addEventListener("keydown",function(e){var k={ArrowLeft:[-8,0],ArrowRight:[8,0],ArrowUp:[0,6],ArrowDown:[0,-6]}[e.key];if(e.target!==gwrap){if(e.key==="Escape"){gShow(null);G.pinned=false;}return;}if(!k)return;e.preventDefault();G.fly=null;G.lon=((G.lon+k[0]/Math.max(1,G.zoom/2)+540)%360)-180;G.lat=Math.max(-70,Math.min(70,G.lat+k[1]/Math.max(1,G.zoom/2)));G.dirty=1;gKick();});
  document.addEventListener("keydown",function(e){if(e.key==="Escape"&&G.active){G.pinned=false;gShow(null);}});
  document.addEventListener("pointerdown",function(e){if(G.active&&!e.target.closest("#gwrap"))gShow(null),G.pinned=false;});
  gwrap.addEventListener("pointerleave",function(e){if(e.pointerType==="mouse"){G.hover=false;}});}
/* timeline + list */
function gUI(){var d=G.d,ix=function(s){var p=s.split("-");return +p[0]*12+ +p[1]-1;},idx=d.places.map(function(p){return ix(p.date);}),mx=Math.max.apply(null,idx),mn=Math.min.apply(null,idx),lo=Math.min(mn,mx-5);
  var tl=document.getElementById("gtime");tl.innerHTML="";
  for(var i=lo;i<=mx;i++){var y=Math.floor(i/12),m=i%12,key=y+"-"+("0"+(m+1)).slice(-2),here=d.places.filter(function(p){return p.date===key;}),b=document.createElement("button");b.type="button";b.className="mc";b.setAttribute("data-m",key);
    b.innerHTML='<span class="yr">'+((m===0||i===lo)?y:"")+'</span><span>'+MON[m]+'</span><span class="dots">'+here.map(function(){return "<i></i>";}).join("")+"</span>";
    if(!here.length){b.disabled=true;b.setAttribute("aria-label",MON[m]+" "+y+": no trips");}else b.setAttribute("aria-label",MON[m]+" "+y+": "+here.map(function(p){return p.name;}).join(", "));b.setAttribute("aria-pressed","false");tl.appendChild(b);}
  function pick(key){G.selMonth=(G.selMonth===key?null:key);tl.querySelectorAll(".mc").forEach(function(x){var on=x.getAttribute("data-m")===G.selMonth;x.classList.toggle("sel",on);x.setAttribute("aria-pressed",on);});
    if(G.selMonth){gShow(null);gFit(d.places.filter(function(p){return p.date===G.selMonth;}));}else{gFly(G.lon,G.lat,1);}G.dirty=1;gKick();}
  tl.addEventListener("click",function(e){var b=e.target.closest(".mc");if(b&&!b.disabled)pick(b.getAttribute("data-m"));});
  var sd=null;tl.addEventListener("pointerdown",function(e){sd={x:e.clientX,on:false};});
  tl.addEventListener("pointermove",function(e){if(!sd||e.pointerType==="mouse"&&e.buttons!==1)return;if(Math.abs(e.clientX-sd.x)<8&&!sd.on)return;sd.on=true;var el=document.elementFromPoint(e.clientX,e.clientY),b=el&&el.closest&&el.closest(".mc");if(b&&!b.disabled&&b.getAttribute("data-m")!==G.selMonth)pick(b.getAttribute("data-m"));});
  window.addEventListener("pointerup",function(){sd=null;});
  var ul=document.getElementById("glist");ul.innerHTML="";
  var rows=[{id:"home",p:d.home,home:1}].concat(d.places.slice().sort(function(a,b){return a.date<b.date?1:-1;}).map(function(p){return {id:p.id,p:p};}));
  rows.forEach(function(r){var li=document.createElement("li");li.setAttribute("data-id",r.id);if(r.home)li.className="home";
    li.innerHTML='<button type="button">'+(r.home?"Houston, TX":gLabel(r.p))+'</button><span class="dt">'+(r.home?"home base":gDate(r.p.date))+"</span>"+(r.home||!r.p.href?"":'<a href="'+r.p.href+'" aria-label="Read entry: '+gLabel(r.p)+'">entry →</a>');
    li.querySelector("button").addEventListener("click",function(){gSelect(r.id,true);});ul.appendChild(li);});
  document.getElementById("g-home").addEventListener("click",function(){G.selMonth=null;tl.querySelectorAll(".mc").forEach(function(x){x.classList.remove("sel");x.setAttribute("aria-pressed","false");});gShow(null);G.pinned=false;gFly(d.home.lon,d.home.lat,1.4);});
  document.getElementById("g-ne").addEventListener("click",function(){gShow(null);G.pinned=false;gFit(d.places);});
  document.getElementById("g-in").addEventListener("click",function(){gFly(G.lon,G.lat,G.zoom*1.8);});
  document.getElementById("g-out").addEventListener("click",function(){gFly(G.lon,G.lat,G.zoom/1.8);});
  var sp=document.getElementById("g-spin");if(reduce){G.paused=true;sp.hidden=true;}sp.addEventListener("click",function(){G.paused=!G.paused;sp.setAttribute("aria-pressed",G.paused);sp.textContent=G.paused?"Spin":"Pause spin";gKick();});}
if(gcv&&gwrap){
  var gdone=0;function gGo(){if(++gdone<4)return;gMake();gUI();gDrag();gSize();gRender();gKick();
    if("IntersectionObserver" in window)new IntersectionObserver(function(es){G.vis=es[0].isIntersecting;if(G.vis){G.last=0;G.dirty=1;gKick();}}).observe(gwrap);
    if("ResizeObserver" in window)new ResizeObserver(function(){G.dirty=1;gKick();}).observe(gframe);
    document.addEventListener("visibilitychange",function(){if(!document.hidden){G.dirty=1;gKick();}});}
  var gstarted=false;function gStart(){if(gstarted)return;gstarted=true;
  fetch("trips.json").then(function(r){return r.json();}).then(function(d){G.d=d;gGo();}).catch(function(){var n=document.getElementById("mapnote");if(n)n.textContent="Map unavailable right now.";});
  gLoadMask("assets/globe/land.png",function(m){G.land=m;gGo();});gLoadMask("assets/globe/blur.png",function(m){G.blur=m;gGo();});gLoadMask("assets/globe/hires.png",function(m){G.hi=m;gGo();});}
  if("IntersectionObserver" in window){var gio=new IntersectionObserver(function(es){if(es[0].isIntersecting){gio.disconnect();gStart();}},{rootMargin:"600px 0px"});gio.observe(gframe);}else gStart();
}
function drawMap(){G.dirty=1;if(G.cols)G.cols=null;gKick();}

var rz;window.addEventListener("resize",function(){clearTimeout(rz);rz=setTimeout(function(){build();kick();drawMap();},150);});
var shelf=document.querySelector(".shelf");
/* ---------- notebooks: pointer tilt + parallax, click opens a 3D reader ---------- */
function esc(s){return String(s).replace(/[&<>"]/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c];});}
var reader=document.getElementById("reader"),rbook=document.getElementById("rd-book"),lastTrigger=null,dialog=reader&&reader.querySelector(".rd-dialog");
if(shelf){
  var books=[].slice.call(shelf.querySelectorAll(".book"));
  books.forEach(function(a){
    a.setAttribute("role","button");a.setAttribute("aria-haspopup","dialog");a.setAttribute("aria-expanded","false");
    if(!reduce){
      a.addEventListener("pointermove",function(e){if(e.pointerType==="touch")return;var r=a.getBoundingClientRect(),
        nx=(e.clientX-r.left)/r.width*2-1,ny=(e.clientY-r.top)/r.height*2-1;
        a.style.setProperty("--ry",(-6+nx*24).toFixed(1)+"deg");a.style.setProperty("--rx",(-ny*20).toFixed(1)+"deg");});
      a.addEventListener("pointerleave",function(){a.style.removeProperty("--ry");a.style.removeProperty("--rx");});}
    a.addEventListener("click",function(e){e.preventDefault();openReader(a);});
    a.addEventListener("keydown",function(e){if(e.key===" "){e.preventDefault();openReader(a);}});});
}
var flyEl=document.getElementById("rd-fly"),state="closed",timers=[],curLi=null;
function later(fn,ms){var t=setTimeout(fn,ms);timers.push(t);return t;}
function clearTimers(){timers.forEach(clearTimeout);timers=[];}
function mobileNow(){return window.matchMedia&&matchMedia("(max-width: 720px)").matches;}
/* FLIP: transform that maps the centered reader book onto the shelf book's position/size/tilt */
function flipTransform(a){
  var ar=a.getBoundingClientRect(),br=rbook.getBoundingClientRect();
  var dx=(ar.left+ar.width/2)-(br.left+br.width/2),dy=(ar.top+ar.height/2)-(br.top+br.height/2),s=ar.width/br.width;
  var r=parseFloat(getComputedStyle(a.closest("li")).getPropertyValue("--r"))||0;if(mobileNow())r*=.6;
  return "translate("+dx.toFixed(1)+"px,"+dy.toFixed(1)+"px) scale("+s.toFixed(4)+") rotateZ("+r+"deg)";}
function openReader(a){
  if(!reader||state!=="closed")return;state="opening";
  var li=a.closest("li");curLi=li;lastTrigger=a;a.setAttribute("aria-expanded","true");
  var d=li.dataset,cv=d.pal?' data-pal="'+esc(d.pal)+'"':"";
  var leaves="";for(var k=1;k<=5;k++)leaves+='<div class="rd-leaf" style="--k:'+k+'"><i class="fr paper"></i><i class="bk paper">'+(k===5?'<b class="ruled">notes</b>':'')+'</i></div>';
  rbook.innerHTML='<span class="rd-shadow" aria-hidden="true"></span>'+
    '<div class="rd-page paper"><p class="eyebrow">trip journal</p>'+
    '<h2 id="rd-title">'+esc(d.title)+'</h2><span class="dt">'+esc(d.date)+'</span>'+
    '<div class="stats2"'+(d.stats?'':' hidden')+'><span>'+esc(d.stats||"")+'</span></div>'+
    '<p>'+esc(d.blurb)+'</p><a class="read" href="'+esc(d.href)+'">Read entry →</a></div>'+leaves+
    '<div class="rd-cover" aria-hidden="true"><i class="fr">'+(d.photo?'<img class="pix" src="'+esc(d.photo)+'" width="168" height="175" alt="">':'<canvas class="pix" data-scene="thumb" data-seed="'+esc(d.seed)+'" data-variant="'+esc(d.variant)+'"'+cv+' width="100" height="104"></canvas>')+
    '<span class="cap"><span class="dt">'+esc(d.date)+'</span><span class="ti">'+esc(d.title)+'</span></span></i><i class="bk">Trip journal</i></div>';
  var mob=mobileNow();rbook.style.setProperty("--prx",(mob?-3:-5)+"deg");rbook.style.setProperty("--pry",(mob?-7:-12)+"deg");
  reader.hidden=false;document.querySelector("main").setAttribute("inert","");document.body.style.overflow="hidden";
  build(true);
  function land(){state="open";rbook.classList.add("landed");var rl=rbook.querySelector(".read");if(rl)rl.focus({preventScroll:true});}
  dialog.focus({preventScroll:true});
  if(reduce){li.classList.add("away");rbook.classList.add("open","up");reader.classList.add("on");land();return;}
  /* phase 0: place the reader book exactly over the shelf book (no transition) */
  rbook.classList.add("pre");flyEl.style.transition="none";flyEl.style.transform=flipTransform(a);void flyEl.offsetWidth;
  li.classList.add("away");
  /* phase 1: float up to centre (transforms only) with backdrop fade + growing shadow */
  flyEl.style.transition="";flyEl.style.transform="none";rbook.classList.remove("pre");rbook.classList.add("up");reader.classList.add("on");
  /* phase 2: cover swings open, leaves flip, land on first page */
  later(function(){rbook.classList.add("open");later(land,1150);},720);
}
function closeReader(){
  if(!reader||reader.hidden||state==="closing"||state==="closed")return;state="closing";clearTimers();
  var a=lastTrigger,li=curLi;
  function finish(){
    if(li)li.classList.remove("away");reader.hidden=true;rbook.innerHTML="";rbook.className="rd-book";flyEl.style.cssText="";
    document.querySelector("main").removeAttribute("inert");document.body.style.overflow="";reader.classList.remove("on");
    if(a){a.setAttribute("aria-expanded","false");a.focus({preventScroll:true});}
    state="closed";build(true);}
  if(reduce){finish();return;}
  var wasOpen=rbook.classList.contains("open");
  /* phase 1: cover and pages close */
  rbook.classList.remove("landed");rbook.classList.remove("open");
  /* phase 2: float back down, shrink, settle into the exact resting spot and tilt */
  later(function(){
    flyEl.style.transform=flipTransform(a);rbook.classList.add("pre");rbook.classList.remove("up");reader.classList.remove("on");
    later(finish,740);},wasOpen?760:0);
}
if(reader){
  reader.addEventListener("click",function(e){if(e.target.hasAttribute&&e.target.hasAttribute("data-close")||e.target===dialog)closeReader();});
  reader.addEventListener("keydown",function(e){
    if(e.key==="Escape"){e.preventDefault();closeReader();}
    if(e.key==="Tab"){var f=[].slice.call(reader.querySelectorAll(".read,.rd-close"));if(!f.length)return;
      var i=f.indexOf(document.activeElement);e.preventDefault();
      f[(i+(e.shiftKey?-1:1)+f.length)%f.length].focus();}});
}

/* ---------- terminal status typewriter ---------- */
var st=document.getElementById("status-text");
if(st){var lines=["somewhere above treeline [placeholder]","building things that scrape the web [placeholder]","planning the next loop hike [placeholder]"],li=0,ci=lines[0].length,dir=-1,sv=true,tm=0;
  st.textContent=lines[0];   /* screen readers get the static #status-sr text; the animated copy is aria-hidden */
  function step(){tm=0;if(!sv||document.hidden)return;var s=lines[li],dl=55;
    if(dir>0){ci++;if(ci>=s.length){dir=0;dl=2600;}}
    else if(dir<0){ci--;if(ci<=0){li=(li+1)%lines.length;dir=1;}}
    else dir=-1;
    st.textContent=lines[li].slice(0,ci);tm=setTimeout(step,dl);}
  function go(){if(!reduce&&!tm&&sv&&!document.hidden)tm=setTimeout(step,2600);}
  if(!reduce){if("IntersectionObserver" in window)new IntersectionObserver(function(es){sv=es[0].isIntersecting;if(sv)go();}).observe(st.parentNode);go();
    document.addEventListener("visibilitychange",go);}
}
})();

/* ---------- photo figures: dithered by default, "develops" to colour; click for lightbox ---------- */
(function(){
  var figs=document.querySelectorAll("figure.photo");if(!figs.length)return;
  var lb=document.createElement("div");lb.className="lightbox";lb.hidden=true;lb.setAttribute("role","dialog");lb.setAttribute("aria-modal","true");lb.setAttribute("aria-label","Photo viewer");
  lb.innerHTML='<div class="lb-inner" tabindex="-1"><img alt=""><p class="lb-cap"></p><button type="button" class="btn lb-close">close ×</button></div>';
  document.body.appendChild(lb);
  var img=lb.querySelector("img"),cap=lb.querySelector(".lb-cap"),btn=lb.querySelector(".lb-close"),back=null;
  function open(fig){back=fig.querySelector(".ph-btn");img.src=fig.dataset.full;img.alt=fig.querySelector("img.d").alt;cap.textContent=fig.querySelector("figcaption").textContent;
    lb.hidden=false;document.body.style.overflow="hidden";document.querySelector("main").setAttribute("inert","");btn.focus({preventScroll:true});}
  function close(){if(lb.hidden)return;lb.hidden=true;img.removeAttribute("src");document.body.style.overflow="";document.querySelector("main").removeAttribute("inert");if(back)back.focus({preventScroll:true});}
  lb.addEventListener("click",function(e){if(e.target===lb||e.target===btn)close();});
  document.addEventListener("keydown",function(e){if(lb.hidden)return;if(e.key==="Escape"){e.preventDefault();close();}
    if(e.key==="Tab"){e.preventDefault();btn.focus();}});
  figs.forEach(function(f){var b=f.querySelector(".ph-btn");
    b.addEventListener("click",function(){
      open(f);});});
})();
