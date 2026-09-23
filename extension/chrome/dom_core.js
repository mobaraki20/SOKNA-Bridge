(()=>{
  "use strict";
  const G="__SOKNA_V33_DOM_CORE__";
  if(globalThis[G])return;

  const TEXT_START="SOKNA3CMD:",TEXT_END=":SOKNA3END";
  const V4_START="SOKNA4CMD:",V4_END=":SOKNA4END";
  const LINK_PREFIX="https://sokna.invalid/cmd/";
  const PROTO=globalThis.__SOKNA_PROTOCOL_V1__;

  function b64urlToUtf8(s){
    s=String(s||"").replace(/\s+/g,"").replace(/-/g,"+").replace(/_/g,"/");
    while(s.length%4)s+="=";
    const bin=atob(s),bytes=new Uint8Array(bin.length);
    for(let i=0;i<bin.length;i++)bytes[i]=bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }

  function parseEncoded(encoded,outerId="",spanOverride=0){
    try{
      const raw=b64urlToUtf8(encoded);
      const span=spanOverride||TEXT_START.length+String(encoded||"").length+TEXT_END.length;
      if(PROTO&&!PROTO.accept(raw,span))return null;
      const obj=PROTO?.expand?PROTO.expand(JSON.parse(raw)):JSON.parse(raw);
      if(!(obj&&obj.id&&obj.action))return null;
      if(outerId&&obj.id!==outerId)return null;
      try{Object.defineProperty(obj,"__soknaTransportValidated",{value:true})}catch{}
      return obj;
    }catch{return null}
  }

  function parseTextCarriers(text){
    text=String(text||"");
    const out=[];let pos=0;
    while(true){
      const a=text.indexOf(TEXT_START,pos);if(a<0)break;
      const b=text.indexOf(TEXT_END,a+TEXT_START.length);if(b<0)break;
      const obj=parseEncoded(text.slice(a+TEXT_START.length,b).trim());
      if(obj)out.push(obj);
      pos=b+TEXT_END.length;
    }
    return out;
  }

  function parseV4Carriers(text){
    text=String(text||"");const out=[];let pos=0;
    while(true){
      const a=text.indexOf(V4_START,pos);if(a<0)break;
      const b=text.indexOf(V4_END,a+V4_START.length);if(b<0)break;
      const inner=text.slice(a+V4_START.length,b).trim(),sep=inner.indexOf(":");
      if(sep>0&&!/\s/.test(inner)){
        const id=inner.slice(0,sep).trim(),body=inner.slice(sep+1).trim();
        if(/^[A-Za-z0-9._-]{1,96}$/.test(id)&&/^[A-Za-z0-9_-]+={0,2}$/.test(body)){const obj=parseEncoded(body,id,b+V4_END.length-a);if(obj)out.push(obj)}
      }
      pos=b+V4_END.length;
    }
    return out;
  }

  function parseLinkCarriers(value){
    value=String(value||"");
    const out=[];
    const re=/https:\/\/sokna\.invalid\/cmd\/([A-Za-z0-9_-]+)/g;
    let m;
    while((m=re.exec(value))){
      const obj=parseEncoded(m[1]);
      if(obj)out.push(obj);
    }
    return out;
  }

  function isEditable(el){
    if(!el||el.nodeType!==1)return false;
    if(el.matches?.('textarea,input,[contenteditable="true"],[contenteditable="plaintext-only"],[role="textbox"]'))return true;
    return !!el.closest?.('textarea,input,[contenteditable="true"],[contenteditable="plaintext-only"],[role="textbox"]');
  }

  function shadowOf(el){
    if(!el||el.nodeType!==1)return null;
    try{
      if(globalThis.chrome?.dom?.openOrClosedShadowRoot)return chrome.dom.openOrClosedShadowRoot(el)||null;
    }catch{}
    try{return el.shadowRoot||null}catch{return null}
  }

  function collectRoots(doc=document){
    const roots=[doc],seen=new Set(roots);
    let shadowRoots=0,hostsScanned=0;
    for(let i=0;i<roots.length;i++){
      const root=roots[i];
      let els=[];try{els=[...root.querySelectorAll("*")]}catch{}
      for(const el of els){
        hostsScanned++;
        const sr=shadowOf(el);
        if(sr&&!seen.has(sr)){seen.add(sr);roots.push(sr);shadowRoots++}
      }
    }
    return {roots,shadowRoots,hostsScanned};
  }

  function textOfRoot(root){
    const parts=[];
    try{
      const w=(root.ownerDocument||root).createTreeWalker(root,NodeFilter.SHOW_TEXT);
      let n;
      while((n=w.nextNode())){
        const p=n.parentElement;
        if(p&&isEditable(p))continue;
        if(p&&p.closest?.("style,noscript"))continue;
        if(n.nodeValue)parts.push(n.nodeValue);
      }
    }catch{}
    return parts.join("");
  }

  function scanAll(doc=document){
    const c=collectRoots(doc),map=new Map();
    let totalChars=0,textMarkerStarts=0,linkCarrierCount=0,attributeCarrierCount=0,htmlCarrierCount=0;

    function addAll(items){for(const x of items)if(x?.id)map.set(x.id,x)}

    for(const root of c.roots){
      // 1) Primary carrier: rendered Markdown link href.
      let links=[];
      try{links=[...root.querySelectorAll('a[href],area[href]')]}catch{}
      for(const a of links){
        const href=a.getAttribute("href")||a.href||"";
        const items=parseLinkCarriers(href);
        if(items.length){linkCarrierCount+=items.length;addAll(items)}
      }

      // 2) Attribute fallback, including data-* / aria-* / href-like values.
      let els=[];try{els=[...root.querySelectorAll("*")]}catch{}
      for(const el of els){
        if(isEditable(el))continue;
        for(const at of [...(el.attributes||[])]){
          const v=at.value||"";
          if(v.includes("sokna.invalid/cmd/")){
            const items=parseLinkCarriers(v);
            if(items.length){attributeCarrierCount+=items.length;addAll(items)}
          }
          if(v.includes(TEXT_START)){
            const items=parseTextCarriers(v);
            if(items.length){attributeCarrierCount+=items.length;addAll(items)}
          }
          if(v.includes(V4_START)){
            const items=parseV4Carriers(v);
            if(items.length){attributeCarrierCount+=items.length;addAll(items)}
          }
        }
      }

      // 3) Text fallback.
      const t=textOfRoot(root);
      totalChars+=t.length;
      textMarkerStarts+=(t.match(/SOKNA3CMD:/g)||[]).length+(t.match(/SOKNA4CMD:/g)||[]).length;
      addAll(parseV4Carriers(t));
      addAll(parseTextCarriers(t));
      addAll(parseLinkCarriers(t));

      // 4) Serialized-markup fallback. This catches script/hydration/attribute storage.
      try{
        const html=root===doc?(doc.documentElement?.innerHTML||""):(root.innerHTML||"");
        if(html.includes("sokna.invalid/cmd/")){
          const items=parseLinkCarriers(html);
          if(items.length){htmlCarrierCount+=items.length;addAll(items)}
        }
        if(html.includes(TEXT_START)){
          const items=parseTextCarriers(html);
          if(items.length){htmlCarrierCount+=items.length;addAll(items)}
        }
        if(html.includes(V4_START)){
          const items=parseV4Carriers(html);
          if(items.length){htmlCarrierCount+=items.length;addAll(items)}
        }
      }catch{}
    }

    return {
      commands:[...map.values()],
      diagnostics:{
        rootCount:c.roots.length,
        shadowRootCount:c.shadowRoots,
        hostsScanned:c.hostsScanned,
        totalChars,
        textMarkerStarts,
        linkCarrierCount,
        attributeCarrierCount,
        htmlCarrierCount
      }
    };
  }

  function visible(el){
    if(!el)return false;
    try{
      const s=getComputedStyle(el),r=el.getBoundingClientRect();
      return s.display!=="none"&&s.visibility!=="hidden"&&r.width>0&&r.height>0;
    }catch{return false}
  }

  function findFirst(selectors,predicate=()=>true,doc=document){
    const {roots}=collectRoots(doc);
    for(const root of roots)for(const q of selectors){
      let list=[];try{list=[...root.querySelectorAll(q)]}catch{}
      for(let i=list.length-1;i>=0;i--){
        const el=list[i];
        if(visible(el)&&predicate(el))return el;
      }
    }
    return null;
  }

  function composer(doc=document){
    return findFirst([
      '#prompt-textarea','[data-testid="prompt-textarea"]','textarea',
      '[contenteditable="true"][role="textbox"]',
      '[contenteditable="plaintext-only"][role="textbox"]',
      '[contenteditable="true"]'
    ],el=>!el.closest?.('[aria-hidden="true"]'),doc);
  }

  function textOf(el){
    if(!el)return "";
    if(el instanceof HTMLTextAreaElement||el instanceof HTMLInputElement)return el.value||"";
    return el.innerText||el.textContent||"";
  }

  function nativeSetValue(el,value){
    const proto=el instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;
    const setter=Object.getOwnPropertyDescriptor(proto,"value")?.set;
    if(setter)setter.call(el,value);else el.value=value;
  }

  function setComposer(el,text){
    el.focus();
    if(el instanceof HTMLTextAreaElement||el instanceof HTMLInputElement){
      nativeSetValue(el,text);
      try{el.dispatchEvent(new InputEvent("beforeinput",{bubbles:true,cancelable:true,inputType:"insertText",data:text}))}catch{}
      try{el.dispatchEvent(new InputEvent("input",{bubbles:true,inputType:"insertText",data:text}))}catch{el.dispatchEvent(new Event("input",{bubbles:true}))}
      el.dispatchEvent(new Event("change",{bubbles:true}));
      return;
    }
    const sel=getSelection(),range=document.createRange();
    range.selectNodeContents(el);sel.removeAllRanges();sel.addRange(range);
    let ok=false;
    try{ok=!!document.execCommand?.("insertText",false,text)}catch{}
    if(!ok){
      el.textContent=text;
      try{el.dispatchEvent(new InputEvent("input",{bubbles:true,inputType:"insertText",data:text}))}catch{el.dispatchEvent(new Event("input",{bubbles:true}))}
    }
  }

  function sendButton(doc=document){
    return findFirst([
      '[data-testid="send-button"]','[data-testid="composer-submit-button"]','button[data-testid*="submit" i]','#composer-submit-button',
      'button[aria-label*="send" i]','button[aria-label*="ارسال" i]',
      'button[title*="send" i]','button[title*="ارسال" i]'
    ],b=>!b.disabled&&b.getAttribute("aria-disabled")!=="true",doc);
  }

  function genericSubmitButton(doc=document){return findFirst(['button[type="submit"]'],x=>{const s=((x.getAttribute("data-testid")||"")+" "+(x.getAttribute("aria-label")||"")+" "+(x.title||"")).toLowerCase();return !x.disabled&&x.getAttribute("aria-disabled")!=="true"&&!/(mic|voice|upload|attach|stop|cancel|tool|camera|record)/.test(s)},doc)}

  const delay=ms=>new Promise(r=>setTimeout(r,ms));

  async function verifySent(el,envelope){
    for(let i=0;i<24;i++){
      await delay(125);
      if(!textOf(el).includes(envelope))return true;
    }
    return false;
  }

  async function submitEnvelope(envelope){
    const el=composer();
    if(!el)return {ok:false,error:"Composer not found"};
    const existing=textOf(el).trim();
    if(existing&&existing!==envelope)return {ok:false,error:"Composer contains user text; Bridge did not overwrite it."};
    if(existing!==envelope){setComposer(el,envelope);await delay(250)}

    for(let i=0;i<8;i++){
      const b=sendButton();
      if(b){
        try{HTMLElement.prototype.click.call(b)}catch{try{b.click()}catch{}}
        if(await verifySent(el,envelope))return {ok:true,method:"button.click"};
      }
      await delay(100);
    }

    const b=sendButton()||(textOf(el).trim()===envelope?genericSubmitButton():null),form=b?.form||el.closest?.("form");
    if(form){
      try{HTMLFormElement.prototype.requestSubmit.call(form,b&&b.form===form?b:undefined)}catch{}
      if(await verifySent(el,envelope))return {ok:true,method:"requestSubmit"};
    }

    try{
      el.focus();
      const o={key:"Enter",code:"Enter",keyCode:13,which:13,bubbles:true,cancelable:true};
      el.dispatchEvent(new KeyboardEvent("keydown",o));
      el.dispatchEvent(new KeyboardEvent("keypress",o));
      el.dispatchEvent(new KeyboardEvent("keyup",o));
    }catch{}
    if(await verifySent(el,envelope))return {ok:true,method:"keyboard-enter"};

    return {ok:false,error:"Composer did not clear after page-level submit methods."};
  }

  globalThis[G]={
    version:"3.10.5",LINK_PREFIX,
    b64urlToUtf8,parseEncoded,parseTextCarriers,parseV4Carriers,parseLinkCarriers,
    shadowOf,collectRoots,scanAll,composer,textOf,sendButton,submitEnvelope
  };
})();
