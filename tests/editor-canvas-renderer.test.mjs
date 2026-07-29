import test from 'node:test';
import assert from 'node:assert/strict';
import { drawPerspectiveImage } from '../src/editor-renderer.js';
test('perspective renderer tessellates the image into clipped triangles',()=>{const calls=[],context={save(){calls.push('save')},restore(){calls.push('restore')},beginPath(){},moveTo(){},lineTo(){},closePath(){},clip(){},transform(...args){calls.push(['transform',...args])},drawImage(){calls.push('drawImage')}};drawPerspectiveImage(context,{width:100,height:60},100,60,.3,-.2,3);assert.equal(calls.filter(call=>call==='drawImage').length,18);assert.equal(calls.filter(call=>Array.isArray(call)&&call[0]==='transform').length,18)});
