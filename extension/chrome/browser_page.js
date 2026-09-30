/*
 * SOKNA Browser Page Engine
 *
 * Portions of the stable-ref, snapshot, text, click/fill and scroll design are
 * adapted from whg517/browser-bridge v0.7.1, commit
 * 74e234bc50fc3733e8bab4edef100907942a7001:
 *   extension/src/content/refs.ts
 *   extension/src/content/snapshot.ts
 *   extension/src/content/actions.ts
 *
 * Upstream license: Apache License 2.0.
 * SOKNA changes: isolated message envelope, top-frame-only v1 dispatch,
 * SOKNA ref attribute, bounded outputs, structured error codes, no eval/cookie/
 * storage primitives.
 */
(()=>{
"use strict";
if(globalThis.__SOKNA_BROWSER_PAGE_V1__)return;

const REF_ATTR="data-sokna-browser-ref";
const MAX_TEXT=20000;
const MAX_NAME=160;
let refCounter=0;
let refMap=new Map();

function err(code,message,details={}){return {ok:false,code,error:String(message||code),details}}
function truncate(v,n){v=String(v||"");return v.length>n?v.slice(0,n)+"…":v}
function resetRefs(){refCounter=0;refMap=new Map()}
function assignRef(el){
  let ref=el.getAttribute(REF_ATTR);
  if(ref){
    const n=Number.parseInt(ref.slice(1),10);if(Number.isFinite(n)&&n>refCounter)refCounter=n;
  }else{ref="e"+(++refCounter);el.setAttribute(REF_ATTR,ref)}
  refMap.set(ref,el);return ref
}
function resolveTarget(args={}){
  if(args.ref){
    const ref=String(args.ref);
    let el=refMap.get(ref);
    if(!el){el=document.querySelector("["+REF_ATTR+"=\""+CSS.escape(ref)+"\"]")||undefined;if(el)refMap.set(ref,el)}
    if(!el)throw Object.assign(new Error("ref not found: "+ref+"; take a new snapshot"),{code:"BROWSER_REF_STALE"});
    return el
  }
  if(args.selector){
    const el=document.querySelector(String(args.selector));
    if(!el)throw Object.assign(new Error("selector matched nothing: "+args.selector),{code:"BROWSER_SELECTOR_NOT_FOUND"});
    return el
  }
  throw Object.assign(new Error("ref or selector required"),{code:"BROWSER_TARGET_REQUIRED"})
}
const TAGS=new Set(["a","button","input","textarea","select","summary","details","label","option","optgroup"]);
const ROLES=new Set(["button","link","checkbox","radio","textbox","searchbox","menuitem","menuitemcheckbox","menuitemradio","tab","combobox","listbox","option","switch","treeitem"]);
function isInteractive(el){
  const tag=el.tagName.toLowerCase();if(["iframe","frame","object","embed"].includes(tag))return false;
  if(TAGS.has(tag))return true;const role=el.getAttribute("role");if(role&&ROLES.has(role))return true;
  return el.hasAttribute("onclick")||el.tabIndex>=0
}
function isVisible(el){
  if(!el?.getClientRects||el.getClientRects().length===0)return false;
  const style=getComputedStyle(el);if(style.display==="none"||style.visibility==="hidden"||Number.parseFloat(style.opacity||"1")===0)return false;
  let cur=el;while(cur&&cur.nodeType===1){if(cur.getAttribute("aria-hidden")==="true")return false;cur=cur.parentElement}
  return true
}
function roleOf(el){
  const explicit=el.getAttribute("role");if(explicit)return explicit;
  const tag=el.tagName.toLowerCase(),type=(el.getAttribute("type")||"").toLowerCase();
  if(tag==="a"&&el.hasAttribute("href"))return"link";if(tag==="button")return"button";
  if(tag==="input"){if(type==="checkbox")return"checkbox";if(type==="radio")return"radio";if(["submit","button","reset"].includes(type))return"button";return"textbox"}
  if(tag==="textarea")return"textbox";if(tag==="select")return"listbox";if(tag==="summary")return"button";return tag
}
function nameOf(el){
  const ids=(el.getAttribute("aria-labelledby")||"").trim();
  if(ids){const s=ids.split(/\s+/).map(id=>document.getElementById(id)).filter(Boolean).map(n=>n.innerText||n.textContent||"").join(" ").trim();if(s)return truncate(s,MAX_NAME)}
  const aria=(el.getAttribute("aria-label")||"").trim();if(aria)return truncate(aria,MAX_NAME);
  if(el.id){try{const l=document.querySelector("label[for=\""+CSS.escape(el.id)+"\"]");const s=(l?.innerText||"").trim();if(s)return truncate(s,MAX_NAME)}catch{}}
  const wrapping=el.closest?.("label"),wrapText=(wrapping?.innerText||"").trim();if(wrapText)return truncate(wrapText,MAX_NAME);
  const title=(el.title||"").trim();if(title)return truncate(title,MAX_NAME);
  const txt=(el.innerText||el.textContent||"").trim();if(txt)return truncate(txt,MAX_NAME);
  const placeholder=(el.getAttribute("placeholder")||"").trim();if(placeholder)return truncate(placeholder,MAX_NAME);
  const alt=(el.getAttribute("alt")||"").trim();return truncate(alt,MAX_NAME)
}
function valuePreview(el){
  if(!["INPUT","TEXTAREA","SELECT"].includes(el.tagName))return undefined;
  const type=(el.type||"").toLowerCase();if(["checkbox","radio"].includes(type))return undefined;
  const v=String(el.value||"");if(type==="password")return v?"••••••":"";return truncate(v,80)
}
function checkedState(el){return el.tagName==="INPUT"&&["checkbox","radio"].includes((el.type||"").toLowerCase())?!!el.checked:undefined}
function selectorOf(el){
  const parts=[];let cur=el;
  while(cur&&cur.nodeType===1&&cur!==document.body){
    let part=cur.tagName.toLowerCase();
    if(cur.id){part+="#"+CSS.escape(cur.id);parts.unshift(part);break}
    const parent=cur.parentElement;if(parent){const siblings=[...parent.children].filter(x=>x.tagName===cur.tagName);if(siblings.length>1)part+=":nth-of-type("+(siblings.indexOf(cur)+1)+")"}
    parts.unshift(part);cur=cur.parentElement
  }
  return parts.join(" > ")
}
function walkSnapshot(){
  resetRefs();const nodes=[];
  if(!document.body)return {refCount:0,nodes,url:location.href,title:document.title};
  const w=document.createTreeWalker(document.body,NodeFilter.SHOW_ELEMENT,{acceptNode:n=>isInteractive(n)?NodeFilter.FILTER_ACCEPT:NodeFilter.FILTER_SKIP});
  let node;while((node=w.nextNode())){const el=node;if(!isVisible(el))continue;nodes.push({ref:assignRef(el),role:roleOf(el),name:nameOf(el),selector:selectorOf(el),value:valuePreview(el),checked:checkedState(el)})}
  return {refCount:nodes.length,nodes,url:location.href,title:document.title}
}
async function snapshot(){
  let r=walkSnapshot();for(let i=0;r.refCount===0&&i<4;i++){await new Promise(x=>setTimeout(x,300));r=walkSnapshot()}
  if(r.refCount===0)r.note="No interactive elements found in the top frame. Wait for rendering or use screenshot evidence.";
  return r
}
function fullText(){
  const clone=document.body?.cloneNode(true);if(!clone)return"";
  clone.querySelectorAll("script,style,noscript,template").forEach(n=>n.remove());
  clone.querySelectorAll('input[type="password"]').forEach(n=>n.setAttribute("value","••••••"));
  return (clone.textContent||"").replace(/[^\S\n]+/g," ").replace(/\s*\n\s*/g,"\n").replace(/\n{3,}/g,"\n\n").trim()
}
function pageText(args={}){
  const raw=args.mode==="full"?fullText():(document.body?.innerText||"");
  return {text:truncate(raw.replace(/\b\d{12,19}\b/g,"••••••"),MAX_TEXT),url:location.href,mode:args.mode==="full"?"full":"visible"}
}
function setNativeValue(el,value){
  const proto=el.tagName==="TEXTAREA"?HTMLTextAreaElement.prototype:el.tagName==="SELECT"?HTMLSelectElement.prototype:HTMLInputElement.prototype;
  const setter=Object.getOwnPropertyDescriptor(proto,"value")?.set;if(setter)setter.call(el,value);else el.value=value;
  el.dispatchEvent(new Event("input",{bubbles:true}));el.dispatchEvent(new Event("change",{bubbles:true}))
}
function click(args){const el=resolveTarget(args);el.scrollIntoView({block:"center"});el.focus?.();el.click();return {clicked:args.ref||args.selector,role:roleOf(el)}}
function fill(args){const el=resolveTarget(args);if(!("value" in args))throw Object.assign(new Error("value required"),{code:"BROWSER_FILL_VALUE_REQUIRED"});el.focus?.();setNativeValue(el,String(args.value??""));return {filled:args.ref||args.selector}}
function scroll(args={}){
  if(Number.isFinite(args.pixels))window.scrollBy(0,Number(args.pixels));
  else if(args.direction){const d=window.innerHeight*.9;switch(args.direction){case"down":window.scrollBy(0,d);break;case"up":window.scrollBy(0,-d);break;case"top":window.scrollTo(0,0);break;case"bottom":window.scrollTo(0,document.body?.scrollHeight||0);break;default:throw Object.assign(new Error("direction must be up|down|top|bottom"),{code:"BROWSER_SCROLL_DIRECTION_INVALID"})}}
  else throw Object.assign(new Error("direction or pixels required"),{code:"BROWSER_SCROLL_INPUT_REQUIRED"});
  return {scrollX:window.scrollX,scrollY:window.scrollY}
}
function matchesWait(args){
  if(args.selector){const count=document.querySelectorAll(String(args.selector)).length;const min=Math.max(1,Number(args.minCount)||1);if(count<min)return false}
  if(args.text&&!String(document.body?.innerText||"").includes(String(args.text)))return false;
  return !!(args.selector||args.text)
}
async function wait(args={}){
  const timeout=Math.min(Math.max(Number(args.timeoutMs)||30000,50),60000),deadline=Date.now()+timeout;
  if(args.settled){
    let last="",stableSince=Date.now();
    while(Date.now()<deadline){
      const current=(document.body?.innerHTML||"").length+":"+document.querySelectorAll("*").length;
      if(current===last&&Date.now()-stableSince>=500)return {settled:true,url:location.href};
      if(current!==last){last=current;stableSince=Date.now()}
      await new Promise(r=>setTimeout(r,100))
    }
    throw Object.assign(new Error("page did not settle before timeout"),{code:"BROWSER_WAIT_TIMEOUT"})
  }
  if(!(args.selector||args.text))throw Object.assign(new Error("selector, text, or settled required"),{code:"BROWSER_WAIT_INPUT_REQUIRED"});
  while(Date.now()<deadline){if(matchesWait(args))return {matched:true,url:location.href};await new Promise(r=>setTimeout(r,100))}
  throw Object.assign(new Error("wait condition timed out"),{code:"BROWSER_WAIT_TIMEOUT"})
}
async function execute(action,args={}){
  switch(action){
    case"snapshot":return await snapshot();
    case"text":return pageText(args);
    case"click":return click(args);
    case"fill":return fill(args);
    case"scroll":return scroll(args);
    case"wait":return await wait(args);
    case"dimensions":return {viewportWidth:window.innerWidth,viewportHeight:window.innerHeight,scrollWidth:Math.max(document.documentElement?.scrollWidth||0,document.body?.scrollWidth||0),scrollHeight:Math.max(document.documentElement?.scrollHeight||0,document.body?.scrollHeight||0),devicePixelRatio:window.devicePixelRatio||1,url:location.href};
    case"ping":return {ready:true,url:location.href};
    default:throw Object.assign(new Error("unsupported browser page action"),{code:"BROWSER_PAGE_ACTION_UNSUPPORTED"})
  }
}
chrome.runtime.onMessage.addListener((m,_sender,reply)=>{
  if(m?.type!=="SOKNA_BROWSER_PAGE")return;
  (async()=>{try{reply({ok:true,result:await execute(String(m.action||""),m.args||{})})}catch(e){reply(err(String(e?.code||"BROWSER_PAGE_FAILED"),String(e?.message||e)))}})();
  return true;
});
globalThis.__SOKNA_BROWSER_PAGE_V1__=Object.freeze({version:1});
})();