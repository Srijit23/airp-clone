import { ForestLayer } from '../forest/layer.js';
import { TreeShowcase } from '../trees/showcase.js';
import {PlaceLayer} from '../places/layer.js';
import {SouthSound} from '../environment/water.js';
import {buildingAt} from '../places/records.js';
import {promenadeHeight} from '../places/promenade.js';
import {
  ACESFilmicToneMapping,
  PCFSoftShadowMap,
  PerspectiveCamera,
  Scene,
  WebGLRenderer,
} from 'three';
import { RoadLayer } from '../roads/layer.js';
import { manifest } from '../data/assets.js';
import { presets, stations } from '../data/world.js';
import { AssetManager } from './assets.js';
import { terrainMaterial } from '../terrain/material.js';
import { Atmosphere } from '../environment/atmosphere.js';
import { WorldStreamer } from '../world/streamer.js';
import { InspectionCamera } from '../debug/camera.js';
import { InspectionPanel } from '../debug/panel.js';
import { CharacterController } from '../player/controller.js';

export class Engine {
  constructor(canvas, fail) {
    this.canvas = canvas;
    this.fail = fail;
    this.renderer = new WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: 'high-performance',
    });
    this.renderer.toneMapping = ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.04;
    this.renderer.shadowMap.type = PCFSoftShadowMap;
    this.scene = new Scene();
    this.camera = new PerspectiveCamera(58, 1, 0.38, 7100);
    this.atmosphere = new Atmosphere(this.scene);
    this.assets = new AssetManager(
      manifest,
      Math.min(4, this.renderer.capabilities.getMaxAnisotropy()),
    );
    this.resize = () => {
      this.sizeDirty = true;
    };
    this.contextLost = (e) => {
      e.preventDefault();
      fail(new Error('Graphics context lost. Reload to resume the survey.'));
    };
    canvas.addEventListener('webglcontextlost', this.contextLost);
    window.addEventListener('resize', this.resize);
    this.resize();
  }
  async start() {
    this.terrain = await terrainMaterial(this.assets);
    this.streamer = new WorldStreamer(
      this.scene,
      this.terrain.material,
      this.fail,
    );
    this.roads = await RoadLayer.create(this.scene, this.assets, this.fail);
    this.places=await PlaceLayer.create(this.scene,this.assets);
    this.showcase = new TreeShowcase(this.scene, this.assets, this.fail);
    this.forest = new ForestLayer(this.scene, this.assets, this.fail);
    this.water=new SouthSound(this.scene);
    this.player = new CharacterController(this.scene, this.assets, this.places, this.forest, this.streamer);
    await this.player.load();
    this.controls = new InspectionCamera(
      this.camera,
      this.canvas,
      this.streamer,
      () => this.ui?.refresh(),
    );
    this.player.connect(this.controls);
    this.controls.player = this.player;
    this.controls.obstacle=(x,z)=>buildingAt(x,z,.25);
    this.controls.streetSurface = (x, z, base) =>
      Math.max(this.roads.surfaceHeight(x,z,base),promenadeHeight(x,z)??-Infinity);
    this.quality('medium');
    this.controls.teleport(stations.find((s) => s.id === 'meridian'));
    this.controls.setMode('player');
    this.ui = new InspectionPanel(this);
    this.frames = 0;
    this.period = 0;
    this.last = 0;
    this.resPeriod = 0;
    this.waitForTerrain = true;
    this.renderer.setAnimationLoop((time) => this.frame(time));
  }
  quality(name) {
    this.presetName = name;
    this.preset = presets[name];
    this.maxDpr = Math.min(window.devicePixelRatio || 1, this.preset.dpr);
    this.nextDpr = this.maxDpr;
    this.atmosphere.configure(this.preset, this.renderer);
    if (this.terrain) this.terrain.material.needsUpdate = true;
    this.resPeriod = 0;
    this.resize();
  }
  travel(station) {
    this.controls.teleport(station);
    this.waitForTerrain = true;
    document.querySelector('#curtain').hidden = false;
    document.querySelector('#status').textContent = 'Loading AIRP…';
  }
  frame(time) {
    const elapsed = this.last ? (time - this.last) / 1000 : 1 / 60;
    this.last = time;
    try {
      if (!this.waitForTerrain) this.controls.update(Math.min(elapsed, 0.06));
      this.streamer.update(this.camera.position, this.preset);
      this.roads.update(this.camera.position, this.streamer);
      this.forest.update(this.camera, this.streamer, this.presetName, this.canvas.height, elapsed);
      this.places.update(this.camera.position,this.presetName,time/1000,this.forest);
      this.showcase.update(this.camera.position, this.streamer);
      this.water.update(this.camera.position,time/1000,this.preset);
      this.atmosphere.sky.visible=!this.water.underwater;
      this.scene.background=this.water.underwater?this.water.wet:null;
      if (
        this.waitForTerrain &&
        this.streamer.covered && this.forest.arrivalReady &&
        this.roads.nearReady && (!this.showcase.active || this.showcase.ready)
      ) {
        this.waitForTerrain = false;
        document.querySelector('#curtain').hidden = true;
        this.controls.update(0);
      }
      // Keep the previous view behind the loading screen until the destination has coverage.
      if (this.waitForTerrain) return;
      // Resizing clears the WebGL drawing buffer. Resize only immediately before its replacement frame.
      if (this.sizeDirty || this.nextDpr !== this.renderer.getPixelRatio()) {
        const w = this.canvas.clientWidth,
          h = this.canvas.clientHeight;
        this.renderer.setDrawingBufferSize(w, h, this.nextDpr);
        this.camera.aspect = w / h;
        this.camera.updateProjectionMatrix();
        this.sizeDirty = false;
      }
      this.atmosphere.follow(
        this.camera.position,
        this.streamer.loads + this.streamer.unloads + this.roads.revision+this.places.revision + this.showcase.revision + this.forest.revision,
      );
      if (this.player?.shadowDirty && time - (this.lastCharacterShadow || 0) > 120) {
        this.atmosphere.sun.shadow.needsUpdate = true;
        this.lastCharacterShadow = time;
      }
      this.renderer.render(this.scene, this.camera);
      this.frames++;
      this.period += elapsed;
      this.resPeriod += elapsed;
      if (this.period >= 0.25) {
        const fps = this.frames / this.period;
        this.ui.update(fps, 1000 / fps);
        if (this.resPeriod > 3 && this.streamer.settled) {
          const ratio = this.renderer.getPixelRatio();
          let target = ratio;
          if (fps < 42)
            target = Math.max(Math.min(0.65, this.maxDpr), ratio - 0.1);
          if (fps > 57) target = Math.min(this.maxDpr, ratio + 0.05);
          if (Math.abs(target - ratio) > 0.001) this.nextDpr = target;
          this.resPeriod = 0;
        }
        this.period = 0;
        this.frames = 0;
      }
    } catch (error) {
      this.fail(error);
    }
  }
  dispose() {
    this.renderer.setAnimationLoop(null);
    window.removeEventListener('resize', this.resize);
    this.canvas.removeEventListener('webglcontextlost', this.contextLost);
    this.ui?.dispose();
    this.controls?.dispose();
    this.player?.dispose();
    this.streamer?.dispose();
    this.roads?.dispose();
    this.showcase?.clear();
    this.forest?.dispose();
    this.places?.dispose();this.water?.dispose();
    this.atmosphere.dispose();
    this.terrain?.dispose();
    this.renderer.dispose();
  }
}
