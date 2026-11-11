import {test} from 'node:test';import assert from 'node:assert/strict';
import {constrainPet,petSize,zoomPet,restorePet,recoverPet} from '../desktop/pet-geometry.ts';
const area={x:0,y:0,width:1920,height:1080};
const visible=(p,length,start,size)=>Math.max(0,Math.min(p+length,start+size)-Math.max(p,start))/length;
test('75 percent off-screen is constrained independently on each axis, not by area',()=>{
  for(const screen of [area,{x:-1920,y:-1080,width:1920,height:1080}])for(const x of [-1e6,1e6])for(const y of [-1e6,1e6]){
    const b=constrainPet({x,y,width:400,height:600},screen),fx=visible(b.x,b.width,screen.x,screen.width),fy=visible(b.y,b.height,screen.y,screen.height);
    assert.equal(fx,.25);assert.equal(fy,.25);assert.equal(fx*fy,.0625);
  }
});
test('window width and height scale with the avatar and preserve the cursor anchor',()=>{
  const rect={x:600,y:300,width:400,height:600},anchor={x:.25,y:.4};
  for(const scale of [.1,.25,.5,1,2,4]){const size=petSize(scale,area);assert.equal(size.width,Math.round(400*scale));assert.equal(size.height,Math.round(600*scale));}
  const zoom=zoomPet(rect,2,area,anchor);assert.equal(zoom.width,800);assert.equal(zoom.height,1200);assert.equal(zoom.x+zoom.width*anchor.x,rect.x+rect.width*anchor.x);assert.equal(zoom.y+zoom.height*anchor.y,rect.y+rect.height*anchor.y);
});
test('small displays cap zoom only when a quarter of the window cannot fit',()=>{
  const screen={x:0,y:0,width:320,height:200},size=petSize(4,screen),rect=constrainPet({x:-10000,y:10000,...size},screen);
  assert.ok(size.height<=screen.height*4);assert.ok(visible(rect.x,rect.width,0,screen.width)>=.25);assert.ok(visible(rect.y,rect.height,0,screen.height)>=.25);
});
test('old fixed-window settings keep the visual center; new settings restore without drift',()=>{
  const legacy=restorePet({petX:100,petY:200,petWidth:400,petHeight:600,petScale:.5},area);assert.deepEqual(legacy,{x:200,y:350,width:200,height:300,scale:.5});
  assert.deepEqual(restorePet({petX:legacy.x,petY:legacy.y,petWidth:legacy.width,petHeight:legacy.height,petScale:.5},area),legacy);
  assert.deepEqual(restorePet({petX:100,petY:200,petWidth:200,petHeight:301,petScale:.5},area),{x:100,y:200,width:200,height:300,scale:.5});
});
test('recover places the whole avatar in the work area',()=>{
  const value=recoverPet({x:-300,y:-450,width:400,height:600},4,area);assert.ok(value.x>=area.x&&value.y>=area.y);assert.ok(value.x+value.width<=area.width&&value.y+value.height<=area.height);
});
