/* House dither module (runtime). Palette + settings are inlined from src/palette.json at build time.
   Style: ORDERED BAYER 8x8 everywhere. Deterministic per pixel, so animation never crawls or shimmers.
   Procedural art: scalar field in [0,1] -> N-step ramp (ramp index = floor(v*(N-1) + threshold)).
   Pixel scale: every dithered surface is drawn at an integer multiple (Dither.dp() CSS px per dither pixel). */
var Dither=(function(){
  var P={"_help":"House dither style: ONE source of truth for build scripts (tools/dither.py), the build (CSS vars, --dp) and the runtime (src/dither.js is inlined into main.js).","dither":{"matrix":"bayer8","dpDesktop":3,"dpMobile":2,"mobileMaxWidth":720},"ink":"#14201a","photo":["#16201b","#24392e","#2c4a3b","#4f7a62","#8fae98","#7b8179","#b9b49f","#d9d0b8","#f1ebdd","#c4572a","#e38a52"],"light":{"scene":["#16201b","#2c4a3b","#c4572a","#f1ebdd"],"ocean":["#16221c","#33463c","#7d8f80","#c9cfbd"],"land":["#16221c","#2c4a3b","#4f7a62","#a2c2a0"],"halo":"#6f9a7f","star":"#16221c","arc":"#d2622f","arcHi":"#f3ecd9"},"dark":{"scene":["#0b100e","#1f3329","#b5602f","#f0c89a"],"ocean":["#060a08","#0c1511","#16261f","#27443a"],"land":["#060a08","#1c382b","#3d6a51","#86b69a"],"halo":"#86b69a","star":"#e9e4d6","arc":"#d2622f","arcHi":"#f3ecd9"}};
  function bayer(n){var m=[[0,2],[3,1]];while(m.length<n){var s=m.length,r=[];for(var y=0;y<s*2;y++){r[y]=[];for(var x=0;x<s*2;x++){var b=m[y%s][x%s]*4,q=(y<s?0:2)+(x<s?0:1);r[y][x]=b+[0,2,3,1][q];}}m=r;}return m;}
  function flat(n){var m=bayer(n),t=n*n,o=new Float32Array(t);for(var y=0;y<n;y++)for(var x=0;x<n;x++)o[y*n+x]=(m[y][x]+.5)/t;return o;}
  var M={8:flat(8)};
  function hex(c){var n=parseInt(c.slice(1),16);return [(n>>16)&255,(n>>8)&255,n&255];}
  function u32(c){var n=parseInt(c.slice(1),16);return (255<<24)|((n&255)<<16)|(n>>8&255)<<8|(n>>16&255);}
  /* ordered Bayer 8x8 (the only mode): field v (w*h floats in [0,1]) -> palette indices 0..N-1 */
  function ordered(v,w,h,N,out){var T=M[8];
    for(var y=0;y<h;y++)for(var x=0;x<w;x++){var i=y*w+x,t=Math.max(0,Math.min(1,v[i]))*(N-1),b=Math.floor(t);out[i]=Math.min(N-1,b+((t-b)>T[(y&7)*8+(x&7)]?1:0));}}
  function dp(){return (window.matchMedia&&matchMedia("(max-width:"+P.dither.mobileMaxWidth+"px)").matches)?P.dither.dpMobile:P.dither.dpDesktop;}
  function theme(t){return P[t==="dark"?"dark":"light"];}
  return {P:P,M8:M[8],ordered:ordered,dp:dp,theme:theme,hex:hex,u32:u32,scene:function(t){return theme(t).scene.map(hex);}};
})();

/* Sound: opt-in UI audio. No deps, no audio files. Global `Sound`, concatenated before main.js (like dither.js).
   Every sound is synthesised by `Synth` (pure functions, deterministic seeds) and "dithered" literally:
   sample-rate reduced (sample & hold), quantised to 5-6 bits with the same Bayer 8x8 threshold matrix the visuals use,
   then softened with a gentle low-pass. All pitched sounds come from ONE scale: A minor pentatonic (A C D E G).
   Nothing touches AudioContext until a user gesture AND sound is on. Web Audio only, so the iPhone silent switch is respected. */
var Synth=(function(){
"use strict";
var SR=22050;
var N={A1:55,A2:110,E3:164.81,A3:220,C4:261.63,D4:293.66,E4:329.63,G4:392,A4:440,C5:523.25,D5:587.33,E5:659.25,G5:783.99,A5:880};
var PENT=["A4","C5","D5","E5","G5"];
function rng(s){return function(){s|=0;s=s+0x6D2B79F5|0;var t=Math.imul(s^s>>>15,1|s);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};}
/* Bayer 8x8, same recursive matrix as dither.js, flattened and normalised to [0,1) */
var B=(function(){var m=[[0]];while(m.length<8){var n=m.length,o=[];for(var y=0;y<2*n;y++){o.push([]);for(var x=0;x<2*n;x++){var v=4*m[y%n][x%n];o[y].push(v+[[0,2],[3,1]][(y/n)|0][(x/n)|0]);}}m=o;}
  var f=[];for(var y=0;y<8;y++)for(var x=0;x<8;x++)f.push((m[y][x]+.5)/64);return f;})();
function bay(i){return B[(i&7)+(((i>>3)&7)<<3)];}
function tri(p){p-=Math.floor(p);return p<.5?4*p-1:3-4*p;}
function sq(p){return p-Math.floor(p)<.5?1:-1;}
function env(t,a,d){return t<a?t/a:Math.exp(-(t-a)*5/d);}
function buf(sec){return new Float32Array(Math.round(sec*SR));}
/* the dither stage: sample & hold -> ordered-dither quantise -> soft low-pass -> peak normalise */
function crush(x,bits,hold,lp,peak,rms){
  var L=1<<(bits-1),y=new Float32Array(x.length),h=0,a=1-Math.exp(-2*Math.PI*lp/SR),z=0,m=0,i;
  for(i=0;i<x.length;i++){if(i%hold===0)h=x[i];var q=Math.floor(h*L+bay(i))/L;z+=a*(q-z);y[i]=z;if(Math.abs(z)>m)m=Math.abs(z);}
  var g=m?peak/m:1;if(rms){var e=0;for(i=0;i<y.length;i++)e+=y[i]*y[i];e=Math.sqrt(e/y.length);if(e)g=Math.min(g,rms/e);}for(i=0;i<y.length;i++)y[i]*=g;
  var f=Math.min(y.length,Math.round(.006*SR));for(i=0;i<f;i++){y[i]*=i/f;y[y.length-1-i]*=i/f;}return y;}
/* stepped pentatonic phrase: notes[] each `ms` long, square+triangle blend */
function phrase(notes,ms,mix,bits,hold,lp,gap){
  var per=Math.round(ms/1000*SR),x=buf(notes.length*ms/1000+(gap||0)),ph=0,k,i;
  for(k=0;k<notes.length;k++){var f=N[notes[k]]||notes[k];for(i=0;i<per;i++){var t=i/SR;ph+=f/SR;
    var s=mix*sq(ph)+(1-mix)*tri(ph);x[k*per+i]+=s*env(t,.004,ms/1000*.9);}}
  return crush(x,bits,hold,lp,.9);}
/* paper flutter: bursts of noise whose bandwidth sweeps DOWN, gated by the Bayer matrix so the grain is literally dithered */
function flutter(seed,bursts,burstMs,gapMs,hi,lo,bits,hold){
  var r=rng(seed),bl=Math.round(burstMs/1000*SR),gl=Math.round(gapMs/1000*SR),x=buf((bursts*(burstMs+gapMs)+10)/1000),z=0;
  for(var b=0;b<bursts;b++){var o=b*(bl+gl);for(var i=0;i<bl;i++){var u=i/bl,fc=hi*Math.pow(lo/hi,(b+u)/bursts),a=1-Math.exp(-2*Math.PI*fc/SR);
    var n=r()*2-1;z+=a*(n-z);var e=env(i/SR,.003,burstMs/1000*.8)*(1-.18*b/bursts);
    var gate=e>bay(((i>>3)+b*5)*3+((i>>3)&7))?1:0.25;x[o+i]=z*e*gate;}}
  return crush(x,bits,hold,3200,.9,.12);}
var R={
  hover:function(){return flutter(11,1,70,0,5200,2600,5,3);},
  pickup:function(){return phrase(["A3","C4","D4","E4","G4","A4"],52,.35,7,2,3000);},
  down:function(){return phrase(["A4","G4","E4","D4","C4","A3"],52,.35,7,2,3000);},
  cover:function(){var x=buf(.34),r=rng(5),ph=0,z=0,i;
    for(i=0;i<x.length;i++){var t=i/SR,f=130*Math.pow(90/130,t/.3)*(1+.03*Math.sin(2*Math.PI*26*t));ph+=f/SR;
      z+=.05*((r()*2-1)-z);x[i]=((tri(ph)+.7*tri(2*ph)+.5*sq(3*ph)*.6+.35*tri(4*ph))*.5+z*.5)*env(t,.05,.22);}
    var c=Math.round(.26*SR),r2=rng(9),w=0;for(i=0;i<Math.round(.012*SR);i++){w+=.5*((r2()*2-1)-w);x[c+i]+=w*1.1*env(i/SR,.001,.008);}
    return crush(x,7,3,2200,.9);},
  flip0:function(){return flutter(21,3,22,12,5200,1400,6,2);},
  flip1:function(){return flutter(22,3,20,14,4800,1200,6,2);},
  flip2:function(){return flutter(23,3,24,10,5600,1500,6,2);},
  land:function(){return phrase(["E5"],46,.5,7,2,3000);},
  close:function(){var f=flutter(31,3,24,8,3200,700,6,3),x=buf(.19),i;for(i=0;i<f.length&&i<x.length;i++)x[i]=f[i]*.9;
    var ph=0;for(i=0;i<Math.round(.1*SR);i++){ph+=N.A2/SR;x[i+Math.round(.07*SR)]+=(tri(ph)+.8*tri(2*ph)+.5*tri(3*ph))*.4*env(i/SR,.004,.08);}return crush(x,6,3,2000,.9,.14);},
  thud:function(){var x=buf(.3),r=rng(7),ph=0,z=0,i;
    for(i=0;i<x.length;i++){var t=i/SR,f=N.A2*Math.pow(.62,t/.2);ph+=f/SR;z+=.08*((r()*2-1)-z);
      x[i]=(tri(ph)+.8*tri(2*ph)+.55*tri(3*ph)+.3*tri(4*ph))*.5*env(t,.004,.17)+z*.5*env(t,.002,.07);}
    return crush(x,6,4,800,.95);},
  themeDay:function(){return phrase(["E4","A4"],72,.4,7,2,3000);},
  themeNight:function(){return phrase(["A3","E3"],72,.4,7,2,3000);},
  tl:function(){return phrase(["A5"],22,.7,6,2,3200);},
  lbopen:function(){return phrase(["A4","E5"],64,.4,7,2,3000);},
  lbclose:function(){return phrase(["E5","A4"],64,.4,7,2,3000);}
};
for(var q=0;q<5;q++)(function(n){R["pin"+n]=function(){return phrase([PENT[n]],72,.55,7,2,3000);};})(q);
return {SR:SR,render:function(n){return R[n]();},names:Object.keys(R),scale:N};
})();

var Sound=(function(){
"use strict";
var reduce=window.matchMedia&&matchMedia("(prefers-reduced-motion: reduce)").matches;
var canHover=window.matchMedia&&matchMedia("(hover: hover) and (pointer: fine)").matches;
var on=false,ctx=null,master=null,sfx=null,ui=null,cache={},armed=false,voices=0,lastHover=0;
try{on=localStorage.getItem("sound")==="on";}catch(e){}
/* motion-linked sounds are skipped when the animation itself is skipped */
var MOTION={hover:1,pickup:1,cover:1,flip:1,land:1,close:1,down:1,thud:1};
/* relative loudness (linear gain on peak-normalised buffers). hierarchy: thud > close > cover > pickup/flip > land/theme > pin/lightbox > timeline > hover */
var LV={thud:.45,close:.3,cover:.27,pickup:.14,down:.12,flip:.15,land:.1,theme:.09,pin:.08,lbopen:.07,lbclose:.07,tl:.045,hover:.03};
function jit(a){return 1+(Math.random()*2-1)*a;}
function init(){
  if(ctx)return true;var AC=window.AudioContext||window.webkitAudioContext;if(!AC)return false;
  try{ctx=new AC({latencyHint:"interactive"});}catch(e){return false;}
  master=ctx.createGain();master.gain.value=.9;
  var comp=ctx.createDynamicsCompressor();comp.threshold.value=-14;comp.knee.value=12;comp.ratio.value=4;comp.attack.value=.004;comp.release.value=.18;
  master.connect(comp);comp.connect(ctx.destination);
  sfx=ctx.createGain();sfx.gain.value=.85;sfx.connect(master);ui=ctx.createGain();ui.gain.value=.7;ui.connect(master);
  return true;}
function live(){return on&&ctx&&ctx.state==="running";}
function get(n){
  if(cache[n])return cache[n];var d=Synth.render(n),b=ctx.createBuffer(1,d.length,Synth.SR);b.getChannelData(0).set(d);return(cache[n]=b);}
function fire(n,gain,rate,bus){
  var s=ctx.createBufferSource(),g=ctx.createGain();s.buffer=get(n);s.playbackRate.value=rate||1;g.gain.value=gain;s.connect(g);g.connect(bus||sfx);
  voices++;s.onended=function(){voices--;};s.start(ctx.currentTime+.005);}
function duck(amount,secs){var t=ctx.currentTime;ui.gain.cancelScheduledValues(t);ui.gain.setTargetAtTime(.7*amount,t,.02);ui.gain.setTargetAtTime(.7,t+secs,.15);}
function play(name,arg){
  if(!live()||(reduce&&MOTION[name]))return;
  if(voices>8&&name!=="thud"&&name!=="close")return;
  var v=LV[name];
  switch(name){
    case"hover":{var n=performance.now();if(!canHover||n-lastHover<600)return;lastHover=n;fire("hover",v,jit(.06));break;}
    case"flip":fire("flip"+(Math.random()*3|0),v*(1-Math.random()*.2),jit(.06));break;
    case"close":fire("close",v,1);duck(.5,.5);break;
    case"thud":fire("thud",v,jit(.02));duck(.5,.4);break;
    case"theme":fire(arg?"themeNight":"themeDay",v,1,ui);break;
    case"pin":fire("pin"+((arg|0)%5),v,1,ui);break;
    case"tl":case"lbopen":case"lbclose":fire(name,v,name==="tl"?jit(.02):1,ui);break;
    default:fire(name,v,jit(.03));}}
/* gesture plumbing: a remembered "on" still waits for the first real gesture */
function wake(){
  if(!on)return;if(!init())return;
  if(ctx.state!=="running"){var p=ctx.resume();if(p&&p.catch)p.catch(function(){});}}
function arm(){if(armed)return;armed=true;
  ["pointerdown","keydown"].forEach(function(ev){window.addEventListener(ev,function h(){window.removeEventListener(ev,h,true);wake();},true);});}
document.addEventListener("visibilitychange",function(){
  if(!ctx)return;if(document.hidden){if(ctx.suspend)ctx.suspend();}else if(on){wake();}});
function ui_(btn){btn.setAttribute("aria-pressed",String(on));}
function bind(btn){
  if(!btn)return;ui_(btn);
  btn.addEventListener("click",function(){
    on=!on;try{localStorage.setItem("sound",on?"on":"off");}catch(e){}ui_(btn);
    if(on){wake();setTimeout(function(){if(live())play("theme",0);},60);}else if(ctx&&ctx.suspend){ctx.suspend();}});
  if(on)arm();}
return {bind:bind,play:play,synth:Synth,levels:LV,get on(){return on;},get ctx(){return ctx;}};
})();

/* codyklr.com concept: no deps, no modules (works from file://) */
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
function palette(){return Dither.scene(root.getAttribute("data-theme")==="dark"?"dark":"light");}
function paint(ctx,idx,w,h,pal){var img=ctx.createImageData(w,h),d=img.data;
  for(var i=0;i<idx.length;i++){var c=pal[idx[i]];d[i*4]=c[0];d[i*4+1]=c[1];d[i*4+2]=c[2];d[i*4+3]=255;}ctx.putImageData(img,0,0);}

/* ---------- scene: sun, ridges, fog -> scalar field in [0,1] ---------- */
/* glyph mask at dither resolution: 1 = glyph, 2 = 1px ring, 0 = scene. Departure Mono at an 11px multiple stays crisp */
function nameMask(txt,w,h){
  var c=document.createElement("canvas");c.width=w;c.height=h;var x=c.getContext("2d");if(!x)return null;
  var k=Math.max(1,Math.floor(h*.5/11)),fs;
  for(;k>=1;k--){fs=11*k;x.font=fs+'px "Departure Mono",monospace';if(x.measureText(txt).width<=w*.92)break;}
  if(k<1){fs=11;x.font=fs+'px "Departure Mono",monospace';}
  x.textBaseline="alphabetic";x.fillStyle="#000";var px=Math.round(Math.max(3,w*.045)),py=Math.round(h*.5+fs*.36);
  x.fillText(txt,px,py);var d=x.getImageData(0,0,w,h).data,m=new Uint8Array(w*h),i,X,Y;
  for(i=0;i<w*h;i++)if(d[i*4+3]>127)m[i]=1;
  for(Y=0;Y<h;Y++)for(X=0;X<w;X++){i=Y*w+X;if(m[i])continue;
    if((X>0&&m[i-1]===1)||(X<w-1&&m[i+1]===1)||(Y>0&&m[i-w]===1)||(Y<h-1&&m[i+w]===1))m[i]=2;}
  return m;}
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
    if(o.name)self.engrave(f);
  };
  /* name encoded in the dither: glyph pixels pin the field to the top of the ramp (lightest scene colour) and a
     1px ring pins it to the bottom (darkest), so the name reads on sky, sun, ridge and fog in both themes while it
     stays inside the same 4-colour Bayer texture; the fog drifts around it */
  this.mask=null;
  this.engrave=function(f){
    var m=self.mask;if(!m){m=self.mask=nameMask(o.name,w,h);}if(!m)return;
    for(var i=0;i<w*h;i++){var k=m[i];if(!k)continue;f[i]=k===1?1:0;}};
  this.draw=function(t,pal,night2){
    self.compute(t,night2);
    Dither.ordered(self.field,w,h,4,self.idx);
    paint(canvas.getContext("2d"),self.idx,w,h,pal);};
}

/* ---------- canvases ---------- */
var scenes=[],hero=null;   /* house style = ordered bayer 8x8 only (src/dither.js) */
function thumbVariant(c,kind,seed){var w=c.width,h=c.height,v=new Float32Array(w*h),idx=new Uint8Array(w*h);
  return {draw:function(t,pal){
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
    Dither.ordered(v,w,h,4,idx);paint(c.getContext("2d"),idx,w,h,pal);}};}
function altPal(p,which){function mx(a,b,t){return [0,1,2].map(function(i){return Math.round(a[i]+(b[i]-a[i])*t);});}
  return which==="alt"?[p[0],p[1],mx(p[1],p[3],.55),p[3]]:[p[0],mx(p[0],p[3],.25),mx(p[1],p[3],.35),p[3]];}
function isNight(){return root.getAttribute("data-theme")==="dark";}
/* integer pixel scaling: avoids Bayer moire ("banding") from fractional CSS scaling */
function fit(c,availOverride){
  if(!c._bw){c._bw=c.width;c._bh=c.height;}
  c.style.width="";var bd=c.offsetWidth-c.clientWidth,avail=(availOverride||c.parentElement.clientWidth||c._bw*3)-bd;
  var s=Dither.dp(),w=Math.max(40,Math.floor(avail/s)),mr=s<3&&c.getAttribute("data-mratio"),h=Math.round(mr?w*+mr:w*c._bh/c._bw);
  if(c.width!==w)c.width=w; if(c.height!==h)c.height=h;
  c.style.width=(w*s+bd)+"px";c.style.maxWidth="100%";}
function makeEntry(c){
  var kind=c.getAttribute("data-scene"),o={seed:+c.getAttribute("data-seed")||1},v=c.getAttribute("data-variant");
  if(kind==="hero"){o.layers=4;o.sunX=.72;o.sunY=.3;o.sunR=.1;o.name=c.getAttribute("data-name");}
  else if(kind==="banner"){o.layers=3;o.sunX=.3;o.sunY=.38;o.sunR=.09;}
  else if(v&&v!=="ridge")return {c:c,s:thumbVariant(c,v,o.seed),kind:"thumb",pal:c.getAttribute("data-pal")};
  else {o.layers=v==="ridge"?5:2+(o.seed%3);o.sunX=.2+((o.seed*37)%60)/100;o.sunY=.35+((o.seed*13)%25)/100;o.sunR=.1;}
  var e={c:c,s:new Scene(c,o),kind:kind};if(kind==="hero")hero=e;
  if(kind==="thumb"&&c.getAttribute("data-pal"))e.pal=c.getAttribute("data-pal");return e;}
var tick=0,io=null,queue=[],qBusy=false,firstBuild=true;
function idle(fn){return (window.requestIdleCallback||function(f){return setTimeout(function(){f({timeRemaining:function(){return 8;}});},40);})(fn,{timeout:700});}
function drawEntry(e,pal,n){if(e.kind==="hero"||e.kind==="banner")e.s.draw(tick,pal,n);else e.s.draw(0,e.pal?altPal(pal,e.pal):pal,n);e.stale=false;}
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
  if(ts-last>=gap){last=ts;tick+=gap/1000;var pal=palette(),n=isNight();anim.forEach(function(e){if(e.near)e.s.draw(tick,pal,n);});}
  rafId=requestAnimationFrame(loop);}
function kick(){if(!reduce&&!rafId&&!document.hidden&&animVisible())rafId=requestAnimationFrame(loop);}
document.addEventListener("visibilitychange",kick);
build();kick();

/* controls */
var tb=document.getElementById("theme");
if(tb)tb.addEventListener("click",function(){dark=!dark;try{localStorage.setItem("theme",dark?"dark":"light");}catch(e){}applyTheme();drawAll();drawMap();Sound.play("theme",dark);});
Sound.bind(document.getElementById("snd"));


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
var G={gl:null,hl:null,d:null,land:null,blur:null,hi:null,lon:-62,lat:22,zoom:1,vLon:0,fly:null,dirty:1,raf:null,last:0,vis:true,paused:false,hover:false,N:0,S:1,R:0,theme:"",active:null,selMonth:null,drag:null,justDrag:0,cols:null};
var gov=null,gcv=document.getElementById("gcanvas"),gwrap=document.getElementById("gwrap"),gframe=document.getElementById("gframe"),gpins=document.getElementById("gpins"),gcard=document.getElementById("gcard");
var D2R=Math.PI/180,M8=Dither.M8;
var MON=["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
function gDate(s){var p=s.split("-");return MON[+p[1]-1]+" "+p[0];}
function gLabel(p){return p.label||(p.name+", "+p.region);}
function hexU(h){var n=parseInt(h.slice(1),16);return (255<<24)|((n&255)<<16)|(n>>8&255)<<8|(n>>16&255);}
var RAMPS=Dither.P;
function gTheme(){var t=document.documentElement.getAttribute("data-theme")==="dark"?"dark":"light";if(G.cols&&G.theme===t)return;G.theme=t;var r=RAMPS[t];
  G.cols={ocean:r.ocean.map(hexU),land:r.land.map(hexU),halo:hexU(r.halo),star:hexU(r.star),arc:hexU(r.arc),arcHi:hexU(r.arcHi)};
  function rgb(h){var c=Dither.hex(h);return [c[0]/255,c[1]/255,c[2]/255];}G.rgb={ocean:r.ocean.map(rgb),land:r.land.map(rgb),halo:rgb(r.halo)};}
function gLoadMask(src,cb){var im=new Image();im.onload=function(){var c=document.createElement("canvas");c.width=im.width;c.height=im.height;var x=c.getContext("2d");x.drawImage(im,0,0);var d=x.getImageData(0,0,c.width,c.height).data,a=new Uint8Array(c.width*c.height);for(var i=0;i<a.length;i++)a[i]=d[i*4];cb({a:a,w:c.width,h:c.height});};im.src=src;}
function bil(m,u,v,wrap){var x=u*m.w-.5,y=v*m.h-.5,x0=Math.floor(x),y0=Math.floor(y),fx=x-x0,fy=y-y0,w=m.w,h=m.h;
  var x1=x0+1,y1=y0+1;if(wrap){x0=((x0%w)+w)%w;x1=((x1%w)+w)%w;}else{x0=x0<0?0:x0>=w?w-1:x0;x1=x1<0?0:x1>=w?w-1:x1;}
  y0=y0<0?0:y0>=h?h-1:y0;y1=y1<0?0:y1>=h?h-1:y1;var a=m.a;
  return ((a[y0*w+x0]*(1-fx)+a[y0*w+x1]*fx)*(1-fy)+(a[y1*w+x0]*(1-fx)+a[y1*w+x1]*fx)*fy)/255;}
function gSize(){var cs=getComputedStyle(gframe),cw=gframe.clientWidth-(parseFloat(cs.paddingLeft)||0)-(parseFloat(cs.paddingRight)||0);if(!cw)return false;var S=Dither.dp(),N=Math.floor(cw/S);if(N!==G.N||S!==G.S){G.N=N;G.S=S;G.R=N/2-6;gcv.width=N;gcv.height=N;gcv.style.width=gcv.style.height="";gwrap.style.width=gwrap.style.height=(N*S)+"px";gAlloc();}return true;}
function gAlloc(){var N=G.N,t=gcv;if(G.gl){gov.width=N;gov.height=N;t=gov;}G.img=t.getContext("2d").createImageData(N,N);G.u32=new Uint32Array(G.img.data.buffer);
  G.stars=[];for(var y=0;y<N;y++)for(var x=0;x<N;x++)if(((x*73856093^y*19349663)>>>0)%520===0)G.stars.push(x,y);}
function gRender(){if(!G.land||!G.blur||!G.hi||!G.d||!gSize())return;gTheme();if(G.gl)gRenderGL();else gRenderCPU();}
function gRenderCPU(){var N=G.N,R=G.R*G.zoom,cx=N/2,cy=N/2,u32=G.u32,C=G.cols,
  lam0=G.lon*D2R,ph1=G.lat*D2R,sp=Math.sin(ph1),cp=Math.cos(ph1),hb=G.d.hires.bbox,ppdw=1/(hb[2]-hb[0]),ppdh=1/(hb[3]-hb[1]),
  Lx=-.5,Ly=.5,Lz=.72,Ll=Math.sqrt(Lx*Lx+Ly*Ly+Lz*Lz);Lx/=Ll;Ly/=Ll;Lz/=Ll;
  var grat=G.zoom<3?15:5,gthr=.4/(R*D2R),dark=G.theme==="dark",ro=C.ocean,rl=C.land,hz=1.0+4.5/R,
  A=G.land,Bm=G.blur,H=G.hi;
  for(var py=0;py<N;py++){var Y=(cy-py-.5)/R;for(var px=0;px<N;px++){var X=(px+.5-cx)/R,r2=X*X+Y*Y,i=py*N+px,bay=M8[(py&7)*8+(px&7)];
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
/* ---------- WebGL path: same raycast, bilinear lookups, shading, limb glow and Bayer 8x8 dither, in a fragment shader ---------- */
var GL_VS="attribute vec2 a;void main(){gl_Position=vec4(a,0.,1.);}";
var GL_FS=[
"#ifdef GL_FRAGMENT_PRECISION_HIGH","precision highp float;","#else","precision mediump float;","#endif",
"uniform float uN,uR,uLam0,uSp,uCp,uZoom,uGrat,uGthr,uHz,uDark;",
"uniform vec4 uHb;uniform vec3 uL,uHalo,uO0,uO1,uO2,uO3,uA0,uA1,uA2,uA3;",
"uniform vec2 uSzA,uSzB,uSzH;uniform sampler2D uA,uB,uH,uY;",
"float bil(sampler2D t,vec2 sz,float u,float v,float wr){",
"float x=u*sz.x-.5,y=v*sz.y-.5,x0=floor(x),y0=floor(y),fx=x-x0,fy=y-y0,x1=x0+1.,y1=y0+1.;",
"if(wr>.5){x0=mod(x0,sz.x);x1=mod(x1,sz.x);}else{x0=clamp(x0,0.,sz.x-1.);x1=clamp(x1,0.,sz.x-1.);}",
"y0=clamp(y0,0.,sz.y-1.);y1=clamp(y1,0.,sz.y-1.);",
"float a=texture2D(t,(vec2(x0,y0)+.5)/sz).r,b=texture2D(t,(vec2(x1,y0)+.5)/sz).r,c=texture2D(t,(vec2(x0,y1)+.5)/sz).r,d=texture2D(t,(vec2(x1,y1)+.5)/sz).r;",
"return mix(mix(a,b,fx),mix(c,d,fx),fy);}",
"vec3 pick(float i,vec3 c0,vec3 c1,vec3 c2,vec3 c3){return i<.5?c0:(i<1.5?c1:(i<2.5?c2:c3));}",
"void main(){",
"float px=floor(gl_FragCoord.x),pyb=floor(gl_FragCoord.y),py=uN-1.-pyb;",
"float X=(px+.5-uN*.5)/uR,Y=(pyb+.5-uN*.5)/uR,r2=X*X+Y*Y;",
"float bay=(floor(texture2D(uY,(vec2(mod(px,8.),mod(py,8.))+.5)/8.).r*255.+.5)+.5)/64.;",
"if(r2>1.){float rr=sqrt(r2);if(rr<uHz){float g=1.-(rr-1.)/(uHz-1.);g=g*g*.9;if(g>bay){gl_FragColor=vec4(uHalo,1.);return;}}gl_FragColor=vec4(0.);return;}",
"float Z=sqrt(1.-r2),sphi=clamp(Z*uSp+Y*uCp,-1.,1.),phi=asin(sphi);",
"float wx=Z*uCp-Y*uSp;float lam=uLam0+((abs(X)+abs(wx))<1e-6?0.:atan(X,wx));",
"float latd=phi*57.29577951308232,lond=lam*57.29577951308232;lond=mod(lond+540.,360.)-180.;",
"float m,bl,hx=(lond-uHb.x)/(uHb.z-uHb.x),hy=(uHb.w-latd)/(uHb.w-uHb.y);",
"vec2 uv=vec2((lond+180.)/360.,(90.-latd)/180.);",
"if(hx>0.&&hx<1.&&hy>0.&&hy<1.)m=bil(uH,uSzH,hx,hy,0.);else m=bil(uA,uSzA,uv.x,uv.y,1.);",
"bl=bil(uB,uSzB,uv.x,uv.y,1.);",
"float dif=X*uL.x+Y*uL.y+Z*uL.z,sh=clamp((dif+.08)/.5,0.,1.);sh=sh*sh*(3.-2.*sh);",
"float v;bool land=m>.5;",
"if(land)v=(.52+.4*bl)*(.16+.84*sh);else{v=(.38+.5*(1.-bl*.5))*(.14+.86*sh);if(m>0.)v+=.08*m;}",
"v+=(1.-Z)*(1.-Z)*.22*(.3+sh);",
"float dl=mod(latd+uGrat*.5,uGrat)-uGrat*.5,dn=mod(lond+uGrat*.5,uGrat)-uGrat*.5,cl=max(.2,sqrt(1.-sphi*sphi));",
"if(abs(dl)<uGthr/Z||abs(dn)<uGthr/(Z*cl))v+=(uZoom<3.?.07:.04);",
"v=clamp(v,0.,.999);float t=v*3.,lo=floor(t);float k=(t-lo)>bay?lo+1.:lo;",
"gl_FragColor=vec4(land?pick(k,uA0,uA1,uA2,uA3):pick(k,uO0,uO1,uO2,uO3),1.);}"].join("\n");

function gShader(gl,type,src){var sh=gl.createShader(type);gl.shaderSource(sh,src);gl.compileShader(sh);return gl.getShaderParameter(sh,gl.COMPILE_STATUS)?sh:null;}
function gTex(gl,unit,w,h,data){var t=gl.createTexture();gl.activeTexture(gl.TEXTURE0+unit);gl.bindTexture(gl.TEXTURE_2D,t);gl.pixelStorei(gl.UNPACK_ALIGNMENT,1);
  gl.texImage2D(gl.TEXTURE_2D,0,gl.LUMINANCE,w,h,0,gl.LUMINANCE,gl.UNSIGNED_BYTE,data);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);return t;}
/* (re)build every GL resource; used on first init and after webglcontextrestored */
function gGLBuild(gl){
  var hp=gl.getShaderPrecisionFormat&&gl.getShaderPrecisionFormat(gl.FRAGMENT_SHADER,gl.HIGH_FLOAT);if(!hp||!hp.precision)return false;
  var mx=gl.getParameter(gl.MAX_TEXTURE_SIZE);if(Math.max(G.land.w,G.land.h,G.blur.w,G.blur.h,G.hi.w,G.hi.h)>mx)return false;
  var vs=gShader(gl,gl.VERTEX_SHADER,GL_VS),fs=gShader(gl,gl.FRAGMENT_SHADER,GL_FS);if(!vs||!fs)return false;
  var pr=gl.createProgram();gl.attachShader(pr,vs);gl.attachShader(pr,fs);gl.linkProgram(pr);if(!gl.getProgramParameter(pr,gl.LINK_STATUS))return false;
  gl.useProgram(pr);var bf=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,bf);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,3,-1,-1,3]),gl.STATIC_DRAW);
  var al=gl.getAttribLocation(pr,"a");gl.enableVertexAttribArray(al);gl.vertexAttribPointer(al,2,gl.FLOAT,false,0,0);
  var by=new Uint8Array(64);for(var i=0;i<64;i++)by[i]=Math.round(M8[i]*64-.5);
  gTex(gl,0,G.land.w,G.land.h,G.land.a);gTex(gl,1,G.blur.w,G.blur.h,G.blur.a);gTex(gl,2,G.hi.w,G.hi.h,G.hi.a);gTex(gl,3,8,8,by);
  var U={};["uN","uR","uLam0","uSp","uCp","uZoom","uGrat","uGthr","uHz","uDark","uHb","uL","uHalo","uO0","uO1","uO2","uO3","uA0","uA1","uA2","uA3","uSzA","uSzB","uSzH"].forEach(function(n){U[n]=gl.getUniformLocation(pr,n);});
  gl.uniform1i(gl.getUniformLocation(pr,"uA"),0);gl.uniform1i(gl.getUniformLocation(pr,"uB"),1);gl.uniform1i(gl.getUniformLocation(pr,"uH"),2);gl.uniform1i(gl.getUniformLocation(pr,"uY"),3);
  gl.uniform2f(U.uSzA,G.land.w,G.land.h);gl.uniform2f(U.uSzB,G.blur.w,G.blur.h);gl.uniform2f(U.uSzH,G.hi.w,G.hi.h);
  var hb=G.d.hires.bbox;gl.uniform4f(U.uHb,hb[0],hb[1],hb[2],hb[3]);
  var Lx=-.5,Ly=.5,Lz=.72,Ll=Math.sqrt(Lx*Lx+Ly*Ly+Lz*Lz);gl.uniform3f(U.uL,Lx/Ll,Ly/Ll,Lz/Ll);
  gl.disable(gl.DEPTH_TEST);gl.disable(gl.BLEND);gl.clearColor(0,0,0,0);
  G.U=U;G.glN=0;return true;}
/* drop to the CPU renderer: WebGL canvases can't give out a 2d context, so swap in a fresh canvas element */
function gFallback(){var had=!!G.gl;G.gl=null;G.glLost=false;clearTimeout(G.glTimer);
  if(had){var n=gcv.cloneNode(false);gcv.parentNode.replaceChild(n,gcv);gcv=n;}
  if(gov){gov.remove();gov=null;}gwrap.setAttribute("data-renderer","cpu");G.N=0;G.dirty=1;gKick();}
function gInitGL(){
  var mode=(location.search.match(/globe=(cpu|gl)/)||[])[1];
  if(mode==="cpu"||!window.WebGLRenderingContext||!G.land||!G.blur||!G.hi||!G.d){gwrap.setAttribute("data-renderer","cpu");return;}
  var gl=null;try{gl=gcv.getContext("webgl",{alpha:true,premultipliedAlpha:true,antialias:false,depth:false,stencil:false,preserveDrawingBuffer:false,powerPreference:"high-performance",failIfMajorPerformanceCaveat:mode!=="gl"});}catch(e){}
  if(!gl){gwrap.setAttribute("data-renderer","cpu");return;}
  G.gl=gl;
  if(!gGLBuild(gl)){gFallback();return;}
  gov=document.createElement("canvas");gov.className="pix gov";gov.setAttribute("aria-hidden","true");gcv.parentNode.insertBefore(gov,gcv.nextSibling);
  gcv.addEventListener("webglcontextlost",function(e){e.preventDefault();G.glLost=true;clearTimeout(G.glTimer);G.glTimer=setTimeout(function(){if(G.glLost)gFallback();},3000);},false);
  gcv.addEventListener("webglcontextrestored",function(){clearTimeout(G.glTimer);if(gGLBuild(gl)){G.glLost=false;G.dirty=1;gKick();}else gFallback();},false);
  gwrap.setAttribute("data-renderer","webgl");}
function gRenderGL(){var gl=G.gl;if(G.glLost||!gl)return;if(gl.isContextLost()){G.glLost=true;return;}
  var N=G.N,R=G.R*G.zoom,U=G.U,C=G.rgb,ph1=G.lat*D2R,dark=G.theme==="dark",hz=1.0+4.5/R,cx=N/2,cy=N/2,lam0=G.lon*D2R,sp=Math.sin(ph1),cp=Math.cos(ph1);
  if(gl.drawingBufferWidth!==N||G.glN!==N){gl.viewport(0,0,N,N);G.glN=N;}
  gl.uniform1f(U.uN,N);gl.uniform1f(U.uR,R);gl.uniform1f(U.uLam0,lam0);gl.uniform1f(U.uSp,sp);gl.uniform1f(U.uCp,cp);gl.uniform1f(U.uZoom,G.zoom);
  gl.uniform1f(U.uGrat,G.zoom<3?15:5);gl.uniform1f(U.uGthr,.4/(R*D2R));gl.uniform1f(U.uHz,hz);gl.uniform1f(U.uDark,dark?1:0);
  gl.uniform3fv(U.uHalo,C.halo);["O","A"].forEach(function(k){var r=C[k==="O"?"ocean":"land"];for(var i=0;i<4;i++)gl.uniform3fv(U["u"+k+i],r[i]);});
  gl.drawArrays(gl.TRIANGLES,0,3);
  /* overlay (2d, N x N, same pixel grid): night stars outside the halo + the dotted route arcs */
  var u32=G.u32;u32.fill(0);
  if(dark){var st=G.stars;for(var i=0;i<st.length;i+=2){var X=(st[i]+.5-cx)/R,Y=(cy-st[i+1]-.5)/R;if(Math.sqrt(X*X+Y*Y)>=hz)u32[st[i+1]*N+st[i]]=G.cols.star;}}
  gArcs(R,cx,cy,lam0,sp,cp);gov.getContext("2d").putImageData(G.img,0,0);gPins(R,cx,cy,lam0,sp,cp);}
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
/* DOM writes only when a value actually changes (the render loop calls gPins every frame) */
function sH(el,v){if(el._h!==v){el._h=v;el.hidden=v;}}
function sA(el,k,v){v=String(v);if(!el._a)el._a={};if(el._a[k]!==v){el._a[k]=v;el.setAttribute(k,v);}}
function sC(el,k,v){v=!!v;if(!el._c)el._c={};if(el._c[k]!==v){el._c[k]=v;el.classList.toggle(k,v);}}
function sT(el,v){v=String(v);if(el._t!==v){el._t=v;el.textContent=v;}}
function sX(el,x,y){var s="translate3d("+x.toFixed(1)+"px,"+y.toFixed(1)+"px,0)";if(el._x!==s){el._x=s;el.style.transform=s;}}
function gPins(R,cx,cy,lam0,sp,cp){var S=G.S,list=[{id:"home",p:G.d.home}].concat(G.d.places.map(function(p){return {id:p.id,p:p};})),pos={};
  list.forEach(function(o){var v=gView(gVec(o.p.lat,o.p.lon),lam0,sp,cp),vis=v[2]>.1;o.vis=vis;o.x=(cx+v[0]*R)*S;o.y=(cy-v[1]*R)*S;});
  var cls=[];
  list.forEach(function(o){if(o.id==="home"||!o.vis){o.cl=null;return;}for(var i=0;i<cls.length;i++){var c=cls[i];if(Math.hypot(c.x-o.x,c.y-o.y)<34){c.m.push(o);o.cl=c;return;}}var c={x:o.x,y:o.y,m:[o]};cls.push(c);o.cl=c;});
  list.forEach(function(o){var b=gBtn[o.id],hide=!o.vis||(o.cl&&o.cl.m.length>1);sH(b,hide);if(!hide){sX(b,o.x,o.y);sC(b,"flip",o.x>N0()*.62);
    var inM=G.selMonth===null||(o.id!=="home"&&o.p.date===G.selMonth);sC(b,"dim",G.selMonth!==null&&!inM&&o.id!=="home");sC(b,"on",G.active===o.id);sC(b,"hl",G.hl===o.id);}});
  var k=0;cls.forEach(function(c){if(c.m.length>1){var b=gCl[k++];sH(b,false);sX(b,c.x,c.y);sT(b.querySelector(".n"),c.m.length);sA(b,"data-m",c.m.map(function(o){return o.id;}).join(","));
    sA(b,"aria-label",c.m.length+" places: "+c.m.map(function(o){return o.p.name;}).join(", ")+". Zoom in.");sC(b,"dim",G.selMonth!==null&&!c.m.some(function(o){return o.p.date===G.selMonth;}));sC(b,"hl",c.m.some(function(o){return o.id===G.hl;}));}});
  for(;k<gCl.length;k++)sH(gCl[k],true);
  sC(gwrap,"zl",G.zoom>=5);
  if(G.active){var o2=list.filter(function(o){return o.id===G.active;})[0];if(o2&&o2.vis&&!gBtn[G.active].hidden){sH(gcard,false);var w=gcard.offsetWidth,W=N0(),x=Math.max(4,Math.min(W-w-4,o2.x-w/2)),y=o2.y-gcard.offsetHeight-16;if(y<4)y=o2.y+16;var ct="translate("+x.toFixed(0)+"px,"+y.toFixed(0)+"px)";if(gcard._x!==ct){gcard._x=ct;gcard.style.transform=ct;}}else sH(gcard,true);}}
function N0(){return G.N*G.S;}
function gShow(id){G.active=id;if(!id){sH(gcard,true);G.dirty=1;gKick();return;}var p=gFind(id);
  gcard.innerHTML='<span class="nm">'+(id==="home"?p.label:gLabel(p)+" · "+gDate(p.date))+'</span>'+(id==="home"||!p.href?"":'<a href="'+p.href+'">Read entry →</a>');sH(gcard,false);G.dirty=1;gKick();}
function gSelect(id,pin){var sn=0;for(var i=0;i<id.length;i++)sn+=id.charCodeAt(i);Sound.play("pin",sn);G.pinned=pin;gShow(id);var p=gFind(id);gFly(p.lon,p.lat,Math.max(G.zoom,id==="home"?1.6:5));if(id!=="home"&&gSc&&gSc.gAct){gReveal(id,true);gSc.gAct(id);}
  document.querySelectorAll("#glist li").forEach(function(li){li.classList.toggle("is-cur",li.getAttribute("data-id")===id);});}
/* camera */
function gFly(lon,lat,zoom){zoom=Math.max(1,Math.min(24,zoom));if(reduce){G.lon=lon;G.lat=Math.max(-70,Math.min(70,lat));G.zoom=zoom;G.vLon=0;G.dirty=1;gKick();return;}
  var dl=((lon-G.lon+540)%360)-180;G.fly={t0:performance.now(),dur:900+Math.min(600,Math.abs(dl)*6),l0:G.lon,dl:dl,a0:G.lat,da:Math.max(-70,Math.min(70,lat))-G.lat,z0:G.zoom,dz:zoom-G.zoom};G.vLon=0;gKick();}
function gFit(ps,more){var la=0,lo=0,vs=ps.map(function(p){return gVec(p.lat,p.lon);}),m=[0,0,0];vs.forEach(function(v){m[0]+=v[0];m[1]+=v[1];m[2]+=v[2];});var l=Math.hypot(m[0],m[1],m[2]);m=m.map(function(x){return x/l;});
  var lat=Math.asin(m[2])/D2R,lon=Math.atan2(m[1],m[0])/D2R,sp=0;vs.forEach(function(v){sp=Math.max(sp,Math.acos(Math.max(-1,Math.min(1,v[0]*m[0]+v[1]*m[1]+v[2]*m[2]))));});
  var z=sp<.002?6:.8/sp;if(more)z=Math.max(z,G.zoom*1.8);gFly(lon,lat,Math.min(z,24));}
function gKick(){if(G.raf||!G.vis)return;G.raf=requestAnimationFrame(gFrame);}
function gFrame(ts){G.raf=null;if(!G.vis||document.hidden)return;var dt=Math.min(.1,(ts-G.last)/1000);
  var calm=!G.fly&&!G.drag&&Math.abs(G.vLon)<=.05,gap=G.gl?(calm?30:0):(calm?66:Math.max(12,Math.min(50,(G.cost||20)*1.6)));  /* GPU: display rate while moving; CPU: gap follows the measured render cost */if(ts-G.last<gap&&G.last){gKick();return;}G.last=ts;var moving=false;
  if(G.fly){var f=G.fly,t=(performance.now()-f.t0)/f.dur;if(t>=1){t=1;G.fly=null;}var e=t<.5?4*t*t*t:1-Math.pow(-2*t+2,3)/2;G.lon=f.l0+f.dl*e;G.lat=f.a0+f.da*e;G.zoom=f.z0+f.dz*e;G.lon=((G.lon+540)%360)-180;moving=!!G.fly;G.dirty=1;}
  else if(!G.drag&&Math.abs(G.vLon)>.05){G.lon+=G.vLon*dt;G.vLon*=Math.exp(-4.5*dt);G.lon=((G.lon+540)%360)-180;G.dirty=1;moving=true;}
  else if(!reduce&&!G.paused&&!G.drag&&!G.hover&&!G.hl&&!G.active&&G.zoom<1.6&&!G.focusIn){G.lon+=4.5*dt;G.lon=((G.lon+540)%360)-180;G.dirty=1;moving=true;}
  if(G.dirty){G.dirty=0;var t0=performance.now();gRender();G.cost=performance.now()-t0;}
  if(moving||G.drag)gKick();}
function gDrag(){var down=null,ptrs={},pinch=null;
  var mapEl=document.getElementById("map");mapEl.addEventListener("focusin",function(e){G.focusIn=!!(e.target.matches&&e.target.matches(":focus-visible"));});mapEl.addEventListener("focusout",function(){G.focusIn=false;});
  function hint(){var h=document.getElementById("ghint");if(h)h.classList.remove("on");try{sessionStorage.setItem("ghint","1");}catch(_){}}
  function pd(){var k=Object.keys(ptrs);return Math.hypot(ptrs[k[0]].x-ptrs[k[1]].x,ptrs[k[0]].y-ptrs[k[1]].y);}
  gwrap.addEventListener("pointerdown",function(e){if(e.button>0)return;ptrs[e.pointerId]={x:e.clientX,y:e.clientY};
    if(Object.keys(ptrs).length===2){down=null;G.drag=true;G.fly=null;pinch={d:pd(),z:G.zoom};try{gwrap.setPointerCapture(e.pointerId);}catch(_){}hint();return;}
    down={id:e.pointerId,x:e.clientX,y:e.clientY,lon:G.lon,lat:G.lat,t:performance.now(),px:e.clientX,pt:performance.now(),v:0,touch:e.pointerType!=="mouse",on:false};});
  gwrap.addEventListener("pointermove",function(e){if(ptrs[e.pointerId]){ptrs[e.pointerId].x=e.clientX;ptrs[e.pointerId].y=e.clientY;}
    if(pinch&&Object.keys(ptrs).length===2){G.zoom=Math.max(1,Math.min(24,pinch.z*pd()/pinch.d));G.dirty=1;gKick();return;}
    if(!down||e.pointerId!==down.id)return;var dx=e.clientX-down.x,dy=e.clientY-down.y;
    if(!down.on){if(Math.hypot(dx,dy)<6)return;down.on=true;G.drag=true;G.fly=null;gwrap.classList.add("drag");hint();try{gwrap.setPointerCapture(e.pointerId);}catch(_){}}
    var k=57.3/(G.R*G.S*G.zoom);G.lon=((down.lon-dx*k+540)%360)-180;G.lat=Math.max(-70,Math.min(70,down.lat+dy*k));
    var now=performance.now(),dtm=(now-down.pt)/1000;if(dtm>.016){down.v=(-(e.clientX-down.px)*k)/dtm*.6+down.v*.4;down.px=e.clientX;down.pt=now;}G.dirty=1;gKick();});
  function end(e){delete ptrs[e.pointerId];if(pinch){if(Object.keys(ptrs).length<2){pinch=null;G.drag=false;G.vLon=0;G.dirty=1;gKick();}return;}
    if(!down||e.pointerId!==down.id)return;if(down.on){G.drag=false;gwrap.classList.remove("drag");G.justDrag=Date.now()+80;G.vLon=reduce?0:Math.max(-120,Math.min(120,down.v));if(performance.now()-down.pt>120)G.vLon=0;G.dirty=1;gKick();}down=null;}
  gwrap.addEventListener("pointerup",end);gwrap.addEventListener("pointercancel",end);
  gwrap.addEventListener("keydown",function(e){var k={ArrowLeft:[-8,0],ArrowRight:[8,0],ArrowUp:[0,6],ArrowDown:[0,-6]}[e.key];if(e.target!==gwrap){if(e.key==="Escape"){gShow(null);G.pinned=false;}return;}if(!k)return;e.preventDefault();G.fly=null;G.lon=((G.lon+k[0]/Math.max(1,G.zoom/2)+540)%360)-180;G.lat=Math.max(-70,Math.min(70,G.lat+k[1]/Math.max(1,G.zoom/2)));G.dirty=1;gKick();});
  document.addEventListener("keydown",function(e){if(e.key==="Escape"&&G.active){G.pinned=false;gShow(null);}});
  document.addEventListener("pointerdown",function(e){if(G.active&&!e.target.closest("#gwrap"))gShow(null),G.pinned=false;});
  gwrap.addEventListener("pointerleave",function(e){if(e.pointerType==="mouse"){G.hover=false;}});}
/* atlas: the trips scroller drives the globe. The trip nearest the focus line is "active": its pin lights, the globe turns to it, its book lifts.
   Hover/focus on a book does the same; hovering a pin lifts its book; picking a pin or a month scrolls the trips to match. */
var gSc=document.getElementById("shelf"),gQuiet=0;
function gReveal(id,quiet){if(!gSc||!G.d)return;var li=null;[].slice.call(gSc.children).forEach(function(x){if(x._id===id&&!li)li=x;});if(!li)return;
  var h=gHoriz(),r=li.getBoundingClientRect(),s=gSc.getBoundingClientRect();if(quiet)gQuiet=Date.now()+1300;
  var to=h?{left:gSc.scrollLeft+(r.left+r.width/2)-(s.left+s.width/2)}:{top:gSc.scrollTop+(r.top+r.height/2)-(s.top+s.height*.45)};
  to.behavior=reduce?"auto":"smooth";gSc.scrollTo(to);}
function gHoriz(){return mobileNow();}
function gLink(){
  if(!gSc||!G.d)return;
  var pid={};G.d.places.forEach(function(p){(p.hrefs||[p.href]).forEach(function(h){pid[h]=p.id;});});
  var lis=[].slice.call(gSc.children),byPin={},cur=null,hoverId=null,ft=0,raf=0,seen=false;
  lis.forEach(function(li){li._id=pid[li.getAttribute("data-href")];if(li._id)(byPin[li._id]=byPin[li._id]||[]).push(li);});
  function near(){var s=gSc.getBoundingClientRect(),h=gHoriz(),c=h?s.left+s.width/2:s.top+s.height*.45,best=null,bd=1e9;
    lis.forEach(function(li){if(!li._id)return;var r=li.getBoundingClientRect(),d=Math.abs((h?r.left+r.width/2:r.top+r.height/2)-c);if(d<bd){bd=d;best=li._id;}});return best;}
  function act(id){if(id===cur)return;cur=id;lis.forEach(function(li){var on=!!id&&li._id===id;li.classList.toggle("act",on);var b=li.querySelector(".book");if(b){if(on)b.setAttribute("aria-current","true");else b.removeAttribute("aria-current");}});
    G.hl=id;G.dirty=1;clearTimeout(ft);if(id)ft=setTimeout(function(){var p=gFind(id);if(p&&G.hl===id&&!G.drag&&!G.pinned)gFly(p.lon,p.lat,Math.max(G.zoom,1.8));},120);gKick();}
  function edges(){var h=gHoriz(),p=h?gSc.scrollLeft:gSc.scrollTop,m=(h?gSc.scrollWidth-gSc.clientWidth:gSc.scrollHeight-gSc.clientHeight);gSc.classList.toggle("at-s",p<=2);gSc.classList.toggle("at-e",p>=m-2);}
  function onScroll(){if(raf)return;raf=requestAnimationFrame(function(){raf=0;edges();if(seen&&!hoverId&&Date.now()>gQuiet)act(near());});}
  gSc.addEventListener("scroll",onScroll,{passive:true});window.addEventListener("resize",function(){edges();});edges();
  gSc.gAct=function(id){act(id);};
  lis.forEach(function(li){var id=li._id,bk=li.querySelector(".book");if(!id||!bk)return;
    bk.addEventListener("pointerenter",function(e){if(e.pointerType!=="mouse")return;hoverId=id;act(id);});
    bk.addEventListener("pointerleave",function(e){if(e.pointerType!=="mouse")return;hoverId=null;act(near());});
    bk.addEventListener("focus",function(){if(!bk.matches(":focus-visible")||document.getElementById("reader").hidden===false)return;hoverId=id;act(id);});bk.addEventListener("blur",function(){if(hoverId===id)hoverId=null;});});
  /* first time the trips come into view: light the nearest trip (globe turns to it) */
  if("IntersectionObserver" in window){var io2=new IntersectionObserver(function(es){if(es[0].isIntersecting&&!seen){seen=true;io2.disconnect();act(near());}},{threshold:.2});io2.observe(gSc);}else{seen=true;}
  /* pin hover lifts its book (mouse, desktop layout) */
  var lifted=null;function lift(on,e){var b=e.target.closest&&e.target.closest(".gpin");if(lifted){lifted.forEach(function(k){k.querySelector(".book").classList.remove("force-hover");});lifted=null;}
    if(!on||!b||e.pointerType!=="mouse"||gHoriz())return;var l=byPin[b.getAttribute("data-id")];if(l){lifted=l;l.forEach(function(k){k.querySelector(".book").classList.add("force-hover");});}}
  gpins.addEventListener("pointerover",function(e){lift(true,e);});gpins.addEventListener("pointerout",function(e){lift(false,e);});
}
/* trips scroller: mouse/pen click-and-drag with a momentum glide (touch keeps the browser's native scroll + inertia).
   Glide: v decays as exp(-dt/TAU); stops below VMIN or at the ends. A drag over 5px swallows the click on the book. */
function gDragScroll(){var sc=gSc;if(!sc)return;var TAU=325,VMIN=.02,VMAX=4.5,TH=5;
  var d=null,v=0,raf=0,last=0,eat=0;
  function H(){return mobileNow();}
  function pos(){return H()?sc.scrollLeft:sc.scrollTop;}
  function max(){return H()?sc.scrollWidth-sc.clientWidth:sc.scrollHeight-sc.clientHeight;}
  function set(p){if(H())sc.scrollLeft=p;else sc.scrollTop=p;}
  function stop(){if(raf)cancelAnimationFrame(raf);raf=0;v=0;sc.classList.remove("glide");}
  function glide(ts){var dt=Math.min(40,ts-last);last=ts;var p=pos()+v*dt;v*=Math.exp(-dt/TAU);
    if(p<=0||p>=max()){set(Math.max(0,Math.min(max(),p)));stop();return;}set(p);if(Math.abs(v)<VMIN){stop();return;}raf=requestAnimationFrame(glide);}
  sc.addEventListener("pointerdown",function(e){stop();if(e.pointerType==="touch"||e.button!==0)return;
    d={id:e.pointerId,c:H()?e.clientX:e.clientY,s:pos(),on:false,hist:[[performance.now(),H()?e.clientX:e.clientY]]};});
  sc.addEventListener("pointermove",function(e){if(!d||e.pointerId!==d.id)return;var c=H()?e.clientX:e.clientY,dd=c-d.c;
    if(!d.on){if(Math.abs(dd)<TH)return;d.on=true;sc.classList.add("glide");try{sc.setPointerCapture(e.pointerId);}catch(_){}}
    set(d.s-dd);var t=performance.now();d.hist.push([t,c]);while(d.hist.length>2&&t-d.hist[0][0]>90)d.hist.shift();e.preventDefault();});
  function up(e){if(!d||e.pointerId!==d.id)return;var was=d.on,h=d.hist;d=null;if(!was)return;eat=Date.now()+60;
    var a=h[0],b=h[h.length-1],dt=b[0]-a[0];v=(dt>8&&performance.now()-b[0]<60)?-(b[1]-a[1])/dt:0;v=Math.max(-VMAX,Math.min(VMAX,v));
    if(reduce||Math.abs(v)<VMIN){stop();return;}last=performance.now();raf=requestAnimationFrame(glide);}
  sc.addEventListener("pointerup",up);sc.addEventListener("pointercancel",function(e){if(d&&e.pointerId===d.id){d=null;stop();}});
  sc.addEventListener("click",function(e){if(Date.now()<eat){e.preventDefault();e.stopPropagation();}},true);
  sc.addEventListener("dragstart",function(e){e.preventDefault();});
  sc.addEventListener("wheel",stop,{passive:true});}
/* timeline + list */
function gUI(){var d=G.d,ix=function(s){var p=s.split("-");return +p[0]*12+ +p[1]-1;},idx=d.places.map(function(p){return ix(p.date);}),mx=Math.max.apply(null,idx),mn=Math.min.apply(null,idx),lo=Math.min(mn,mx-5);
  var tl=document.getElementById("gtime");tl.innerHTML="";
  for(var i=lo;i<=mx;i++){var y=Math.floor(i/12),m=i%12,key=y+"-"+("0"+(m+1)).slice(-2),here=d.places.filter(function(p){return p.date===key;}),b=document.createElement("button");b.type="button";b.className="mc";b.setAttribute("data-m",key);
    b.innerHTML='<span class="yr">'+((m===0||i===lo)?y:"")+'</span><span>'+MON[m]+'</span><span class="dots">'+here.map(function(){return "<i></i>";}).join("")+"</span>";
    if(!here.length){b.disabled=true;b.setAttribute("aria-label",MON[m]+" "+y+": no trips");}else b.setAttribute("aria-label",MON[m]+" "+y+": "+here.map(function(p){return p.name;}).join(", "));b.setAttribute("aria-pressed","false");tl.appendChild(b);}
  function pick(key){Sound.play("tl");G.selMonth=(G.selMonth===key?null:key);tl.querySelectorAll(".mc").forEach(function(x){var on=x.getAttribute("data-m")===G.selMonth;x.classList.toggle("sel",on);x.setAttribute("aria-pressed",on);});
    if(G.selMonth){gShow(null);var mp=d.places.filter(function(p){return p.date===G.selMonth;});gFit(mp);if(mp[0]){gReveal(mp[0].id,true);}}else{gFly(G.lon,G.lat,1);}G.dirty=1;gKick();}
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
  
  document.getElementById("g-in").addEventListener("click",function(){gFly(G.lon,G.lat,G.zoom*1.8);});
  document.getElementById("g-out").addEventListener("click",function(){gFly(G.lon,G.lat,G.zoom/1.8);});
  var sp=document.getElementById("g-spin");if(reduce){G.paused=true;sp.hidden=true;}sp.addEventListener("click",function(){G.paused=!G.paused;sp.setAttribute("aria-pressed",G.paused);sp.textContent=G.paused?"Spin":"Pause spin";gKick();});}
if(gcv&&gwrap){
  var gdone=0;function gGo(){if(++gdone<4)return;gInitGL();gMake();gUI();gDrag();gLink();gDragScroll();gSize();gRender();gKick();var gh=document.getElementById("ghint"),seen=false;try{seen=sessionStorage.getItem("ghint");}catch(_){}if(gh&&!seen){gh.classList.add("on");setTimeout(function(){gh.classList.remove("on");},6000);}
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
      a.addEventListener("pointerenter",function(e){if(e.pointerType==="mouse")Sound.play("hover");});
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
  /* measure untransformed layout boxes so the 3D tilt/lift and shadows don't skew the scale */
  var at=a.style.transform,att=a.style.transition,bt=rbook.style.transform,ft=flyEl.style.transform;
  a.style.transition="none";a.style.transform="none";rbook.style.transform="none";flyEl.style.transform="none";
  var ar=a.getBoundingClientRect(),br=rbook.getBoundingClientRect();
  a.style.transform=at;rbook.style.transform=bt;flyEl.style.transform=ft;void a.offsetWidth;a.style.transition=att;
  var dx=(ar.left+ar.width/2)-(br.left+br.width/2),dy=(ar.top+ar.height/2)-(br.top+br.height/2),s=ar.width/br.width,sy=ar.height/br.height;
  var r=parseFloat(getComputedStyle(a.closest("li")).getPropertyValue("--r"))||0;if(mobileNow())r*=.6;
  return "translate("+dx.toFixed(1)+"px,"+dy.toFixed(1)+"px) scale("+s.toFixed(4)+","+sy.toFixed(4)+") rotateZ("+r+"deg)";}
/* the shelf book posed exactly like the landing reader book, so the swap at the end of close is invisible */
function restPose(a){var r=parseFloat(getComputedStyle(a.closest("li")).getPropertyValue("--r"))||0;if(mobileNow())r*=.6;
  return "translateY(var(--dy,0px)) rotateZ("+r+"deg) rotateX("+(rbook.style.getPropertyValue("--prx")||"-5deg")+") rotateY("+(rbook.style.getPropertyValue("--pry")||"-12deg")+")";}
/* then ease from that pose into its normal resting/hover/active transform (tilt eases back in) */
function handBack(a,cr){a.style.transition="none";a.style.transform=restPose(a);
  /* absorb the small leftover offset from the two different perspectives, then ease it out too */
  var fr=a.querySelector(".f-front");if(cr&&fr){fr=fr.getBoundingClientRect();
    var ox=(cr.left+cr.width/2)-(fr.left+fr.width/2),oy=(cr.top+cr.height/2)-(fr.top+fr.height/2);
    if(Math.abs(ox)<40&&Math.abs(oy)<40)a.style.transform="translate("+ox.toFixed(1)+"px,"+oy.toFixed(1)+"px) "+restPose(a);}
  void a.offsetWidth;
  requestAnimationFrame(function(){a.style.transition="transform .42s cubic-bezier(.25,.7,.3,1)";a.style.transform="";
    setTimeout(function(){a.style.transition="";},460);});}
function openReader(a){
  if(!reader||state!=="closed")return;state="opening";clearTimers();rbook.style.opacity="";rbook.style.transition="";reader.style.pointerEvents="";
  var li=a.closest("li");curLi=li;lastTrigger=a;a.setAttribute("aria-expanded","true");
  var d=li.dataset,cv=d.pal?' data-pal="'+esc(d.pal)+'"':"";
  var leaves="";for(var k=1;k<=5;k++)leaves+='<div class="rd-leaf" style="--k:'+k+'"><i class="fr paper"></i><i class="bk paper">'+(k===5?'<b class="ruled"><span class="rh">field record</span>'+(d.place?'<span><em>place</em>'+esc(d.place)+'</span>':'')+(d.coord?'<span><em>coord</em>'+esc(d.coord)+'</span>':'')+'<span><em>filed</em>'+esc(d.date)+'</span><span class="stamp">notes</span></b>':'')+'</i></div>';
  rbook.innerHTML='<span class="rd-shadow" aria-hidden="true"></span>'+
    '<div class="rd-page paper">'+
    '<h2 id="rd-title">'+esc(d.title)+'</h2><span class="dt">'+esc(d.date)+'</span>'+
    '<div class="stats2"'+(d.stats?'':' hidden')+'><span>'+esc(d.stats||"")+'</span></div>'+
    '<p>'+esc(d.blurb)+'</p><a class="read" href="'+esc(d.href)+'">Read entry →</a></div>'+leaves+
    '<div class="rd-cover" aria-hidden="true"><i class="fr">'+(d.photo?'<img class="pix" src="'+esc(Dither.dp()===2?d.photo.replace("-cover.png","-cover-s.png"):d.photo)+'" width="80" height="83" alt="">':'<canvas class="pix" data-scene="thumb" data-seed="'+esc(d.seed)+'" data-variant="'+esc(d.variant)+'"'+cv+' width="100" height="104"></canvas>')+
    '<span class="cap"><span class="dt">'+esc(d.date)+'</span><span class="ti">'+esc(d.title)+'</span></span></i><i class="bk">Trip journal</i></div>';
  var mob=mobileNow();rbook.style.setProperty("--prx",(mob?-3:-5)+"deg");rbook.style.setProperty("--pry",(mob?-7:-12)+"deg");
  reader.hidden=false;
  /* the reader cover is a scaled copy of the shelf cover: same aspect, layout and text size relative to the cover */
  var ff=a.querySelector(".f-front"),fr=rbook.querySelector(".rd-cover>i.fr");
  if(ff&&fr&&ff.offsetWidth){var fw=ff.offsetWidth,fh=ff.offsetHeight;rbook.style.setProperty("--H","calc(var(--W) * "+(fh/fw).toFixed(4)+")");
    var k=rbook.offsetWidth/fw;fr.className="fr copy";
    fr.innerHTML='<span class="rd-face" style="width:'+fw+'px;height:'+fh+'px;transform:scale('+k.toFixed(4)+')">'+ff.innerHTML+'</span>';
    [].forEach.call(fr.querySelectorAll("img"),function(im){im.loading="eager";});}
  document.querySelector("main").setAttribute("inert","");document.body.style.overflow="hidden";
  build(true);
  function land(){Sound.play("land");state="open";rbook.classList.add("landed");var rl=rbook.querySelector(".read");if(rl)rl.focus({preventScroll:true});}
  dialog.focus({preventScroll:true});
  if(reduce){li.classList.add("away");rbook.classList.add("open","up");reader.classList.add("on");land();return;}
  /* phase 0: place the reader book exactly over the shelf book (no transition) */
  rbook.classList.add("pre");flyEl.style.transition="none";flyEl.style.transform=flipTransform(a);void flyEl.offsetWidth;
  li.classList.add("away");
  /* phase 1: float up to centre (transforms only) with backdrop fade + growing shadow */
  Sound.play("pickup");flyEl.style.transition="";flyEl.style.transform="none";rbook.classList.remove("pre");rbook.classList.add("up");reader.classList.add("on");
  /* phase 2: cover swings open, leaves flip, land on first page */
  later(function(){rbook.classList.add("open");Sound.play("cover");for(var k=1;k<=5;k++)later(function(){Sound.play("flip");},(.28+k*.075)*1000+60);later(land,1150);},720);
}
function closeReader(){
  if(!reader||reader.hidden||state==="closing"||state==="closed")return;state="closing";clearTimers();
  var a=lastTrigger,li=curLi;
  function finish(){
    var cv=rbook.querySelector(".rd-cover"),cr=cv&&cv.getBoundingClientRect();Sound.play("thud");if(li)li.classList.remove("away");if(a&&!reduce)handBack(a,cr);
    function cleanup(){reader.hidden=true;reader.style.pointerEvents="";rbook.innerHTML="";rbook.className="rd-book";rbook.style.opacity="";rbook.style.transition="";flyEl.style.cssText="";}
    /* brief crossfade: the reader copy dissolves over the shelf book, which is already in the same pose */
    if(reduce)cleanup();else{reader.style.pointerEvents="none";rbook.style.transition="opacity .16s linear";rbook.style.opacity="0";later(cleanup,180);}
    document.querySelector("main").removeAttribute("inert");document.body.style.overflow="";reader.classList.remove("on");
    if(a){a.setAttribute("aria-expanded","false");a.focus({preventScroll:true});}
    state="closed";if(reduce)build(true);else setTimeout(function(){build(true);},520);}
  if(reduce){finish();return;}
  var wasOpen=rbook.classList.contains("open");
  /* phase 1: cover and pages close */
  rbook.classList.remove("landed");rbook.classList.remove("open");if(wasOpen)Sound.play("close");
  /* phase 2: float back down, shrink, settle into the exact resting spot and tilt */
  later(function(){
    Sound.play("down");if(a){a.style.transition="none";a.style.transform=restPose(a);}flyEl.style.transform=flipTransform(a);rbook.classList.add("pre");rbook.classList.remove("up");reader.classList.remove("on");
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

})();

/* ---------- photo figures: dithered by default, "develops" to colour; click for lightbox ---------- */
(function(){
  var figs=document.querySelectorAll("figure.photo");if(!figs.length)return;
  var lb=document.createElement("div");lb.className="lightbox";lb.hidden=true;lb.setAttribute("role","dialog");lb.setAttribute("aria-modal","true");lb.setAttribute("aria-label","Photo viewer");
  lb.innerHTML='<div class="lb-inner" tabindex="-1"><img alt=""><p class="lb-cap"></p><button type="button" class="btn lb-close">close ×</button></div>';
  document.body.appendChild(lb);
  var img=lb.querySelector("img"),cap=lb.querySelector(".lb-cap"),btn=lb.querySelector(".lb-close"),back=null;
  function open(fig){back=fig.querySelector(".ph-btn");img.src=fig.dataset.full;img.alt=fig.querySelector("img.d").alt;cap.textContent=fig.querySelector("figcaption").textContent;
    Sound.play("lbopen");lb.hidden=false;document.body.style.overflow="hidden";document.querySelector("main").setAttribute("inert","");btn.focus({preventScroll:true});}
  function close(){if(lb.hidden)return;Sound.play("lbclose");lb.hidden=true;img.removeAttribute("src");document.body.style.overflow="";document.querySelector("main").removeAttribute("inert");if(back)back.focus({preventScroll:true});}
  lb.addEventListener("click",function(e){if(e.target===lb||e.target===btn)close();});
  document.addEventListener("keydown",function(e){if(lb.hidden)return;if(e.key==="Escape"){e.preventDefault();close();}
    if(e.key==="Tab"){e.preventDefault();btn.focus();}});
  figs.forEach(function(f){var b=f.querySelector(".ph-btn");
    b.addEventListener("click",function(){
      open(f);});});
})();
