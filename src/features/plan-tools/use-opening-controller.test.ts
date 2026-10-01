// @vitest-environment jsdom
import {readFileSync} from 'node:fs';
import {act,cleanup,renderHook} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import type {PlanDocument} from '../../contracts/model';
import type {EditorSession} from '../../contracts/ui';
import {useOpeningController} from './use-opening-controller';
afterEach(cleanup);
it('клик готовит, Enter не применяет, отмена/смена контекста очищают; команда только после кнопки',()=>{
 const plan=JSON.parse(readFileSync('demo/after.json','utf8')) as PlanDocument;
 plan.objects=[];plan.openings=[];plan.walls=[{id:'w',from:[0,0],to:[6,0],thickness_m:0.2,height_m:3}];
 const session:EditorSession={tool:{kind:'opening.place'},viewport:{origin:[0,0],scale:50},selection:null,preview:null,focus:null,retired:new Set(['op_1'])};
 const onCommand=vi.fn(()=>({ok:true as const,value:plan}));
 const hook=renderHook(({active,epoch})=>useOpeningController({document:plan,session,onCommand},active,epoch),{initialProps:{active:true,epoch:0}});
 const click=()=>act(()=>hook.result.current.handlePointer({phase:'down',point:[3,0],button:0,alt:false,shift:false}));
 click();expect(hook.result.current.ready).toBe(true);expect(onCommand).not.toHaveBeenCalled();
 act(()=>window.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter'})));expect(onCommand).not.toHaveBeenCalled();
 act(()=>window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',cancelable:true})));expect(hook.result.current.preview).toBeNull();
 click();hook.rerender({active:false,epoch:0});expect(hook.result.current.preview).toBeNull();
 hook.rerender({active:true,epoch:1});click();act(()=>hook.result.current.apply());
 expect(onCommand).toHaveBeenCalledWith(expect.objectContaining({type:'opening.put',opening:expect.objectContaining({id:'op_2'})}));
 expect(hook.result.current.ready).toBe(false);
});
