import { useCallback, useEffect, useState } from 'react';
import type { OpeningKind, Point } from '../../contracts/model';
import type { UsePlanToolController, WorldPointer } from '../../contracts/ui';
import { openingPreview } from './opening-preview';
import { OPENING_DEFAULTS } from './wall-draft';
import { setNotice } from './notice';
import { isTextTarget } from './text-target';

export function useOpeningController({document: plan, session, onCommand}: Parameters<UsePlanToolController>[0], active: boolean, epoch: number) {
  const [point,setPoint]=useState<Point|null>(null);
  const [ready,setReady]=useState(false);
  const [kind,setKind]=useState<OpeningKind>('door');
  const [width,setWidth]=useState('0.9');
  const key=`${active}\0${plan.id}\0${epoch}`;
  const [context,setContext]=useState(key);
  if (context!==key) {setContext(key);setPoint(null);setReady(false);}
  const cancel=useCallback(()=>{setPoint(null);setReady(false);setNotice(null);},[]);
  useEffect(()=>{
    if (!active) return;
    const onKey=(event:KeyboardEvent)=>{
      if (isTextTarget(event.target)||event.ctrlKey||event.metaKey||event.altKey) return;
      if (event.key==='Escape'||event.key==='Delete'||event.key==='Backspace') {
        event.preventDefault();event.stopImmediatePropagation();cancel();
      }
    };
    window.addEventListener('keydown',onKey,true);
    return ()=>window.removeEventListener('keydown',onKey,true);
  },[active,cancel]);
  const result=active&&point!==null ? openingPreview(plan,point,kind,Number(width.replace(',','.')),session.retired):null;
  const apply=()=>{
    if (!ready||point===null) return;
    const checked=openingPreview(plan,point,kind,Number(width.replace(',','.')),session.retired);
    if (checked.opening===null||checked.message!==null) {setNotice(checked.message);return;}
    const applied=onCommand({type:'opening.put',opening:checked.opening});
    if(applied.ok) cancel();
  };
  const handlePointer=(event:WorldPointer)=>{
    if(!active)return;
    if(event.phase==='cancel'){cancel();return;}
    if(event.phase==='down'&&event.button===0){setPoint(event.point);setReady(true);setNotice(null);}
    else if(event.phase==='move'&&!ready)setPoint(event.point);
  };
  const changeKind=(next:OpeningKind)=>{setKind(next);setWidth(String(OPENING_DEFAULTS[next].width_m));};
  return {preview:result?.opening??null,message:result?.message??null,ready,valid:result?.opening!==null&&result!==null&&result.message===null,kind,width,setWidth,changeKind,apply,cancel,handlePointer};
}
