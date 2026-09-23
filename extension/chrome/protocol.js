(()=>{
'use strict';
const E=new TextEncoder();
const V4_START='SOKNA4CMD:',V4_END=':SOKNA4END';
const ID_RE=/^[A-Za-z0-9._-]{1,96}$/;
const api={
  v:1,maxCarrierChars:1200,maxPayloadBytes:800,maxExpandedCommandBytes:4096,
  ws:Object.freeze({B:'SOKNA-Bridge',C:'SoknaCafe'}),
  op:Object.freeze({fr:'file.read',fw:'file.write',fx:'file.replace',fs:'file.search',ps:'plan.stage',pr:'plan.run',j:'job.submit',p:'ping'}),
  k:Object.freeze({f:'path',s:'start_line',n:'line_count',q:'query'}),
  expand(c){if(c?.id&&c?.action)return c;const p={};for(const[k,v]of Object.entries(c?.a||{}))p[this.k[k]||k]=v;if(c?.w)p.workspace=this.ws[c.w]||c.w;return{id:c?.i,action:this.op[c?.o]||c?.o,params:p}},
  accept(raw,span){return span<=this.maxCarrierChars&&this.bytes(raw)<=this.maxPayloadBytes},
  bytes:s=>E.encode(String(s)).byteLength,
  validCommandId:id=>ID_RE.test(String(id||'')),
  nextV4Frame(text,from=0){
    text=String(text||'');
    const a=text.indexOf(V4_START,from);if(a<0)return null;
    const b=text.indexOf(V4_END,a+V4_START.length);if(b<0)return{kind:'partial',a,nextFrom:a+V4_START.length};
    const nested=text.indexOf(V4_START,a+V4_START.length);
    if(nested>=0&&nested<b)return{kind:'nested',a,b,nested,nextFrom:nested};
    const inner=text.slice(a+V4_START.length,b).trim(),sep=inner.indexOf(':');
    const outerId=sep>0?inner.slice(0,sep).trim():'',body=sep>0?inner.slice(sep+1).trim():'';
    const span=b+V4_END.length-a;
    return{kind:'complete',a,b,nextFrom:b+V4_END.length,inner,outerId,body,span,validOuterId:ID_RE.test(outerId),hasWhitespace:/\s/.test(inner)};
  },
  correlatableMalformedV4(frame){return !!frame&&frame.kind==='complete'&&frame.validOuterId===true&&Number(frame.span||0)<=this.maxCarrierChars}
};
globalThis.__SOKNA_PROTOCOL_V1__=Object.freeze(api);
})();
