// The settings picker has one primary and two optional satellite slots.
// Selecting an occupied slot swaps its contents, so promotion keeps the set.
export function trackingSelection(state,slot,key){
  const next={body:state.body,extra:[state.extra[0]||'',state.extra[1]||''],also:(state.also||[]).slice()};
  const selected=[next.body,...next.extra];
  if(slot===-1){
    if(selected.includes(key))return next;
    slot=selected.indexOf('');
  }
  if(slot<0||slot>2||(!key.startsWith('sat:')&&slot!==0))return null;
  const previous=selected[slot],existing=selected.indexOf(key);
  // An empty companion cannot take the primary away; it needs a new body.
  if(!previous&&existing>=0)return null;
  if(existing>=0&&existing!==slot){
    selected[existing]=previous.startsWith('sat:')?previous:'';
    if(existing>0&&(previous==='sun'||previous==='moon')&&!next.also.includes(previous))next.also.push(previous);
  }
  selected[slot]=key;next.body=selected[0];next.extra=selected.slice(1);
  return next;
}
export function trackingRemove(state,key){
  if(key===state.body)return null;
  return {body:state.body,extra:state.extra.map(b=>b===key?'':b),also:(state.also||[]).slice()};
}
