(()=>{
"use strict";
function describeChat(s){
  const status=s?.status||{},h=s?.health||{},p=h.connectionProbe||{};
  if(!s?.armed)return {dot:"warn",text:"این گفتگو هنوز متصل نیست",sub:"Page detected؛ برای شروع Connect this Chat را بزن."};
  if(status.actionRequired===true||status.state==="Needs Action"){
    if(h.deliveryState==="delivery_uncertain"){
      return {dot:"warn",text:"Needs Action — Delivery uncertain",sub:"نتیجه قبلاً submit شده اما دیده‌شدن آن در گفتگو تأیید نشده است. Re-check فقط visibility را بررسی می‌کند و نتیجه را دوباره ارسال نمی‌کند."};
    }
    return {dot:"warn",text:"Needs Action",sub:status.lastError||status.detail||"این اتصال نیاز به بررسی دارد."};
  }
  if(status.detail==="Needs Re-arm"||h.pageAdapterState==="arm_mismatch")return {dot:"bad",text:"Needs Re-arm",sub:"Top-frame page adapter آماده نیست."};
  if(status.transportVerified===true)return {dot:"ok",text:"Connected — End-to-End Verified",sub:"Semantic ✓  Background ✓  Agent ✓  Session ✓  Delivery ✓"};
  if(p?.agent?.ok===false)return {dot:"bad",text:"Connected — Agent Unreachable",sub:"صفحه متصل است اما Agent probe موفق نشده."};
  if(p?.delivery?.ready===false&&p?.semantic?.ok)return {dot:"warn",text:"Connected — Delivery Unavailable",sub:"Semantic/Agent در دسترس‌اند ولی مسیر ارسال نتیجه به Chat آماده نیست."};
  return {dot:"warn",text:"Connected — Transport Unverified",sub:"اتصال ثبت شده اما probe کامل end-to-end هنوز موفق نشده."};
}
function recoveryModel(s){
  const status=s?.status||{},h=s?.health||{};
  const uncertain=(status.actionRequired===true||status.state==="Needs Action")&&h.deliveryState==="delivery_uncertain";
  return {
    visible:!!uncertain,
    recordId:uncertain?String(status.currentCommandId||h.currentCommandId||""):"",
    title:"Delivery uncertain",
    detail:"این نتیجه قبلاً submit شده اما visibility آن در گفتگو تأیید نشده است.",
    action:"Re-check delivery"
  };
}
globalThis.__SOKNA_POPUP_STATE_V1__={describeChat,recoveryModel};
})();