(()=>{
if(window.__SOKNA_V25__)return;window.__SOKNA_V25__=true;
const RE=/\[SOKNA-V2-CMD\]([\s\S]*?)\[\/SOKNA-V2-CMD\]/g, seen=new Set(), queue=[];
let armed=false,busy=false,observer=null;
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const key=()=>location.origin+location.pathname;
function pageBroken(){return (document.body?.innerText||"").toLowerCase().includes("content failed to load")}
function commands(text){const out=[];RE.lastIndex=0;let m;while((m=RE.exec(text||""))){try{const c=JSON.parse(m[1].trim());if(c?.id)out.push(c)}catch{}}return out}
function baseline(){for(const c of commands(document.body?.innerText||""))seen.add(c.id)}
function vis(e){if(!e)return false;const s=getComputedStyle(e),r=e.getBoundingClientRect();return s.display!=="none"&&s.visibility!=="hidden"&&r.width>0&&r.height>0}
function composer(){for(const q of ['[data-testid="prompt-textarea"]','textarea','[contenteditable="true"][role="textbox"]','[contenteditable="true"]']){const a=[...document.querySelectorAll(q)].filter(vis);if(a.length)return a[a.length-1]}return null}
function sendButton(){for(const q of ['[data-testid="send-button"]','button[aria-label*="send" i]','button[aria-label*="ارسال" i]','button[type="submit"]']){const a=[...document.querySelectorAll(q)].filter(vis);if(a.length)return a[a.length-1]}return null}
function setInput(el,text){el.focus();if(el instanceof HTMLTextAreaElement||el instanceof HTMLInputElement){const p=el instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;const s=Object.getOwnPropertyDescriptor(p,"value")?.set;s?s.call(el,text):(el.value=text);el.dispatchEvent(new Event("input",{bubbles:true}));}else{el.textContent="";el.appendChild(document.createTextNode(text));el.dispatchEvent(new InputEvent("input",{bubbles:true,inputType:"insertText",data:text}));}}
function compact(o){try{const s=JSON.stringify(o);if(s.length<=14000)return o;return {id:o.id,ok:o.ok,bridge_truncated:true,error:o.error||undefined,preview:s.slice(0,12000)}}catch{return {ok:false,error:"Could not serialize bridge result"}}}
async function post(result){for(let i=0;i<40;i++){if(pageBroken()){await wait(1000);continue}const el=composer();if(!el){await wait(500);continue}const obj=compact(result),payload=`[SOKNA-V2-RESULT]${JSON.stringify(obj)}[/SOKNA-V2-RESULT]`;setInput(el,payload);await wait(180);const b=sendButton();if(b&&!b.disabled){b.click();await wait(900);return true}const f=el.closest("form");if(f?.requestSubmit){try{f.requestSubmit();await wait(900);return true}catch{}}await wait(500)}return false}
function enqueue(node){if(!armed||!node)return;let t="";if(node.nodeType===Node.TEXT_NODE)t=node.nodeValue||"";else if(node.nodeType===Node.ELEMENT_NODE)t=node.innerText||node.textContent||"";if(!t.includes("[SOKNA-V2-CMD]"))return;for(const c of commands(t)){if(seen.has(c.id))continue;seen.add(c.id);queue.push(c)}pump()}
async function pump(){if(!armed||busy||!queue.length||pageBroken())return;busy=true;try{while(armed&&queue.length){const cmd=queue.shift();const res=await new Promise(resolve=>chrome.runtime.sendMessage({type:"SOKNA_EXEC",conversationKey:key(),command:cmd},r=>resolve(r||{ok:false,error:"No extension response"})));if(res.ignored||res.duplicate_running)continue;if(!(await post({id:cmd.id,...res}))){queue.unshift(cmd);break}await wait(1000)}}finally{busy=false}}
function start(){if(observer)return;baseline();observer=new MutationObserver(ms=>{if(!armed)return;for(const m of ms)for(const n of m.addedNodes)enqueue(n)});observer.observe(document.documentElement,{childList:true,subtree:true});console.log("SOKNA V2.5 armed on",key(),"baseline",seen.size)}
function stop(){if(observer){observer.disconnect();observer=null}queue.length=0;console.log("SOKNA V2.5 disarmed")}
async function refreshState(){const r=await new Promise(resolve=>chrome.runtime.sendMessage({type:"SOKNA_ARM_STATE",conversationKey:key()},x=>resolve(x||{})));armed=!!r.armed;armed?start():stop();document.documentElement.dataset.soknaArmed=armed?"1":"0";return r}
chrome.runtime.onMessage.addListener((m,s,r)=>{if(m?.type==="SOKNA_CONTENT_INFO"){r({ok:true,conversationKey:key(),armed,pageBroken:pageBroken()});return}if(m?.type==="SOKNA_REFRESH_ARM"){refreshState().then(r);return true}});
refreshState();setInterval(()=>{if(armed)pump()},3000);
})();
