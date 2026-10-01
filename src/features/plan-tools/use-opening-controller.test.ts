// @vitest-environment jsdom
import {readFileSync} from 'node:fs';
import {act,cleanup,renderHook} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import type {PlanDocument} from '../../contracts/model';
import type {EditorSession} from '../../contracts/ui';
import {useOpeningController} from './use-opening-controller';
afterEach(cleanup);
function setup() {
 const plan=JSON.parse(readFileSync('demo/after.json','utf8')) as PlanDocument;
 plan.objects=[];plan.openings=[];plan.walls=[{id:'chosen',from:[0,0],to:[6,0],thickness_m:0.1,height_m:3}];
 const session:EditorSession={tool:{kind:'opening.place'},viewport:{origin:[0,0],scale:50},selection:null,preview:null,focus:null,retired:new Set()};
 const onCommand=vi.fn(()=>({ok:true as const,value:plan}));
 const hook=renderHook(({document})=>useOpeningController({document,session,onCommand},true,0),{initialProps:{document:plan}});
 const click=(point:[number,number])=>act(()=>hook.result.current.handlePointer({phase:'down',point,button:0,alt:false,shift:false}));
 return {plan,hook,click,onCommand};
}
it('готовый проём остаётся на выбранной стене при появлении более близкой стены',()=>{
 const {plan,hook,click,onCommand}=setup();
 click([3,0.3]);
 expect(hook.result.current.preview?.wallId).toBe('chosen');
 const document={...plan,walls:[...plan.walls,{...plan.walls[0]!,id:'nearby',from:[0,0.4] as [number,number],to:[6,0.4] as [number,number]}]};
 hook.rerender({document});
 expect(hook.result.current.preview?.wallId).toBe('chosen');
 act(()=>hook.result.current.apply());
 expect(onCommand).toHaveBeenCalledWith(expect.objectContaining({opening:expect.objectContaining({wallId:'chosen'})}));
});
it('исчезновение выбранной стены не переносит подготовленный проём на соседнюю',()=>{
 const {plan,hook,click,onCommand}=setup();click([3,0]);
 hook.rerender({document:{...plan,walls:[{...plan.walls[0]!,id:'neighbor',from:[0,0.4],to:[6,0.4]}]}});
 expect(hook.result.current.valid).toBe(false);
 expect(hook.result.current.message).toContain('Выбранная стена');
 act(()=>hook.result.current.apply());expect(onCommand).not.toHaveBeenCalled();
 click([3,0.4]);expect(hook.result.current.valid).toBe(true);
 act(()=>hook.result.current.apply());expect(onCommand).toHaveBeenCalledWith(expect.objectContaining({opening:expect.objectContaining({wallId:'neighbor'})}));
});
it('Escape отменяет черновик из поля ширины, Backspace остаётся вводом текста',()=>{
 const {hook,click,onCommand}=setup();click([3,0]);
 const panel=document.createElement('section');panel.setAttribute('data-opening-controls','');
 const input=document.createElement('input');panel.append(input);document.body.append(panel);
 act(()=>input.dispatchEvent(new KeyboardEvent('keydown',{key:'Backspace',bubbles:true,cancelable:true})));
 expect(hook.result.current.ready).toBe(true);
 act(()=>input.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true})));
 expect(hook.result.current.ready).toBe(false);expect(hook.result.current.preview).toBeNull();
 expect(onCommand).not.toHaveBeenCalled();panel.remove();
});
it('Escape другого поля доходит до его обработчика и не отменяет проём',()=>{
 const {hook,click}=setup();click([3,0]);
 const input=document.createElement('input');document.body.append(input);
 const onEscape=vi.fn();input.addEventListener('keydown',onEscape);
 act(()=>input.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true})));
 expect(onEscape).toHaveBeenCalledOnce();expect(hook.result.current.ready).toBe(true);input.remove();
});
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
