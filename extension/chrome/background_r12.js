(()=>{
"use strict";
// r12 preloads only small policy shims, then delegates to the proven r11 bootstrap/runtime.
importScripts("capability_gate.js","browser_target_core.js","browser_task_core.js");
const TASK_ACTION="browser.task.run";
const baseCap=globalThis.__SOKNA_CAPABILITY_GATE_V1__;
if(!baseCap?.create)throw new Error("R12_CAPABILITY_GATE_BASE_UNAVAILABLE");
globalThis.__SOKNA_CAPABILITY_GATE_V1__=Object.freeze({...baseCap,create(options={}){
  const extensionActions=[...new Set([...(options.extensionActions||[]),TASK_ACTION])];
  return baseCap.create({...options,extensionActions})
}});
const baseTarget=globalThis.__SOKNA_BROWSER_TARGET_CORE_V1__;
if(!baseTarget?.isPageAction)throw new Error("R12_BROWSER_TARGET_BASE_UNAVAILABLE");
const pageActions=Object.freeze([...new Set([...(baseTarget.PAGE_ACTIONS||[]),TASK_ACTION])]);
globalThis.__SOKNA_BROWSER_TARGET_CORE_V1__=Object.freeze({...baseTarget,PAGE_ACTIONS:pageActions,isPageAction(action){return pageActions.includes(String(action||""))}});
importScripts("background_bootstrap.js");
importScripts("browser_task_runtime.js");
})();
