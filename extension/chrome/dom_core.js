(()=>{
  "use strict";
  const G="__SOKNA_V33_DOM_CORE__";
  if(globalThis[G])return;

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

  // Compatibility surface for diagnostics only. Command discovery is intentionally
  // owned by semantic_intent.js; this DOM core no longer parses any legacy carrier.
  function scanAll(doc=document){
    const c=collectRoots(doc);
    return {
      commands:[],
      diagnostics:{
        rootCount:c.roots.length,
        shadowRootCount:c.shadowRoots,
        hostsScanned:c.hostsScanned,
        commandDiscovery:"semantic-intent-only"
      }
    };
  }

  function visible(el){
    if(!el)return false;
    try{
      const s=getComputedStyle(el),r=eBounds(el);
      return s.display!=="none"&&s.visibility!=="hidden"&&r.width>0&&r.height>0;
    }catch{return false}
  }
  function eBounds(el){return el.getBoundingClientRect()}

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

  function genericSubmitButton(doc=document){
    return findFirst(['button[type="submit"]'],x=>{
      const s=((x.getAttribute("data-testid")||"")+" "+(x.getAttribute("aria-label")||"")+" "+(x.title||"")).toLowerCase();
      return !x.disabled&&x.getAttribute("aria-disabled")!=="true"&&!/(mic|voice|upload|attach|stop|cancel|tool|camera|record)/.test(s)
    },doc)
  }

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
    version:"3.10.9",
    shadowOf,collectRoots,scanAll,composer,textOf,sendButton,submitEnvelope
  };
})();
