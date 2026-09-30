(()=>{
"use strict";
const G="__SOKNA_CHAT_ORIGIN_REGISTRY_V1__";if(globalThis[G])return;
const BUILTIN=Object.freeze(["https://chatgpt.com","https://gpt.arzanai.com"]);
function normalizeOrigin(input){try{const u=new URL(String(input||""));if(u.protocol!=="https:"||u.username||u.password)return"";return u.origin.toLowerCase()}catch{return""}}
function originPattern(input){const o=normalizeOrigin(input);return o?o+"/*":""}
function isBuiltin(input){const o=normalizeOrigin(input);return BUILTIN.includes(o)}
function conversationId(input){try{const u=new URL(String(input||""));const parts=u.pathname.split("/").filter(Boolean);for(let i=parts.length-2;i>=0;i--){if(parts[i].toLowerCase()==="c"&&parts[i+1])return String(parts[i+1])}return""}catch{return""}}
function conversationKey(input){try{const u=new URL(String(input||"")),o=normalizeOrigin(u.href);if(!o)return"";const id=conversationId(u.href);return id?o+"/c/"+id:o+u.pathname}catch{return""}}
function hash(s){s=String(s||"");let h=2166136261;for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619)}return(h>>>0).toString(16).padStart(8,"0")}
function scriptId(input){const o=normalizeOrigin(input);return o?"sokna-chat-"+hash(o):""}
function normalizeList(values){return [...new Set([...(values||[]),...BUILTIN].map(normalizeOrigin).filter(Boolean))].sort()}
globalThis[G]=Object.freeze({BUILTIN,normalizeOrigin,originPattern,isBuiltin,conversationId,conversationKey,scriptId,normalizeList});
})();
