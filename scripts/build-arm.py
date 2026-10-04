"""Reproducible Blender asset build. Run Blender --background --python scripts/build-arm.py.

Source vertices/topology are retained from the atlas. The weights below are a
per-part educational deformation rig, not a physiological muscle simulation.
"""
import bpy
import json
import math
import sys
from pathlib import Path
from mathutils import Vector, Quaternion

ROOT = Path(__file__).resolve().parents[1]
DATA = json.loads((ROOT / 'assets/right-arm-source.json').read_text())
OUT = ROOT / 'public/models'
OUT.mkdir(parents=True, exist_ok=True)
QA = ROOT / 'assets/qa'
QA.mkdir(parents=True, exist_ok=True)

def xyz(v):
    # Atlas meters/Y-up -> Blender meters/Z-up. glTF export reverses this.
    return Vector((v[0], -v[2], v[1]))

def smooth(a, b, x):
    t = min(1.0, max(0.0, (x-a)/(b-a)))
    return t*t*(3-2*t)

def forearm_weight(part, atlas_vertex):
    y = atlas_vertex[1]
    pid, name = part['id'], part['name'].lower()
    if part['system'] == 'skeletal':
        return 0.0 if any(k in name for k in ['humerus', 'clavicle', 'scapula']) else 1.0
    if pid in ['FJ1471', 'FJ1476']:
        return 1.0
    # Each crossing muscle has its own transition. Shared biceps heads retain
    # the same join region; fixed shoulder muscles receive no elbow influence.
    bands = {
        'FJ1478': (1.080, 1.335), 'FJ1512': (1.080, 1.335),
        'FJ1486': (1.085, 1.290),
        'FJ1477': (1.112, 1.320), 'FJ1479': (1.110, 1.325),
        'FJ1480': (1.108, 1.290),
        'FJ1487': (1.040, 1.205), 'FJ1485': (1.052, 1.135),
        'FJ1472': (1.060, 1.138), 'FJ1473': (1.055, 1.127),
        'FJ1474': (1.040, 1.144), 'FJ1475': (1.058, 1.133),
        'FJ1489': (1.065, 1.157), 'FJ1490': (1.055, 1.180),
        'FJ1491': (1.060, 1.128), 'FJ1492': (1.058, 1.140),
        'FJ1496': (1.055, 1.136), 'FJ1502': (1.055, 1.133),
        'FJ1505': (1.050, 1.135), 'FJ1518': (1.054, 1.123),
    }
    if pid in bands:
        lo, hi = bands[pid]
        return 1.0-smooth(lo, hi, y)
    if part['bounds'][0][1] > 1.20:
        return 0.0
    return 1.0

bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
scene = bpy.context.scene
scene.unit_settings.system = 'METRIC'
scene.unit_settings.scale_length = 1.0
arm_data = bpy.data.armatures.new('RightArmSkeleton')
arm = bpy.data.objects.new('RightArmRig', arm_data)
scene.collection.objects.link(arm)
bpy.context.view_layer.objects.active = arm
arm.select_set(True)
bpy.ops.object.mode_set(mode='EDIT')
shoulder, elbow, wrist = [xyz(DATA[k]) for k in ['shoulder', 'elbow', 'wrist']]
upper = arm_data.edit_bones.new('upper_arm_fixed')
upper.head, upper.tail = shoulder, elbow
fore = arm_data.edit_bones.new('elbow_flexion')
fore.head = elbow
axis = xyz(DATA['hingeAxis']).normalized()
long_axis = wrist-elbow
long_axis = (long_axis-axis*long_axis.dot(axis)).normalized()
fore.tail = elbow+long_axis*.23
fore.align_roll(axis.cross(long_axis).normalized())
fore.parent = upper
fore.use_connect = False
bpy.ops.object.mode_set(mode='OBJECT')
arm['sourceCommit'] = DATA['sourceCommit']
arm['deformationModel'] = 'Two-bone educational linear blend skinning; shoulder fixed'
arm['units'] = 'meters'
arm.show_in_front = True
bone = arm.pose.bones['elbow_flexion']
bone.rotation_mode = 'QUATERNION'

def material(name, color):
    mat = bpy.data.materials.new(name)
    mat.diffuse_color = (*color, 1)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get('Principled BSDF')
    bsdf.inputs['Base Color'].default_value = (*color, 1)
    bsdf.inputs['Roughness'].default_value = .62
    return mat

mats = {
    'skeletal': material('Atlas bone ivory', (.73, .66, .49)),
    'muscular': material('Atlas muscle terracotta', (.43, .135, .10)),
    'connective': material('Atlas connective ivory', (.72, .78, .72)),
}
objects=[]
manifest=[]
for part in DATA['parts']:
    pos=part['positions']
    vertices=[xyz(pos[i:i+3]) for i in range(0,len(pos),3)]
    faces=[part['indices'][i:i+3] for i in range(0,len(part['indices']),3)]
    mesh=bpy.data.meshes.new(part['id']+'_geometry')
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    for poly in mesh.polygons:
        poly.use_smooth=True
    normals=part['normals']
    try:
        mesh.normals_split_custom_set_from_vertices([xyz(normals[i:i+3]) for i in range(0,len(normals),3)])
    except (AttributeError, RuntimeError):
        pass
    obj=bpy.data.objects.new(part['id']+'_'+part['name'],mesh)
    scene.collection.objects.link(obj)
    obj.parent=arm
    obj['partId']=part['id']
    obj['anatomicalName']=part['name']
    obj['conceptId']=part['conceptId']
    obj['system']=part['system']
    obj['sourceSystem']=part['sourceSystem']
    obj['sourceCommit']=DATA['sourceCommit']
    obj['schematic']=False
    obj.data.materials.append(mats[part['system']])
    vg0=obj.vertex_groups.new(name='upper_arm_fixed')
    vg1=obj.vertex_groups.new(name='elbow_flexion')
    weights=[]
    for i in range(len(vertices)):
        w=forearm_weight(part,pos[i*3:i*3+3])
        if w<1: vg0.add([i],1-w,'REPLACE')
        if w>0: vg1.add([i],w,'REPLACE')
        weights.append(w)
    modifier=obj.modifiers.new('Educational elbow deformation','ARMATURE')
    modifier.object=arm
    modifier.use_deform_preserve_volume=False
    objects.append(obj)
    manifest.append({'id':part['id'],'name':part['name'],'system':part['system'],'vertices':len(vertices),'triangles':len(faces),'forearmWeightRange':[min(weights),max(weights)]})

def add_tendon(pid, label, points, radius, weight_part):
    # Supplemental attachment-path schematic; never replaces a source muscle.
    curve=bpy.data.curves.new(pid+'_path','CURVE')
    curve.dimensions='3D'
    curve.resolution_u=8
    curve.bevel_depth=radius
    curve.bevel_resolution=3
    spline=curve.splines.new('POLY')
    samples=[]
    for j in range(len(points)-1):
        for step in range(9):
            t=step/9
            samples.append([points[j][k]*(1-t)+points[j+1][k]*t for k in range(3)])
    samples.append(points[-1])
    spline.points.add(len(samples)-1)
    for dst,src in zip(spline.points,samples):dst.co=(*xyz(src),1)
    obj=bpy.data.objects.new(pid,curve)
    scene.collection.objects.link(obj)
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.context.view_layer.objects.active=obj
    bpy.ops.object.convert(target='MESH')
    obj=bpy.context.object
    obj.parent=arm
    obj['partId']=pid
    obj['system']='connective'
    obj['anatomicalName']=label
    obj['schematic']=True
    obj['source']='Authored educational attachment path; not a segmented BodyParts3D tendon'
    obj.data.materials.append(mats['connective'])
    vg0=obj.vertex_groups.new(name='upper_arm_fixed')
    vg1=obj.vertex_groups.new(name='elbow_flexion')
    for vertex in obj.data.vertices:
        w=forearm_weight(weight_part,(vertex.co.x,vertex.co.z,-vertex.co.y))
        if w<1:vg0.add([vertex.index],1-w,'REPLACE')
        if w>0:vg1.add([vertex.index],w,'REPLACE')
    mod=obj.modifiers.new('Attachment-path elbow deformation','ARMATURE')
    mod.object=arm
    for poly in obj.data.polygons:poly.use_smooth=True
    objects.append(obj)

parts_by_id={p['id']:p for p in DATA['parts']}
add_tendon('tendon-biceps-distal','Distal biceps tendon — schematic',
    [(-.212,1.158,-.007),(-.221,1.115,-.006),(-.227,1.079,-.015)], .0028, parts_by_id['FJ1478'])
add_tendon('tendon-triceps-distal','Distal triceps tendon — schematic',
    [(-.210,1.167,-.061),(-.209,1.140,-.059),(-.209,1.119,-.048)], .0038, parts_by_id['FJ1480'])

rig={
    'schemaVersion':1,'glbUrl':'/models/right-arm.glb',
    'replacedPartIds':[p['id'] for p in DATA['parts']],
    'elbowBoneName':'elbow_flexion','flexionAxis':'x','flexionSign':-1,
    'elbow':DATA['elbow'],'shoulder':DATA['shoulder'],'wrist':DATA['wrist'],
    'sourceCommit':DATA['sourceCommit'],
    'hingeWorldAxis':DATA['hingeAxis'],
    'rangeDegrees':[0,130],
    'rotationConvention':'Multiply the glTF rest quaternion by a local X axis quaternion using -flexionRadians.',
    'annotationAnchors':{
        'biceps':{'partId':'FJ1478','position':[-.192,1.265,.008]},
        'triceps':{'partId':'FJ1479','position':[-.198,1.268,-.073]},
        'brachialis':{'partId':'FJ1486','position':[-.218,1.196,-.022]},
        'tendon-biceps-distal':{'partId':'tendon-biceps-distal','position':[-.221,1.115,-.006]},
        'tendon-triceps-distal':{'partId':'tendon-triceps-distal','position':[-.209,1.140,-.059]},
    },
    'calibration':DATA['calibration'],
    'limitations':'Reference anatomy with authored visual skinning. No muscle activation, tendon load, collision, or physiological shortening is measured or simulated.',
    'parts':manifest,
}
(OUT/'rig.json').write_text(json.dumps(rig,ensure_ascii=False,indent=2),encoding='utf8')
bone.rotation_quaternion=Quaternion((1,0,0),0)
bpy.context.view_layer.update()
bpy.ops.object.select_all(action='DESELECT')
arm.select_set(True)
for obj in objects:obj.select_set(True)
bpy.context.view_layer.objects.active=arm
bpy.ops.export_scene.gltf(filepath=str(OUT/'right-arm.glb'),export_format='GLB',use_selection=True,export_apply=False,
    export_yup=True,export_skins=True,export_animations=False,export_extras=True,export_morph=False,export_materials='EXPORT')
print('ARM_ASSET_EXPORTED',str(OUT/'right-arm.glb'),flush=True)

# QA renders are also retained inside the editable .blend scene.
world=scene.world or bpy.data.worlds.new('Studio world')
scene.world=world
world.use_nodes=True
world.node_tree.nodes['Background'].inputs[0].default_value=(.045,.055,.065,1)
world.node_tree.nodes['Background'].inputs[1].default_value=.5
def aim(obj,target):obj.rotation_euler=(Vector(target)-obj.location).to_track_quat('-Z','Y').to_euler()
cam_data=bpy.data.cameras.new('QA Camera')
cam=bpy.data.objects.new('QA Camera',cam_data)
scene.collection.objects.link(cam)
cam.location=xyz((-1.15,1.22,.95))
aim(cam,xyz((-.18,1.105,.10)))
cam_data.type='ORTHO'
cam_data.ortho_scale=.94
scene.camera=cam
for name,location,power,size in [('Key',(-.8,1.8,1.0),25,1.0),('Fill',(.7,1.2,.7),12,.8),('Rim',(-.3,1.6,-.7),20,.6)]:
    ld=bpy.data.lights.new(name,'AREA')
    ld.energy=power
    ld.shape='DISK'
    ld.size=size
    lo=bpy.data.objects.new(name,ld)
    scene.collection.objects.link(lo)
    lo.location=xyz(location)
    aim(lo,xyz((-.21,1.15,.05)))
scene.render.engine='CYCLES'
scene.cycles.samples=24
scene.cycles.use_denoising=True
scene.render.resolution_x=1000
scene.render.resolution_y=1000
scene.render.resolution_percentage=100
scene.render.image_settings.file_format='PNG'
scene.view_settings.view_transform='AgX'
scene.render.film_transparent=False
for angle in [0,60,110]:
    bone.rotation_quaternion=Quaternion((1,0,0),-math.radians(angle))
    bpy.context.view_layer.update()
    scene.render.filepath=str(QA/f'right-arm-{angle:03d}.png')
    bpy.ops.render.render(write_still=True)
bone.rotation_quaternion=Quaternion((1,0,0),0)
bpy.context.view_layer.update()
bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'assets/right-arm.blend'))
print('ARM_BUILD_COMPLETE',json.dumps({'parts':len(manifest),'glbBytes':(OUT/'right-arm.glb').stat().st_size}),flush=True)
