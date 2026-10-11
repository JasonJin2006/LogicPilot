import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { COLORS } from './model.mjs';
import { frameAt } from './simulation.mjs';
export function createScene(element,model,onSelect) {
  // Resolve the host theme's tokens once per scene so the viewport, floor, grid and
  // labels follow the active DSH theme instead of a private palette.
  const computed=getComputedStyle(element),read=(name,fallback)=>{const value=computed.getPropertyValue(name).trim();return /^#[0-9a-f]{8}$/i.test(value)?value.slice(0,7):(value||fallback);};
  const T={bg:read('--dsw-alias-bg-base','#151517'),floor:read('--dsw-alias-bg-layer-2','#2c2c2e'),grid:read('--dsw-static-neutral-bluish-700','#61666b'),gridSub:read('--dsw-alias-bg-layer-3','#353638'),text:read('--dsw-alias-label-secondary','#adb2b8'),link:read('--dsw-static-neutral-bluish-600','#81858c'),arrow:read('--dsw-static-neutral-bluish-500','#979da6'),entity:read('--dsw-static-amber-400','#f7ad31')};
  const renderer=new THREE.WebGLRenderer({antialias:true,alpha:false});renderer.setPixelRatio(Math.min(devicePixelRatio,2));
  renderer.setClearColor(T.bg);renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;element.append(renderer.domElement);
  const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(40,1,0.05,4000);
  const center=new THREE.Vector3(model.site.width/2,0,model.site.depth/2),span=Math.max(model.site.width,model.site.depth);
  camera.position.set(center.x+span*.6,span*.65,center.z+span*.7);camera.lookAt(center);
  const controls=new OrbitControls(camera,renderer.domElement);controls.target.copy(center);controls.enableDamping=true;controls.minDistance=2;controls.maxDistance=span*5;controls.maxPolarAngle=Math.PI*.49;
  scene.add(new THREE.HemisphereLight(0xd5e9ff,0x535354,2.4));const light=new THREE.DirectionalLight(0xfff3df,3);light.position.set(center.x-10,35,center.z+12);light.castShadow=true;light.shadow.mapSize.set(1024,1024);Object.assign(light.shadow.camera,{left:-span,right:span,top:span,bottom:-span,far:120});scene.add(light);
  const resources=[],pickables=[],groups=new Map();
  function box(parent,size,pos,color,opacity=1){const g=new THREE.BoxGeometry(...size),m=new THREE.MeshStandardMaterial({color,roughness:.65,metalness:.12,transparent:opacity<1,opacity});resources.push(g,m);const mesh=new THREE.Mesh(g,m);mesh.position.set(...pos);mesh.castShadow=true;mesh.receiveShadow=true;parent.add(mesh);return mesh;}
  const floor=box(scene,[model.site.width,.12,model.site.depth],[center.x,-.08,center.z],T.floor);floor.castShadow=false;
  // Grid lines are laid out to the exact site footprint (a square GridHelper overhangs a non-square site).
  function gridLines(step,color,thickness){
    const points=[],{width,depth}=model.site;
    for(let x=0;x<=width+.001;x+=step){const t=Math.min(x,width);points.push(new THREE.Vector3(t,0,0),new THREE.Vector3(t,0,depth));}
    for(let z=0;z<=depth+.001;z+=step){const t=Math.min(z,depth);points.push(new THREE.Vector3(0,0,t),new THREE.Vector3(width,0,t));}
    const geometry=new THREE.BufferGeometry().setFromPoints(points),material=new THREE.LineBasicMaterial({color:new THREE.Color(color),transparent:true,opacity:thickness});resources.push(geometry,material);
    const lines=new THREE.LineSegments(geometry,material);lines.position.y=.002;scene.add(lines);return lines;
  }
  gridLines(1,T.gridSub,.5);gridLines(5,T.grid,.85);
  function label(text,position,color=T.text){
    const c=document.createElement('canvas');c.width=512;c.height=100;const ctx=c.getContext('2d');ctx.font='500 32px sans-serif';ctx.textAlign='center';
    ctx.lineWidth=7;ctx.strokeStyle=T.bg;ctx.strokeText(text,256,55);ctx.fillStyle=color;ctx.fillText(text,256,55);
    const texture=new THREE.CanvasTexture(c),material=new THREE.SpriteMaterial({map:texture,depthTest:false,transparent:true}),sprite=new THREE.Sprite(material);sprite.scale.set(5,1,1);sprite.position.set(...position);scene.add(sprite);resources.push(texture,material);
  }
  label(`${model.site.width} m`,[center.x,.15,model.site.depth+1]);label(`${model.site.depth} m`,[-1,.15,center.z]);
  for(const n of model.nodes){
    const group=new THREE.Group();group.position.set(...n.position);group.rotation.y=-n.rotation*Math.PI/180;scene.add(group);groups.set(n.id,group);
    const [w,h,d]=n.size,color=COLORS[n.type];
    const body=box(group,[w,h,d],[0,h/2,0],color,n.type==='queue'?.38:.9);body.userData.nodeId=n.id;pickables.push(body);
    const edge=new THREE.LineSegments(new THREE.EdgesGeometry(body.geometry),new THREE.LineBasicMaterial({color:0xffffff,transparent:true,opacity:.3}));edge.position.copy(body.position);group.add(edge);resources.push(edge.geometry,edge.material);
    if(n.type==='service'){
      for(let i=0;i<n.servers;i++){const width=w/n.servers;box(group,[width*.7,.07,d*.65],[-w/2+width*(i+.5),h+.04,0],'#273543');box(group,[width*.25,h*.18,.06],[-w/2+width*(i+.5),h*.7,-d/2-.035],'#acd7ed');}
    }
    if(n.type==='source'||n.type==='sink') box(group,[w*.85,.08,d*.7],[0,h+.04,0],'#dbe3d7');
    label(n.label,[n.position[0],n.position[1]+h+.8,n.position[2]]);
  }
  const byId=new Map(model.nodes.map(n=>[n.id,n]));
  for(const link of model.links){const a=byId.get(link.from),b=byId.get(link.to);const points=[new THREE.Vector3(a.position[0],.12,a.position[2]),new THREE.Vector3(b.position[0],.12,b.position[2])];const line=new THREE.Line(new THREE.BufferGeometry().setFromPoints(points),new THREE.LineDashedMaterial({color:new THREE.Color(T.link),dashSize:.35,gapSize:.15}));line.computeLineDistances();scene.add(line);resources.push(line.geometry,line.material);
    const dir=points[1].clone().sub(points[0]);const arrow=new THREE.ArrowHelper(dir.clone().normalize(),points[0].clone().lerp(points[1],.65),Math.min(dir.length()*.15,1),new THREE.Color(T.arrow),.5,.25);scene.add(arrow);resources.push(arrow.line.geometry,arrow.line.material,arrow.cone.geometry,arrow.cone.material);
  }
  const entityGroup=new THREE.Group();scene.add(entityGroup);const entityGeometry=new THREE.BoxGeometry(.35,.35,.35),entityMaterial=new THREE.MeshStandardMaterial({color:T.entity});resources.push(entityGeometry,entityMaterial);
  const entityMeshes=[];let selected;
  function update(result,time,selection){
    if(selected!==selection){selected=selection;for(const [id,g] of groups){const body=g.children[0];body.material.emissive.set(id===selection?'#3d434c':'#000000');}}
    const active=frameAt(result,time),waiting=new Map();
    while(entityMeshes.length<active.length){const mesh=new THREE.Mesh(entityGeometry,entityMaterial);mesh.castShadow=true;entityGroup.add(mesh);entityMeshes.push(mesh);}
    entityMeshes.forEach((mesh,i)=>{
      mesh.visible=i<active.length;if(!mesh.visible)return;
      const s=active[i].segment;let p;
      if(s.kind==='move'){const a=byId.get(s.from),b=byId.get(s.to),t=(time-s.start)/(s.end-s.start);p=new THREE.Vector3().fromArray(a.position).lerp(new THREE.Vector3().fromArray(b.position),t);p.y+=.45;}
      else{const n=byId.get(s.node),idx=s.kind==='wait'?(waiting.get(n.id)??0):s.slot??0;waiting.set(n.id,idx+1);const cols=Math.max(1,Math.floor(n.size[0]/.5)),rows=Math.max(1,Math.floor(n.size[2]/.5));p=new THREE.Vector3(-n.size[0]/2+.25+(idx%cols)*.5,n.size[1]+.22+Math.floor(idx/(cols*rows))*.4,-n.size[2]/2+.25+(Math.floor(idx/cols)%rows)*.5);groups.get(n.id).localToWorld(p);}
      mesh.position.copy(p);
    });
  }
  const raycaster=new THREE.Raycaster();let down;
  const pointerDown=e=>{down=[e.clientX,e.clientY];};
  const click=e=>{if(!down||Math.hypot(e.clientX-down[0],e.clientY-down[1])>5)return;const r=renderer.domElement.getBoundingClientRect();raycaster.setFromCamera(new THREE.Vector2((e.clientX-r.left)/r.width*2-1,-(e.clientY-r.top)/r.height*2+1),camera);const hit=raycaster.intersectObjects(pickables)[0];if(hit)onSelect(hit.object.userData.nodeId);};
  renderer.domElement.addEventListener('pointerdown',pointerDown);renderer.domElement.addEventListener('pointerup',click);
  const resize=()=>{const w=element.clientWidth,h=element.clientHeight;if(w&&h){renderer.setSize(w,h);camera.aspect=w/h;camera.updateProjectionMatrix();}};
  const observer=new ResizeObserver(resize);observer.observe(element);resize();
  let animation;const loop=()=>{controls.update();renderer.render(scene,camera);animation=requestAnimationFrame(loop);};loop();
  return {update,reset(){camera.position.set(center.x+span*.6,span*.65,center.z+span*.7);controls.target.copy(center);},dispose(){cancelAnimationFrame(animation);observer.disconnect();controls.dispose();renderer.domElement.removeEventListener('pointerdown',pointerDown);renderer.domElement.removeEventListener('pointerup',click);for(const r of new Set(resources.flat()))r.dispose?.();renderer.dispose();renderer.domElement.remove();}};
}
