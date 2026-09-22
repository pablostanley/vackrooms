import assert from "node:assert/strict";
import test from "node:test";
import {createHash} from "node:crypto";
import {EntityNavigation} from "../src/lib/game/entity-navigation";
import {generateChunk} from "../src/lib/game/maze";
import {buildSection} from "../src/lib/game/world";
import {headlessMaterials} from "./helpers/materials";
import {Stalker} from "../src/lib/game/stalker";
test("real tape preserves pursuing behavior while only the first identical failure searches", () => {
const mats=headlessMaterials(),nav=new EntityNavigation(),sections=[];
for(let z=-1;z<=1;z++)for(let x=-1;x<=1;x++){
  const d=generateChunk(x,z,48),s=buildSection(d,mats,0);sections.push(s);nav.addSection(`${x},${z}`,d,s.colliders);
}
const player={x:-2.4,y:1.66,z:60};
const input={view:{position:player,forward:{x:0,y:0,z:-1},up:{x:0,y:1,z:0},fov:68,aspect:16/9},playerSpeed:4,canGrab:false};
const stalker=new Stalker(48,nav);stalker.stage({x:2.4,z:55.2},player,true);
const original=nav.route.bind(nav),clear=nav.clearSegment.bind(nav);
let requests=0,segmentChecks=0,searches=0;
nav.clearSegment=(a,b)=>{segmentChecks++;return clear(a,b);};
nav.route=(a,b)=>{const before=segmentChecks;const path=original(a,b);if(segmentChecks>before)searches++;requests++;return path;};
const hash=createHash('sha256');let steps=0;
for(let i=0;i<900;i++){
  stalker.update(1/30,input,()=>steps++);
  hash.update(JSON.stringify([stalker.phase,stalker.position.toArray(),stalker.gait,stalker.heading,stalker.speed]));
}
assert.equal(requests,33);
assert.equal(searches,1);
assert.equal(steps,0);
// Captured from the same real tape simulation before failure caching.
assert.equal(hash.digest("hex"),"066a8605f2e5e816597f77edd7b4858a4c4b0ec413979d0f5675768786c08a66");
sections.forEach(s=>s.dispose());nav.clear();mats.dispose();

});
