import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const canvas = document.querySelector('#viewport');
const renderer = new THREE.WebGLRenderer({ canvas, antialias:true, preserveDrawingBuffer:true, alpha:true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xfffaf0);

const camera = new THREE.PerspectiveCamera(55, 1, 0.01, 1000);
camera.position.set(0, 1.6, 4);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.target.set(0, 1, 0);

const transform = new TransformControls(camera, renderer.domElement);
transform.setMode('translate');
transform.addEventListener('dragging-changed', e => controls.enabled = !e.value);
transform.addEventListener('objectChange', () => buildSkeletonLines());
scene.add(transform);

const hemi = new THREE.HemisphereLight(0xffffff, 0xff8758, 2.2);
scene.add(hemi);
const dir = new THREE.DirectionalLight(0xffffff, 1.4);
dir.position.set(3, 5, 4);
scene.add(dir);

const grid = new THREE.GridHelper(8, 16, 0xf4511f, 0xffc29b);
grid.material.opacity = 0.45;
grid.material.transparent = true;
scene.add(grid);

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();

let model = null;
let modelMeshes = [];
let selected = null;
let placingBone = false;
let activePanel = 'importPanel';
let currentFrame = 1;
let playing = false;
let lastPlay = 0;

const boneNames = [
  'Head','Neck','Chest','Hips',
  'Left Shoulder','Left Elbow','Left Hand',
  'Right Shoulder','Right Elbow','Right Hand',
  'Left Knee','Left Foot','Right Knee','Right Foot'
];

const bonePairs = [
  ['Head','Neck'], ['Neck','Chest'], ['Chest','Hips'],
  ['Chest','Left Shoulder'], ['Left Shoulder','Left Elbow'], ['Left Elbow','Left Hand'],
  ['Chest','Right Shoulder'], ['Right Shoulder','Right Elbow'], ['Right Elbow','Right Hand'],
  ['Hips','Left Knee'], ['Left Knee','Left Foot'],
  ['Hips','Right Knee'], ['Right Knee','Right Foot']
];

const bones = {};
const boneLines = new THREE.Group();
scene.add(boneLines);

const facePlanes = [];
const keyframes = [];

const presets = {
  'T-Pose': {
    'Left Shoulder': {x:0,y:0,z:90}, 'Right Shoulder': {x:0,y:0,z:-90}
  },
  'A-Pose': {
    'Left Shoulder': {x:0,y:0,z:45}, 'Right Shoulder': {x:0,y:0,z:-45}
  },
  'Idle': {
    'Head': {x:0,y:0,z:0}, 'Left Shoulder': {x:0,y:0,z:20}, 'Right Shoulder': {x:0,y:0,z:-20}
  },
  'Wave': {
    'Right Shoulder': {x:-40,y:0,z:-110}, 'Right Elbow': {x:-70,y:0,z:0}, 'Right Hand': {x:0,y:0,z:18}
  },
  'Punch': {
    'Right Shoulder': {x:-90,y:0,z:-10}, 'Right Elbow': {x:0,y:0,z:0}, 'Left Shoulder': {x:0,y:0,z:30}
  },
  'Naruto Run': {
    'Left Shoulder': {x:55,y:0,z:15}, 'Right Shoulder': {x:55,y:0,z:-15}, 'Head': {x:18,y:0,z:0}
  },
  'Praying': {
    'Left Shoulder': {x:-45,y:0,z:30}, 'Right Shoulder': {x:-45,y:0,z:-30},
    'Left Elbow': {x:-80,y:0,z:0}, 'Right Elbow': {x:-80,y:0,z:0}
  }
};

const $ = id => document.getElementById(id);
const statusText = $('statusText');
const selectedText = $('selectedText');

function setStatus(text){ statusText.textContent = text; }

function resize(){
  const rect = canvas.parentElement.getBoundingClientRect();
  renderer.setSize(rect.width, rect.height, false);
  camera.aspect = rect.width / Math.max(rect.height, 1);
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
setTimeout(resize, 50);

function fillSelects(){
  $('boneSelect').innerHTML = boneNames.map(n => `<option value="${n}">${n}</option>`).join('');
  $('poseSelect').innerHTML = Object.keys(presets).map(n => `<option value="${n}">${n}</option>`).join('');
}
fillSelects();

document.querySelectorAll('.tab').forEach(btn=>{
  btn.addEventListener('click', ()=>{
    document.querySelectorAll('.tab').forEach(b=>b.classList.remove('active'));
    document.querySelectorAll('.panel').forEach(p=>p.classList.remove('active'));
    btn.classList.add('active');
    activePanel = btn.dataset.panel;
    document.getElementById(activePanel).classList.add('active');
    placingBone = false;
    $('placeModeBtn').textContent = 'Place Bone: OFF';
    setTimeout(resize, 20);
  });
});

function setTool(mode){
  document.querySelectorAll('.tool').forEach(b=>b.classList.remove('active'));
  const id = mode === 'translate' ? 'moveToolBtn' : mode === 'rotate' ? 'rotateToolBtn' : mode === 'scale' ? 'scaleToolBtn' : 'selectToolBtn';
  $(id).classList.add('active');
  if(mode !== 'select') transform.setMode(mode);
}
$('selectToolBtn').addEventListener('click',()=>setTool('select'));
$('moveToolBtn').addEventListener('click',()=>setTool('translate'));
$('rotateToolBtn').addEventListener('click',()=>setTool('rotate'));
$('scaleToolBtn').addEventListener('click',()=>setTool('scale'));

function setSelected(obj){
  selected = obj;
  if(obj){
    transform.attach(obj);
    selectedText.textContent = 'Selected: ' + (obj.userData.name || obj.name || obj.type);
    syncRotationSliders();
  }else{
    transform.detach();
    selectedText.textContent = 'Selected: none';
  }
}

$('modelInput').addEventListener('change', e=>{
  const file = e.target.files[0];
  if(!file) return;
  const url = URL.createObjectURL(file);
  setStatus('Loading model...');
  new GLTFLoader().load(url, gltf=>{
    if(model) scene.remove(model);
    model = gltf.scene;
    model.name = file.name;
    modelMeshes = [];
    model.traverse(o=>{
      if(o.isMesh){
        modelMeshes.push(o);
        if(o.material){
          o.material.metalness = Math.min(o.material.metalness || 0, .2);
          o.material.needsUpdate = true;
        }
      }
    });
    scene.add(model);
    centerModel();
    setStatus(`Loaded ${file.name}`);
    URL.revokeObjectURL(url);
  }, undefined, err=>{
    console.error(err);
    setStatus('Could not load model. Try GLB.');
  });
});

function centerModel(){
  if(!model) return;
  const box = new THREE.Box3().setFromObject(model);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  model.position.sub(center);
  model.position.y += size.y / 2;
  const maxDim = Math.max(size.x,size.y,size.z);
  if(maxDim){
    const s = 2.2 / maxDim;
    model.scale.setScalar(s);
    $('modelScale').value = s.toFixed(2);
  }
  frameCamera();
}
$('centerModelBtn').addEventListener('click', centerModel);

function frameCamera(){
  controls.target.set(0,1,0);
  camera.position.set(0,1.55,4.2);
  controls.update();
}
$('frameModelBtn').addEventListener('click', frameCamera);

$('modelScale').addEventListener('input', e=>{ if(model) model.scale.setScalar(parseFloat(e.target.value)); });
$('modelY').addEventListener('input', e=>{ if(model) model.position.y = parseFloat(e.target.value); });
$('toggleGridBtn').addEventListener('click', ()=> grid.visible = !grid.visible);

$('clearSceneBtn').addEventListener('click', ()=>{
  if(model) scene.remove(model);
  model = null; modelMeshes = [];
  clearBones();
  facePlanes.forEach(p=>scene.remove(p));
  facePlanes.length = 0;
  keyframes.length = 0;
  updateLists();
  setSelected(null);
  setStatus('Scene cleared.');
});

function modelBounds(){
  if(!model) return null;
  const box = new THREE.Box3().setFromObject(model);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  return {box,size,center,min:box.min,max:box.max};
}

$('autoRigBtn').addEventListener('click', ()=>{
  const b = modelBounds();
  if(!b){ setStatus('Import a model first.'); return; }

  clearBones();

  const cx = b.center.x;
  const cy = b.min.y;
  const cz = b.center.z;
  const h = b.size.y;
  const w = Math.max(b.size.x, 0.6);
  const z = cz + b.size.z * 0.08;

  const pts = {
    'Head': [cx, cy+h*.92, z],
    'Neck': [cx, cy+h*.80, z],
    'Chest': [cx, cy+h*.66, z],
    'Hips': [cx, cy+h*.48, z],
    'Left Shoulder': [cx-w*.28, cy+h*.72, z],
    'Left Elbow': [cx-w*.46, cy+h*.56, z],
    'Left Hand': [cx-w*.55, cy+h*.40, z],
    'Right Shoulder': [cx+w*.28, cy+h*.72, z],
    'Right Elbow': [cx+w*.46, cy+h*.56, z],
    'Right Hand': [cx+w*.55, cy+h*.40, z],
    'Left Knee': [cx-w*.16, cy+h*.26, z],
    'Left Foot': [cx-w*.18, cy+h*.04, z+b.size.z*.12],
    'Right Knee': [cx+w*.16, cy+h*.26, z],
    'Right Foot': [cx+w*.18, cy+h*.04, z+b.size.z*.12]
  };

  Object.entries(pts).forEach(([name, arr])=>createOrMoveBone(name, new THREE.Vector3(...arr)));
  buildSkeletonLines();
  updateLists();
  setSelected(null);
  setStatus('Auto Rig created. Drag handles to fix placement.');
});

$('mirrorRigBtn').addEventListener('click', ()=>{
  const pairs = [
    ['Left Shoulder','Right Shoulder'],['Left Elbow','Right Elbow'],['Left Hand','Right Hand'],
    ['Left Knee','Right Knee'],['Left Foot','Right Foot']
  ];
  pairs.forEach(([l,r])=>{
    if(bones[l] && bones[r]){
      const lp = bones[l].position.clone();
      bones[r].position.set(-lp.x, lp.y, lp.z);
    }
  });
  buildSkeletonLines();
});

$('placeModeBtn').addEventListener('click', ()=>{
  placingBone = !placingBone;
  $('placeModeBtn').textContent = `Place Bone: ${placingBone ? 'ON' : 'OFF'}`;
});
$('autoSkeletonBtn').addEventListener('click', buildSkeletonLines);
$('clearBonesBtn').addEventListener('click', clearBones);

canvas.addEventListener('pointerdown', event=>{
  const rect = canvas.getBoundingClientRect();
  pointer.x = ((event.clientX - rect.left)/rect.width)*2-1;
  pointer.y = -((event.clientY - rect.top)/rect.height)*2+1;
  raycaster.setFromCamera(pointer,camera);

  if(activePanel === 'rigPanel' && placingBone && modelMeshes.length){
    const hits = raycaster.intersectObjects(modelMeshes,true);
    if(hits.length){
      createOrMoveBone($('boneSelect').value, hits[0].point);
      buildSkeletonLines();
      updateLists();
      setStatus(`Placed ${$('boneSelect').value}`);
      return;
    }
  }

  const pickables = [...Object.values(bones), ...facePlanes];
  const hits = raycaster.intersectObjects(pickables,false);
  if(hits.length) setSelected(hits[0].object);
});

function createOrMoveBone(name,pos){
  let bone = bones[name];
  if(!bone){
    const geo = new THREE.SphereGeometry(0.055,32,18);
    const mat = new THREE.MeshStandardMaterial({
      color:0xf4511f,
      emissive:0xff8758,
      emissiveIntensity:.3,
      roughness:.35
    });
    bone = new THREE.Mesh(geo,mat);
    bone.userData = {type:'bone',name,rot:{x:0,y:0,z:0}};
    bones[name] = bone;
    scene.add(bone);
  }
  bone.position.copy(pos);
  setSelected(bone);
}

function clearBones(){
  Object.values(bones).forEach(b=>scene.remove(b));
  for(const k of Object.keys(bones)) delete bones[k];
  boneLines.clear();
  setSelected(null);
  updateLists();
}

function buildSkeletonLines(){
  boneLines.clear();
  bonePairs.forEach(([a,b])=>{
    if(!bones[a] || !bones[b]) return;
    const geo = new THREE.BufferGeometry().setFromPoints([bones[a].position,bones[b].position]);
    const mat = new THREE.LineBasicMaterial({color:0xf4511f, linewidth:3});
    boneLines.add(new THREE.Line(geo,mat));
  });
}

function updateLists(){
  $('boneList').innerHTML = Object.keys(bones).map(n=>`<button data-bone="${n}">${n}</button>`).join('') || 'No bones yet.';
  $('boneList').querySelectorAll('button').forEach(btn=>btn.addEventListener('click',()=>setSelected(bones[btn.dataset.bone])));

  $('keyframeList').innerHTML = keyframes.map((k,i)=>`<button data-k="${i}">Frame ${k.frame} · ${Object.keys(k.bones).length} bones</button>`).join('') || 'No keyframes yet.';
  $('keyframeList').querySelectorAll('button').forEach(btn=>applyKeyframe(keyframes[Number(btn.dataset.k)]));
}

$('applyPoseBtn').addEventListener('click', ()=>{
  const pose = presets[$('poseSelect').value];
  Object.entries(pose).forEach(([name,rot])=>{
    if(!bones[name]) return;
    bones[name].rotation.set(
      THREE.MathUtils.degToRad(rot.x||0),
      THREE.MathUtils.degToRad(rot.y||0),
      THREE.MathUtils.degToRad(rot.z||0)
    );
    bones[name].userData.rot = rot;
  });
  syncRotationSliders();
  setStatus(`Applied ${$('poseSelect').value}`);
});

function syncRotationSliders(){
  if(!selected) return;
  $('rotX').value = Math.round(THREE.MathUtils.radToDeg(selected.rotation.x));
  $('rotY').value = Math.round(THREE.MathUtils.radToDeg(selected.rotation.y));
  $('rotZ').value = Math.round(THREE.MathUtils.radToDeg(selected.rotation.z));
}

['rotX','rotY','rotZ'].forEach(id=>{
  $(id).addEventListener('input', ()=>{
    if(!selected) return;
    selected.rotation.set(
      THREE.MathUtils.degToRad(+$('rotX').value),
      THREE.MathUtils.degToRad(+$('rotY').value),
      THREE.MathUtils.degToRad(+$('rotZ').value)
    );
  });
});

$('resetSelectedBoneBtn').addEventListener('click', ()=>{
  if(!selected) return;
  selected.rotation.set(0,0,0);
  syncRotationSliders();
});
$('savePoseBtn').addEventListener('click', ()=>{
  const name = prompt('Pose name?');
  if(!name) return;
  presets[name] = snapshotBones().rotations;
  fillSelects();
  $('poseSelect').value = name;
});

$('faceInput').addEventListener('change', e=>{
  const file = e.target.files[0];
  if(!file) return;
  const url = URL.createObjectURL(file);
  const tex = new THREE.TextureLoader().load(url,()=>URL.revokeObjectURL(url));
  tex.colorSpace = THREE.SRGBColorSpace;
  const size = +$('faceSize').value;
  const mat = new THREE.MeshBasicMaterial({map:tex,transparent:true,side:THREE.DoubleSide});
  const plane = new THREE.Mesh(new THREE.PlaneGeometry(size,size),mat);
  plane.userData = {type:'face',name:file.name,attachedTo:'Head'};
  if(bones.Head) plane.position.copy(bones.Head.position).add(new THREE.Vector3(0,0,.08));
  else plane.position.set(0,1.4,.08);
  scene.add(plane);
  facePlanes.push(plane);
  setSelected(plane);
});
$('attachFaceToHeadBtn').addEventListener('click', ()=>{
  if(selected && selected.userData.type === 'face') selected.userData.attachedTo = 'Head';
});
$('detachFaceBtn').addEventListener('click', ()=>{
  if(selected && selected.userData.type === 'face') selected.userData.attachedTo = null;
});
$('deleteSelectedBtn').addEventListener('click', ()=>{
  if(!selected) return;
  if(selected.userData.type === 'face'){
    facePlanes.splice(facePlanes.indexOf(selected),1);
    scene.remove(selected);
    setSelected(null);
  }
});

$('frameSlider').addEventListener('input', e=>setFrame(+e.target.value));
$('prevFrameBtn').addEventListener('click',()=>setFrame(Math.max(1,currentFrame-1)));
$('nextFrameBtn').addEventListener('click',()=>setFrame(Math.min(120,currentFrame+1)));
function setFrame(n){
  currentFrame=n;
  $('frameSlider').value=n;
  $('frameNumber').textContent=n;
}
$('addKeyframeBtn').addEventListener('click', ()=>{
  const data = {frame:currentFrame,bones:snapshotBones().full,faces:snapshotFaces()};
  const existing = keyframes.findIndex(k=>k.frame===currentFrame);
  if(existing>=0) keyframes[existing]=data;
  else keyframes.push(data);
  keyframes.sort((a,b)=>a.frame-b.frame);
  updateLists();
});
$('playBtn').addEventListener('click',()=>playing=true);
$('stopBtn').addEventListener('click',()=>playing=false);

function applyKeyframe(k){
  if(!k) return;
  setFrame(k.frame);
  Object.entries(k.bones).forEach(([name,d])=>{
    if(bones[name]){
      bones[name].position.fromArray(d.position);
      bones[name].rotation.fromArray(d.rotation);
    }
  });
  buildSkeletonLines();
}

function snapshotBones(){
  const full = {}, rotations = {};
  Object.entries(bones).forEach(([name,b])=>{
    full[name] = {position:b.position.toArray(),rotation:[b.rotation.x,b.rotation.y,b.rotation.z]};
    rotations[name] = {
      x:Math.round(THREE.MathUtils.radToDeg(b.rotation.x)),
      y:Math.round(THREE.MathUtils.radToDeg(b.rotation.y)),
      z:Math.round(THREE.MathUtils.radToDeg(b.rotation.z))
    };
  });
  return {full,rotations};
}
function snapshotFaces(){
  return facePlanes.map(p=>({
    name:p.userData.name,
    position:p.position.toArray(),
    rotation:[p.rotation.x,p.rotation.y,p.rotation.z],
    scale:p.scale.toArray(),
    attachedTo:p.userData.attachedTo || null
  }));
}
function exportProject(){
  return {
    app:'CLOUD RIG ORANGE',
    version:1,
    modelName:model?.name || null,
    bones:snapshotBones().full,
    poses:presets,
    faces:snapshotFaces(),
    keyframes
  };
}
function download(filename, content, type='application/json'){
  const blob = new Blob([content],{type});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href=url; a.download=filename; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),500);
}
function exportProjectFile(){
  download('cloud-rig-orange-project.json', JSON.stringify(exportProject(),null,2));
}
$('exportProjectBtn').addEventListener('click',exportProjectFile);
$('saveProjectBtn').addEventListener('click',()=>{
  localStorage.setItem('cloudRigOrangeProject',JSON.stringify(exportProject()));
  setStatus('Saved in browser.');
});
$('loadProjectBtn').addEventListener('click',()=>$('projectFileInput').click());
$('projectFileInput').addEventListener('change', e=>{
  const file = e.target.files[0];
  if(!file) return;
  const reader = new FileReader();
  reader.onload = ()=>{
    try{ loadProject(JSON.parse(reader.result)); }
    catch{ setStatus('Invalid JSON.'); }
  };
  reader.readAsText(file);
});
function loadProject(data){
  clearBones();
  Object.entries(data.bones||{}).forEach(([name,d])=>{
    createOrMoveBone(name,new THREE.Vector3().fromArray(d.position));
    bones[name].rotation.fromArray(d.rotation||[0,0,0]);
  });
  Object.assign(presets,data.poses||{});
  keyframes.length=0;
  keyframes.push(...(data.keyframes||[]));
  fillSelects();
  buildSkeletonLines();
  updateLists();
  setSelected(null);
  setStatus('Project loaded. Re-import model if needed.');
}
$('downloadPngBtn').addEventListener('click',()=>{
  renderer.render(scene,camera);
  canvas.toBlob(blob=>{
    const url=URL.createObjectURL(blob);
    const a=document.createElement('a');
    a.href=url; a.download='cloud-rig-orange-screenshot.png'; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(()=>URL.revokeObjectURL(url),500);
  },'image/png');
});

function tick(t){
  requestAnimationFrame(tick);
  if(playing && t-lastPlay > 1000/24){
    lastPlay=t;
    setFrame(currentFrame>=120?1:currentFrame+1);
    const exact=keyframes.find(k=>k.frame===currentFrame);
    if(exact) applyKeyframe(exact);
  }
  facePlanes.forEach(p=>{
    if(p.userData.attachedTo==='Head' && bones.Head && selected!==p){
      p.position.copy(bones.Head.position).add(new THREE.Vector3(0,0,.08));
    }
  });
  controls.update();
  renderer.render(scene,camera);
}
tick();
updateLists();
