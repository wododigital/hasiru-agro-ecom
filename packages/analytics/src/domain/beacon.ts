/** Where the collector is served and where it posts. Not /track or /collect (blocklisted by privacy filter lists). */
export const BEACON_PATH = '/b.js';
export const INGEST_PATH = '/api/beacon-ingest';

/**
 * The browser collector, served as-is from /b.js (hand-compacted; a test keeps it under 3 KB).
 *
 * - Queue: `window.__ekq.push([name, props])` (see `track()` in ./ui); calls made before load are drained.
 * - Batching: flush at 20 events, every 10 s, on visibilitychange to hidden and on pagehide. sendBeacon with a
 *   text/plain body (no preflight), falling back to fetch keepalive. Never listens to unload (keeps bfcache).
 * - Pages: page_view on load, on client route changes (history pushState/replaceState/popstate, pathname only)
 *   and on bfcache restore (pageshow persisted, props bf=1).
 * - Privacy: only utm_*, gclid and fbclid survive in the path; prop keys naming personal data are dropped,
 *   emails and phone-like digit runs in values are masked. Identity is a server-set HttpOnly cookie.
 * - Clicks: cta_click for [data-cta]; rage_click = 3 clicks within 1 s and 30 px; dead_click = a clickable
 *   element whose click changes neither the DOM nor the URL within 1 s.
 * - Attention: every second, each [data-track-section] / [data-track-product] element whose visible part covers
 *   at least half of min(element height, viewport height) gains 1 s visible, and 1 s engaged when there was
 *   input in the last 5 s and the tab is visible. Emitted (when >= 1 s) as deltas when the page ends or hides.
 * - Attention and vitals belong to the page they were measured on, even when sent after a route change.
 * - Scroll depth 25/50/75/100 once per page; web vitals (LCP, CLS, INP, TTFB) once per hard load; js_error x5.
 *
 * ponytail: CLS is a plain sum of shifts without session windows; switch to windowed CLS if scores look high.
 */
export const BEACON_JS = String.raw`(function(w,d,n,L){if(w.__ekb)return;w.__ekb=1;
var S=d.currentScript,E=S&&S.getAttribute('data-e')||'/api/beacon-ingest',q=[],R='',
EM=/[^\s@]+@[^\s@]+\.[^\s@]+/g,PH=/\+?\d[\d\s-]{8,}\d/g,PK=/mail|phone|mobile|whatsapp|address|password|otp|token|card|upi/i,
now=Date.now,pg,pp,sc,at,wm,lm=0,hi=0,cl=[],er=0,V={},vt=0;
try{R=d.referrer?new URL(d.referrer).host:''}catch(e){}
function id(){var b=crypto.getRandomValues(new Uint8Array(16)),h='',i=0;b[6]=b[6]&15|64;b[8]=b[8]&63|128;for(;i<16;i++)h+=(b[i]+256).toString(16).slice(1)+(i==3||i==5||i==7||i==9?'-':'');return h}
function x(v){return typeof v=='string'?v.replace(EM,'[email]').replace(PH,'[phone]').slice(0,200):v}
function P(){var u=new URL(L.href),o=new URLSearchParams();u.searchParams.forEach(function(v,k){/^(utm_|gclid$|fbclid$)/.test(k)&&o.append(k,v)});o=''+o;return u.pathname+(o?'?'+o:'')}
function T(m,p,u){var o={},k;for(k in p||{})PK.test(k)||(o[k]=x(p[k]));q.push({i:id(),n:m,p:u||P(),t:now(),d:o});q.length>19&&F()}
function F(){while(q.length){var b=JSON.stringify({e:q.splice(0,50),r:R});n.sendBeacon&&n.sendBeacon(E,b)||fetch(E,{method:'POST',body:b,keepalive:!0,credentials:'same-origin'}).catch(function(){})}}
function A(){at.forEach(function(a){a.v>999&&T('attention',{k:a.k,s:a.s,v:a.v,e:a.e},pp);a.v=a.e=0})}
function VT(){if(vt)return;vt=1;for(var k in V)T('web_vital',{m:k,v:k=='CLS'?Math.round(V[k]*1e3)/1e3:Math.round(V[k])},pp)}
function O(){A();VT();F()}
function N(b){pg=L.pathname;pp=P();sc={};at=[];wm=new WeakMap;T('page_view',b?{bf:1}:0)}
function rc(){L.pathname!=pg&&(A(),VT(),N())}
function sel(el){var s=el.closest('[data-track-section]');return(s?s.getAttribute('data-track-section')+' > ':'')+el.tagName.toLowerCase()+(el.id?'#'+el.id:'')}
function po(t,f,o){try{new PerformanceObserver(function(l){l.getEntries().forEach(f)}).observe(Object.assign({type:t,buffered:!0},o))}catch(e){}}
['pushState','replaceState'].forEach(function(k){var o=history[k];history[k]=function(){var r=o.apply(this,arguments);rc();return r}});
w.addEventListener('popstate',rc);
w.addEventListener('pageshow',function(e){e.persisted&&N(1)});
w.addEventListener('pagehide',O);
d.addEventListener('visibilitychange',function(){d.hidden&&O()});
w.addEventListener('error',function(e){er++<5&&T('js_error',{m:x(String(e.message)).slice(0,150)})});
['pointerdown','keydown','touchstart','scroll'].forEach(function(t){w.addEventListener(t,function(){hi=now();if(t=='scroll'){var p=(scrollY+innerHeight)/d.documentElement.scrollHeight*100;[25,50,75,100].forEach(function(m){p>=m-1&&!sc[m]&&(sc[m]=1,T('scroll_depth',{pct:m}))})}},{passive:!0,capture:!0})});
new MutationObserver(function(){lm=now()}).observe(d.documentElement,{childList:!0,subtree:!0,attributes:!0,characterData:!0});
d.addEventListener('click',function(v){var el=v.target;if(!(el instanceof Element))return;
var c=el.closest('[data-cta]'),s=c?c.getAttribute('data-cta'):sel(el),t=now(),h=L.href,l=x((el.textContent||'').trim().slice(0,40));
c&&T('cta_click',{cta:s});
cl=cl.filter(function(k){return t-k.t<1e3&&Math.abs(k.x-v.clientX)<30&&Math.abs(k.y-v.clientY)<30});cl.push({t:t,x:v.clientX,y:v.clientY});
cl.length==3&&T('rage_click',{s:s,l:l});
(c||el.closest('a,button,summary,[role=button]')||getComputedStyle(el).cursor=='pointer')&&setTimeout(function(){lm<t&&L.href==h&&T('dead_click',{s:s,l:l})},1e3)},!0);
po('largest-contentful-paint',function(e){V.LCP=e.startTime});
po('layout-shift',function(e){e.hadRecentInput||(V.CLS=(V.CLS||0)+e.value)});
po('event',function(e){e.interactionId&&e.duration>(V.INP||0)&&(V.INP=e.duration)},{durationThreshold:40});
var nv=performance.getEntriesByType('navigation')[0];nv&&(V.TTFB=nv.responseStart);
setInterval(function(){if(d.hidden)return;var e=now()-hi<5e3,H=innerHeight;
d.querySelectorAll('[data-track-section],[data-track-product]').forEach(function(el){var r=el.getBoundingClientRect();
if((Math.min(r.bottom,H)-Math.max(r.top,0))/Math.min(r.height||1,H)<.5)return;
var a=wm.get(el);if(!a){a={k:el.hasAttribute('data-track-product')?'product':'section',s:el.getAttribute('data-track-product')||el.getAttribute('data-track-section'),v:0,e:0};wm.set(el,a);at.push(a)}
a.v+=1e3;e&&(a.e+=1e3)})},1e3);
setInterval(F,1e4);
N();var Q=w.__ekq||[];w.__ekq={push:function(a){T(a[0],a[1])}};Q.forEach(w.__ekq.push)
})(window,document,navigator,location)`;
