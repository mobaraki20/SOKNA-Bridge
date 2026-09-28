(()=>{
"use strict";
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const safe=s=>String(s||"").trim();
const cleanUrl=u=>{try{const x=new URL(u,location.href);return /^https?:$/.test(x.protocol)?x.href:""}catch{return""}};
const shortcodeFrom=u=>{try{const m=new URL(u,location.href).pathname.match(/\/(?:p|reel)\/([^/]+)/);return m?.[1]||""}catch{return""}};
const pageUser=()=>{
  const m=location.pathname.match(/^\/([^/]+)\/?/);
  if(!m)return "instagram";
  const x=m[1];return ["p","reel","reels","explore","stories","direct","accounts"].includes(x)?"instagram":x;
};
function mediaUrl(el){
  if(!el)return "";
  if(el.tagName==="VIDEO")return el.currentSrc||el.src||el.querySelector("source")?.src||"";
  return el.currentSrc||el.src||"";
}
function extractMedia(root=document){
  const out=[],seen=new Set();
  for(const el of root.querySelectorAll("video,img")){
    const url=cleanUrl(mediaUrl(el));if(!url||seen.has(url))continue;
    let width=0,height=0;try{const r=el.getBoundingClientRect();width=el.naturalWidth||el.videoWidth||r.width;height=el.naturalHeight||el.videoHeight||r.height}catch{}
    const alt=safe(el.getAttribute?.("alt"));
    if(el.tagName==="IMG" && ((width&&height&&width<180&&height<180)||/profile picture|avatar/i.test(alt)))continue;
    seen.add(url);
    out.push({type:el.tagName==="VIDEO"?"video":"image",url,alt,width:Math.round(width||0),height:Math.round(height||0)});
    if(out.length>=30)break;
  }
  return out;
}
function rootArticle(){return document.querySelector('[role="dialog"] article')||document.querySelector("main article")||document.querySelector("article")}
function adapterReadiness(){
  const path=location.pathname.toLowerCase();
  const loginForm=!!document.querySelector('input[name="username"],input[name="password"],form[action*="/accounts/login"]');
  const loginPath=path.startsWith("/accounts/login")||path.startsWith("/accounts/signup");
  const challenge=path.startsWith("/challenge/")||/challenge|required verification|confirm your identity/i.test(safe(document.body?.innerText).slice(0,3000));
  if(loginForm||loginPath)return {ready:false,logged_in:false,reason:"login_required"};
  if(challenge)return {ready:false,logged_in:null,reason:"challenge_or_verification"};
  const main=!!document.querySelector("main");
  if(!main)return {ready:false,logged_in:null,reason:"instagram_dom_not_ready"};
  return {ready:true,logged_in:true,reason:"ready"};
}
function linksOf(root){
  const mentions=new Set(),hashtags=new Set();
  for(const a of root.querySelectorAll("a[href]")){
    const href=safe(a.getAttribute("href")),txt=safe(a.textContent);
    const hm=href.match(/^\/explore\/tags\/([^/?#]+)/);if(hm)hashtags.add("#"+decodeURIComponent(hm[1]));
    const um=href.match(/^\/([A-Za-z0-9._]+)\/?$/);if(um&&!["p","reel","reels","explore","stories","direct"].includes(um[1]))mentions.add("@"+um[1]);
    if(/^#[\p{L}\p{N}_]+$/u.test(txt))hashtags.add(txt);
    if(/^@[A-Za-z0-9._]+$/.test(txt))mentions.add(txt);
  }
  return {mentions:[...mentions].slice(0,80),hashtags:[...hashtags].slice(0,80)};
}
function postSnapshot(){
  const rd=adapterReadiness();if(!rd.ready)return {ok:false,error:"INSTAGRAM_ADAPTER_NOT_READY",...rd,url:location.href,profile:pageUser()};
  const article=rootArticle(),root=article||document.querySelector("main")||document.body;
  const url=location.href,media=extractMedia(root),rels=linksOf(root);
  const og=safe(document.querySelector('meta[property="og:description"]')?.content);
  const raw=safe(article?.innerText||root?.innerText||"").slice(0,16000);
  const time=root.querySelector("time");
  const datetime=safe(time?.getAttribute("datetime"));
  const caption=(og||raw).slice(0,12000);
  return {
    ok:true,schema:"sokna-instagram-post-v1",url,shortcode:shortcodeFrom(url),profile:pageUser(),
    type:media.some(x=>x.type==="video")?"video":(media.length>1?"carousel":"image"),
    datetime,caption,visible_text:raw,mentions:rels.mentions,hashtags:rels.hashtags,media
  };
}
function profileCards(){
  const out=[],seen=new Set();
  for(const a of document.querySelectorAll('main a[href*="/p/"],main a[href*="/reel/"]')){
    const href=cleanUrl(a.href);if(!href||seen.has(href))continue;
    seen.add(href);
    const img=a.querySelector("img"),video=a.querySelector("video");
    out.push({
      url:href,shortcode:shortcodeFrom(href),
      type:href.includes("/reel/")||video?"video":"post",
      thumbnail:cleanUrl(mediaUrl(img||video)),
      alt:safe(img?.alt),
      visible_text:safe(a.innerText).slice(0,1000)
    });
  }
  return out;
}
async function collectProfileLinks(limit){
  const rd=adapterReadiness();if(!rd.ready)throw new Error("INSTAGRAM_ADAPTER_NOT_READY:"+rd.reason);
  limit=Math.min(Math.max(Number(limit)||10,1),100);
  const found=new Map();let stable=0,last=-1;
  for(let round=0;round<30&&found.size<limit;round++){
    for(const card of profileCards()){if(!found.has(card.url))found.set(card.url,card);if(found.size>=limit)break}
    if(found.size===last)stable++;else stable=0;
    if(stable>=4)break;last=found.size;
    window.scrollBy(0,Math.max(window.innerHeight*1.6,1000));await sleep(650);
  }
  return [...found.values()].slice(0,limit);
}
chrome.runtime.onMessage.addListener((m,s,reply)=>{
  if(m?.type==="IG_READY"){const rd=adapterReadiness();reply({ok:rd.ready,url:location.href,profile:pageUser(),post:!!rootArticle(),media_count:rd.ready?extractMedia(rootArticle()||document).length:0,...rd});return}
  if(m?.type==="IG_POST_SNAPSHOT"){reply(postSnapshot());return}
  if(m?.type==="IG_PROFILE_LINKS"){collectProfileLinks(m.limit).then(cards=>reply({ok:true,url:location.href,profile:pageUser(),cards}),e=>reply({ok:false,error:String(e)}));return true}
});
})();