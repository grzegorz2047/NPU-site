import test from 'node:test';
import assert from 'node:assert/strict';
import { combineSelection, createSelection, rectangleSelection } from '../src/editor-selection.js';
import { restrictAdjustmentToSelection } from '../src/editor-selection-render.js';

test('selection mask limits a correction and maps through the base-layer transform', () => {
  const created = [];
  const createCanvas = (width, height) => {
    const calls = []; let composite = 'source-over';
    const context = { calls, get globalCompositeOperation(){return composite}, set globalCompositeOperation(value){composite=value;calls.push(['composite',value])}, createImageData(w,h){const image={data:new Uint8ClampedArray(w*h*4)};calls.push(['createImageData',w,h,image]);return image}, putImageData(image){calls.push(['putImageData',image])}, setTransform(...values){calls.push(['setTransform',...values])}, drawImage(source,...values){calls.push(['drawImage',source.id??source,...values])} };
    const canvas = { id:`canvas-${created.length}`, width, height, context, getContext(){return context} }; created.push(canvas); return canvas;
  };
  const original={id:'original',width:10,height:10}, adjusted={id:'adjusted',width:10,height:10};
  const selection=combineSelection(createSelection({width:10,height:10}),rectangleSelection({x:3,y:4,width:2,height:2}));
  const output=restrictAdjustmentToSelection(original,adjusted,selection,{documentWidth:10,documentHeight:10,transform:{x:2,y:3},createCanvas});
  assert.notEqual(output,adjusted);
  const image=created[0].context.calls.find(call=>call[0]==='putImageData')[1]; assert.equal(image.data[(4*10+3)*4+3],255); assert.equal(image.data[3],0);
  assert.ok(created[1].context.calls.some(call=>call[0]==='setTransform'&&call[5]===-2&&call[6]===-3));
  assert.ok(created[2].context.calls.some(call=>call[0]==='composite'&&call[1]==='destination-in'));
  assert.deepEqual(output.context.calls.filter(call=>call[0]==='drawImage').map(call=>call[1]),['original',created[2].id]);
});

test('correction stays unchanged when there is no active selection',()=>{const adjusted={id:'adjusted',width:10,height:10};assert.equal(restrictAdjustmentToSelection({id:'original'},adjusted,null),adjusted)});
