/** Import in the client only, after /bangbom/bangbom-chat.js is loaded.
 * Call with the project's ACTUAL adapters. Never map demo-* identifiers to production data.
 */
export function connectBangbom({button, homepageForm, catalog, initialProfile={}, openMapFor, openHouseFor, openEligibility, interpretEndpoint, nonce}) {
  if (!button || !Array.isArray(catalog)) throw Error('Existing launcher and native apartment catalog required');
  const B=window.BangbomChat;
  if (!B?.mount || !B.engine.catalog(catalog).length) throw Error('No valid jeonse apartments or widget not loaded');
  let chat;
  function route(fn){return typeof fn==='function'?async payload=>{await fn(payload.id,payload.profile,payload.viewIntent);chat.close();}:undefined;}
  chat=B.mount({catalog,initialProfile,nonce,includeSamples:false,showLauncher:false,interpretEndpoint,
    onMap:route(openMapFor),onFloorplan:route(openHouseFor),onProfile:openEligibility?async()=>{await openEligibility();chat.close();}:undefined});
  const open=()=>chat.open();
  const submit=e=>{e.preventDefault();const line=new FormData(homepageForm).get('preference');chat.open(typeof line==='string'?line:undefined);};
  button.addEventListener('click',open);homepageForm?.addEventListener('submit',submit);
  return {chat,dispose(){button.removeEventListener('click',open);homepageForm?.removeEventListener('submit',submit);chat.destroy();}};
}
