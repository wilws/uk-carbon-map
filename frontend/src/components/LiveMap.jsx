import React from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import * as topojson from 'topojson-client';
import polygonClipping from 'polygon-clipping';

export default class LiveMap extends React.Component {
  state = { ready: false, regions: [], hovered: null, selected: null, error: null, menuOpen: false, chartOpen: false, chartFuel: 'all', isMobile: false };

  constructor(props) {
    super(props);
    this.mountRef = React.createRef();
    this.wheelRef = React.createRef();
    this.padRef = React.createRef();
    this.meshById = {};
    this.lineById = {};
    this._raf = null;
  }

  componentDidUpdate() {
    if (this.state.ready) this.updateWheel();
  }

  lockCenter(id) {
    this._initLock = true;
    clearTimeout(this._unlock);
    this._unlock = setTimeout(() => { this._initLock = false; }, 1900);
    [40, 240, 520, 900, 1400, 1850].forEach(t => setTimeout(() => { this.centerOn(id, false); this.updateWheel(); }, t));
  }

  updateWheel() {
    const w = this.wheelRef.current;
    if (!w) return;
    const items = w.querySelectorAll('[data-wheel-item]');
    if (!items.length) return;
    const cy = w.getBoundingClientRect().top + w.clientHeight / 2;
    const half = w.clientHeight / 2;
    items.forEach(el => {
      const r = el.getBoundingClientRect();
      let n = ((r.top + r.height / 2) - cy) / half;
      n = Math.max(-1, Math.min(1, n));
      const an = Math.abs(n);
      const rx = n * 58;
      const sc = 1 - an * 0.30;
      const op = Math.max(0.05, 1 - an * 1.05);
      el.style.transform = 'rotateX(' + (-rx).toFixed(1) + 'deg) scale(' + sc.toFixed(3) + ')';
      el.style.opacity = op.toFixed(2);
      const name = el.querySelector('[data-wheel-name]');
      if (name) name.style.fontSize = (20.5 - an * 8).toFixed(1) + 'px';
    });
  }

  onWheelScroll() {
    if (!this._wraf) this._wraf = requestAnimationFrame(() => { this._wraf = null; this.updateWheel(); });
    clearTimeout(this._wsettle);
    this._wsettle = setTimeout(() => this.wheelSettle(), 150);
  }

  wheelSettle() {
    const w = this.wheelRef.current;
    if (!w || this._programmatic || this._initLock) return;
    const cy = w.getBoundingClientRect().top + w.clientHeight / 2;
    let best = null, bd = 1e9;
    w.querySelectorAll('[data-wheel-item]').forEach(el => {
      const r = el.getBoundingClientRect();
      const d = Math.abs((r.top + r.height / 2) - cy);
      if (d < bd) { bd = d; best = el; }
    });
    if (best) {
      const id = best.getAttribute('data-id');
      if (id && id !== this.state.selected) { this._wheelDriven = true; this.select(id); }
    }
  }

  centerOn(id, smooth) {
    const w = this.wheelRef.current;
    if (!w || !id) return;
    const el = w.querySelector('[data-id="' + id + '"]');
    if (!el) return;
    const target = el.offsetTop + el.offsetHeight / 2 - w.clientHeight / 2;
    if (smooth) { this.animateScroll(target); return; }
    this._programmatic = true;
    clearTimeout(this._progClear);
    this._progClear = setTimeout(() => { this._programmatic = false; }, 200);
    w.scrollTo({ top: target, behavior: 'auto' });
  }

  animateScroll(target) {
    const w = this.wheelRef.current;
    if (!w) return;
    cancelAnimationFrame(this._scrollRaf);
    const start = w.scrollTop, dist = target - start;
    if (Math.abs(dist) < 1) return;
    const dur = Math.max(340, Math.min(780, 280 + Math.abs(dist) * 0.55));
    const t0 = performance.now();
    const ease = (t) => 1 - Math.pow(1 - t, 3);
    this._programmatic = true;
    clearTimeout(this._progClear);
    const step = (now) => {
      const p = Math.min(1, (now - t0) / dur);
      w.scrollTop = start + dist * ease(p);
      this.updateWheel();
      if (p < 1) { this._scrollRaf = requestAnimationFrame(step); }
      else { this._progClear = setTimeout(() => { this._programmatic = false; }, 60); }
    };
    this._scrollRaf = requestAnimationFrame(step);
  }

  componentDidMount() {
    this._disposed = false;
    if ('scrollRestoration' in history) { try { history.scrollRestoration = 'manual'; } catch (e) {} }
    this._mq = window.matchMedia('(max-width: 700px)');
    this.setState({ isMobile: this._mq.matches });
    this._mqListener = (e) => this.setState({ isMobile: e.matches });
    if (this._mq.addEventListener) this._mq.addEventListener('change', this._mqListener); else this._mq.addListener(this._mqListener);
    this.init().catch(() => {
      this.setState({ error: 'Could not initialise the map.' });
    });
  }

  componentWillUnmount() {
    this._disposed = true;
    if (this._raf) cancelAnimationFrame(this._raf);
    if (this._ro) this._ro.disconnect();
    if (this.renderer) {
      this.renderer.dispose();
      const el = this.renderer.domElement;
      if (el && el.parentNode) el.parentNode.removeChild(el);
    }
  }

  // ----- region definitions -----
  regionMeta() {
    return [
      { id: 'n_scot', num: 1,  name: 'North Scotland' },
      { id: 's_scot', num: 2,  name: 'South Scotland' },
      { id: 'nw_eng', num: 3,  name: 'North West England' },
      { id: 'ne_eng', num: 4,  name: 'North East England' },
      { id: 'yorks',  num: 5,  name: 'Yorkshire' },
      { id: 'nwm',    num: 6,  name: 'North Wales & Merseyside' },
      { id: 's_wales',num: 7,  name: 'South Wales' },
      { id: 'w_mids', num: 8,  name: 'West Midlands' },
      { id: 'e_mids', num: 9,  name: 'East Midlands' },
      { id: 'e_eng',  num: 10, name: 'East England' },
      { id: 'sw_eng', num: 11, name: 'South West England' },
      { id: 's_eng',  num: 12, name: 'South England' },
      { id: 'london', num: 13, name: 'London' },
      { id: 'se_eng', num: 14, name: 'South East England' },
      { id: 'n_ireland', num: 15, name: 'Northern Ireland' }
    ];
  }

  static FUEL_ORDER = ['biomass', 'coal', 'imports', 'gas', 'nuclear', 'other', 'hydro', 'solar', 'wind'];
  static FUEL_COLOR = { biomass: '#8a9b5a', coal: '#454545', imports: '#9b6dc4', gas: '#dd8b3f', nuclear: '#d6b73f', other: '#8a8f96', hydro: '#3f9fd9', solar: '#f2c14e', wind: '#46b39a' };
  static FUEL_LABEL = { biomass: 'Biomass', coal: 'Coal', imports: 'Imports', gas: 'Gas', nuclear: 'Nuclear', other: 'Other', hydro: 'Hydro', solar: 'Solar', wind: 'Wind' };
  static BAND_COLOR = { 'very low': '#2bb673', 'low': '#5bbf6e', 'moderate': '#eab308', 'high': '#f0883e', 'very high': '#e5484d' };
  static CARBON = { biomass: 120, coal: 937, imports: 300, gas: 394, nuclear: 0, other: 600, hydro: 0, solar: 0, wind: 0 };

  static band(f) { return f < 45 ? 'very low' : f < 130 ? 'low' : f < 200 ? 'moderate' : f < 280 ? 'high' : 'very high'; }

  buildRegionData(meta) {
    const FO = LiveMap.FUEL_ORDER, CARBON = LiveMap.CARBON;
    const base = { biomass: 4, coal: 0.3, imports: 8, gas: 34, nuclear: 14, other: 0.4, hydro: 1.5, solar: 6, wind: 18 };
    const rngFor = (seed) => { let t = seed >>> 0; return () => { t += 0x6D2B79F5; let x = Math.imul(t ^ (t >>> 15), 1 | t); x ^= x + Math.imul(x ^ (x >>> 7), 61 | x); return ((x ^ (x >>> 14)) >>> 0) / 4294967296; }; };
    const data = {};
    for (const m of meta) {
      if (m.id === 'london') {
        data[m.id] = {
          region_id: 13, shortname: 'London', from: '2026-06-19T09:00Z', to: '2026-06-19T09:30Z',
          intensity: { forecast: 142, index: 'moderate' },
          generationmix: [
            { fuel: 'biomass', perc: 4.2 }, { fuel: 'coal', perc: 0 }, { fuel: 'imports', perc: 11.3 },
            { fuel: 'gas', perc: 38.5 }, { fuel: 'nuclear', perc: 15.1 }, { fuel: 'other', perc: 0 },
            { fuel: 'hydro', perc: 1.2 }, { fuel: 'solar', perc: 9.4 }, { fuel: 'wind', perc: 20.3 }
          ]
        };
        continue;
      }
      const rng = rngFor(Math.imul(m.num, 2654435761));
      const raw = {}; let sum = 0;
      for (const f of FO) {
        let v = base[f] * (0.45 + rng() * 1.7);
        if (f === 'coal') v = rng() < 0.7 ? 0 : v * 0.5;
        if (f === 'other') v = rng() < 0.6 ? 0 : v;
        raw[f] = v; sum += v;
      }
      const mix = FO.map(f => ({ fuel: f, perc: Math.round(raw[f] / sum * 1000) / 10 }));
      const s2 = mix.reduce((a, b) => a + b.perc, 0);
      const gas = mix.find(x => x.fuel === 'gas'); gas.perc = Math.round((gas.perc + (100 - s2)) * 10) / 10;
      let forecast = 0; for (const it of mix) forecast += it.perc / 100 * CARBON[it.fuel];
      forecast = Math.round(forecast);
      data[m.id] = {
        region_id: m.num, shortname: m.name, from: '2026-06-19T09:00Z', to: '2026-06-19T09:30Z',
        intensity: { forecast, index: LiveMap.band(forecast) }, generationmix: mix
      };
    }
    return data;
  }

  // Map the live socket data ({ region_id → snapshot }) onto the design's
  // regions, keyed by the design id (e.g. 'london') via each region's `num`.
  liveRegionData() {
    const byNum = this.props.regions || {};
    const data = {};
    for (const m of this.regionMeta()) {
      if (byNum[m.num]) data[m.id] = byNum[m.num];
    }
    return data;
  }

  // ----- geometry helpers -----
  static norm(s) { return (s || '').toLowerCase().replace(/[^a-z]/g, ''); }

  polysOf(geom) {
    if (!geom) return [];
    return geom.type === 'Polygon' ? [geom.coordinates] : geom.coordinates;
  }

  largestRing(geom) {
    let best = null, bestA = -1;
    for (const poly of this.polysOf(geom)) {
      const ring = poly[0]; let a = 0;
      for (let i = 0; i < ring.length - 1; i++) a += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
      a = Math.abs(a);
      if (a > bestA) { bestA = a; best = ring; }
    }
    return best;
  }

  centroidOf(geom) {
    const ring = this.largestRing(geom);
    let x = 0, y = 0;
    for (const p of ring) { x += p[0]; y += p[1]; }
    return [x / ring.length, y / ring.length];
  }

  pip(pt, geom) {
    let inside = false;
    for (const poly of this.polysOf(geom)) {
      const ring = poly[0];
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
        if (((yi > pt[1]) !== (yj > pt[1])) && (pt[0] < (xj - xi) * (pt[1] - yi) / (yj - yi) + xi)) inside = !inside;
      }
    }
    return inside;
  }

  async init() {
    const N = LiveMap.norm;
    const URL = 'https://cdn.jsdelivr.net/gh/ONSdigital/uk-topojson@main/output/topo.json';
    let topo;
    try {
      topo = await (await fetch(URL)).json();
    } catch (e) {
      this.setState({ error: 'Could not download UK boundary data.' });
      return;
    }
    if (this._disposed) return; // StrictMode/unmount guard — don't build a zombie scene

    const feat = (key) => topojson.feature(topo, topo.objects[key]).features.filter(f => !f.properties.end);
    const ltla = feat('ltla');
    const rgn  = feat('rgn');
    const utla = feat('utla');
    const mcty = feat('mcty');

    const engRgns = rgn.filter(r => (r.properties.areacd || '').startsWith('E12'))
      .map(r => ({ norm: N(r.properties.areanm), geom: r.geometry }));
    const merseyside = (mcty.find(m => N(m.properties.areanm) === 'merseyside') || {}).geometry || null;

    const seEastNames = new Set(['kent', 'medway', 'surrey', 'eastsussex', 'westsussex', 'brightonandhove']);
    const seEastGeoms = utla.filter(u => seEastNames.has(N(u.properties.areanm))).map(u => u.geometry);

    const scotNorth = new Set(['highland', 'moray', 'aberdeenshire', 'aberdeencity', 'angus', 'dundeecity',
      'perthandkinross', 'argyllandbute', 'stirling', 'naheileanansiar', 'orkneyislands', 'shetlandislands']);
    const walesNorth = new Set(['isleofanglesey', 'gwynedd', 'conwy', 'denbighshire', 'flintshire', 'wrexham']);

    const mapEngRegion = (norm) => {
      if (norm.includes('northeast')) return 'ne_eng';
      if (norm.includes('northwest')) return 'nw_eng';
      if (norm.includes('yorkshire')) return 'yorks';
      if (norm.includes('eastmidlands')) return 'e_mids';
      if (norm.includes('westmidlands')) return 'w_mids';
      if (norm.includes('eastofengland')) return 'e_eng';
      if (norm.includes('london')) return 'london';
      if (norm.includes('southwest')) return 'sw_eng';
      if (norm.includes('southeast')) return '_southeast_';
      return null;
    };

    const regionFor = (f) => {
      const cd = f.properties.areacd || '', nm = N(f.properties.areanm);
      if (cd.startsWith('N')) return 'n_ireland';
      if (cd.startsWith('S12')) return scotNorth.has(nm) ? 'n_scot' : 's_scot';
      if (cd.startsWith('W06')) return walesNorth.has(nm) ? 'nwm' : 's_wales';
      if (cd.startsWith('E09')) return 'london';
      const c = this.centroidOf(f.geometry);
      if (merseyside && this.pip(c, merseyside)) return 'nwm';
      let base = null;
      for (const r of engRgns) { if (this.pip(c, r.geom)) { base = mapEngRegion(r.norm); break; } }
      if (!base) {
        // nearest region centroid fallback
        let bd = Infinity;
        for (const r of engRgns) {
          const rc = this.centroidOf(r.geom);
          const d = (rc[0] - c[0]) ** 2 + (rc[1] - c[1]) ** 2;
          if (d < bd) { bd = d; base = mapEngRegion(r.norm); }
        }
      }
      if (base === '_southeast_') {
        for (const g of seEastGeoms) { if (this.pip(c, g)) return 'se_eng'; }
        return 's_eng';
      }
      return base || 's_eng';
    };

    // ---- group polygons (lon/lat) per region ----
    const groups = {};
    this.regionMeta().forEach(m => groups[m.id] = []);
    for (const f of ltla) {
      const cd = f.properties.areacd || '';
      if (!/^[ESWN]/.test(cd)) continue;
      const rid = regionFor(f);
      if (!groups[rid]) continue;
      for (const poly of this.polysOf(f.geometry)) groups[rid].push(poly);
    }

    // ---- union per region -> multipolygon (lon/lat) ----
    const regionMP = {};
    for (const id of Object.keys(groups)) {
      const polys = groups[id];
      if (!polys.length) { regionMP[id] = []; continue; }
      let mp;
      try {
        mp = polygonClipping.union(polys[0], ...polys.slice(1));
      } catch (e) {
        mp = polys.map(p => [p[0]]); // fallback: outer rings only
      }
      regionMP[id] = mp;
    }

    this.buildScene(regionMP);
  }

  buildScene(regionMP) {
    const mount = this.mountRef.current;
    const W = mount.clientWidth, H = mount.clientHeight;

    // projection (equirectangular w/ latitude correction)
    const LON0 = -3.5, LAT0 = 54.5, SCALE = 130;
    const KX = Math.cos(LAT0 * Math.PI / 180) * SCALE, KY = SCALE;
    const pr = (lon, lat) => [(lon - LON0) * KX, (lat - LAT0) * KY];
    const ringArea = (ring) => { let a = 0; for (let i = 0; i < ring.length - 1; i++) a += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1]; return Math.abs(a / 2); };
    const MIN_AREA = 6;
    const DEPTH = 26;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xffffff);

    const group = new THREE.Group();
    const baseColor = 0xd9dbde;

    const meta = this.regionMeta();
    for (const m of meta) {
      const mp = regionMP[m.id] || [];
      const shapes = [];
      const lineRings = [];
      for (const poly of mp) {
        const outerLL = poly[0];
        const outerXY = outerLL.map(p => pr(p[0], p[1]));
        if (ringArea(outerXY) < MIN_AREA) continue;
        const shape = new THREE.Shape(outerXY.map(p => new THREE.Vector2(p[0], p[1])));
        lineRings.push(outerXY);
        for (let h = 1; h < poly.length; h++) {
          const holeXY = poly[h].map(p => pr(p[0], p[1]));
          if (ringArea(holeXY) < MIN_AREA) continue;
          const path = new THREE.Path(holeXY.map(p => new THREE.Vector2(p[0], p[1])));
          shape.holes.push(path);
          lineRings.push(holeXY);
        }
        shapes.push(shape);
      }
      if (!shapes.length) { this.meshById[m.id] = null; continue; }

      const geo = new THREE.ExtrudeGeometry(shapes, { depth: DEPTH, bevelEnabled: false });
      const topMat = new THREE.MeshStandardMaterial({ color: baseColor, roughness: 0.92, metalness: 0.0 });
      const sideMat = new THREE.MeshStandardMaterial({ color: 0xb7bac0, roughness: 0.95, metalness: 0.0 });
      const mesh = new THREE.Mesh(geo, [topMat, sideMat]);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.userData.regionId = m.id;
      group.add(mesh);
      this.meshById[m.id] = mesh;
      this.topMatById = this.topMatById || {};
      this.sideMatById = this.sideMatById || {};
      this.topMatById[m.id] = topMat;
      this.sideMatById[m.id] = sideMat;

      // border / coastline lines on the top surface
      const positions = [];
      for (const ring of lineRings) {
        for (let i = 0; i < ring.length - 1; i++) {
          positions.push(ring[i][0], ring[i][1], DEPTH + 0.4, ring[i + 1][0], ring[i + 1][1], DEPTH + 0.4);
        }
      }
      const lgeo = new THREE.BufferGeometry();
      lgeo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      const lmat = new THREE.LineBasicMaterial({ color: 0x9097a0, transparent: true, opacity: 0.55 });
      const lines = new THREE.LineSegments(lgeo, lmat);
      group.add(lines);
      this.lineById[m.id] = lmat;
    }

    // lay flat: shape XY -> ground plane, extrusion becomes height
    group.rotation.x = -Math.PI / 2;

    // center + lift
    const box = new THREE.Box3().setFromObject(group);
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const LIFT = 120;
    group.position.x -= center.x;
    group.position.z -= center.z;
    group.position.y += (LIFT - box.min.y);
    scene.add(group);
    this.group = group;
    this.mapSpan = Math.max(size.x, size.z);

    // ground (catches soft shadow)
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(this.mapSpan * 4, this.mapSpan * 4),
      new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 0 })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = 0;
    ground.receiveShadow = true;
    scene.add(ground);

    // lights
    scene.add(new THREE.HemisphereLight(0xffffff, 0xdfe3e8, 0.85));
    const amb = new THREE.AmbientLight(0xffffff, 0.35); scene.add(amb);
    const dir = new THREE.DirectionalLight(0xffffff, 0.9);
    dir.position.set(-0.5 * this.mapSpan, 1.25 * this.mapSpan, 0.55 * this.mapSpan);
    dir.castShadow = true;
    dir.shadow.mapSize.set(2048, 2048);
    dir.shadow.radius = 7;
    dir.shadow.bias = -0.0006;
    const sc = dir.shadow.camera;
    const s = this.mapSpan * 0.75;
    sc.left = -s; sc.right = s; sc.top = s; sc.bottom = -s; sc.near = 1; sc.far = this.mapSpan * 6;
    scene.add(dir);
    const fill = new THREE.DirectionalLight(0xffffff, 0.25);
    fill.position.set(0.6 * this.mapSpan, 0.5 * this.mapSpan, -0.6 * this.mapSpan);
    scene.add(fill);

    // camera + renderer
    const camera = new THREE.PerspectiveCamera(34, W / H, 1, this.mapSpan * 12);
    camera.position.set(0.18 * this.mapSpan, 1.05 * this.mapSpan, 1.15 * this.mapSpan);
    this._camBase = camera.position.clone();

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, preserveDrawingBuffer: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(W, H);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.outputEncoding = THREE.sRGBEncoding;
    mount.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.target.set(0, LIFT * 0.5, 0);
    controls.minDistance = this.mapSpan * 0.5;
    controls.maxDistance = this.mapSpan * 3;
    controls.maxPolarAngle = Math.PI * 0.49;
    controls.update();

    this.scene = scene; this.camera = camera; this.renderer = renderer; this.controls = controls;

    // raycasting
    const ray = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    const pickAt = (clientX, clientY) => {
      const rect = renderer.domElement.getBoundingClientRect();
      ndc.x = ((clientX - rect.left) / rect.width) * 2 - 1;
      ndc.y = -((clientY - rect.top) / rect.height) * 2 + 1;
      ray.setFromCamera(ndc, camera);
      const meshes = Object.values(this.meshById).filter(Boolean);
      const hit = ray.intersectObjects(meshes, false)[0];
      return hit ? hit.object.userData.regionId : null;
    };
    renderer.domElement.addEventListener('pointermove', (e) => {
      if (e.pointerType === 'touch') return;
      const id = pickAt(e.clientX, e.clientY);
      renderer.domElement.style.cursor = id ? 'pointer' : 'default';
      this.hover(id);
    });
    renderer.domElement.addEventListener('pointerdown', (e) => { this._downXY = [e.clientX, e.clientY]; });
    renderer.domElement.addEventListener('pointerup', (e) => {
      if (!this._downXY) return;
      const moved = Math.hypot(e.clientX - this._downXY[0], e.clientY - this._downXY[1]);
      this._downXY = null;
      if (moved > 5) return; // was a drag
      this.select(pickAt(e.clientX, e.clientY));
    });

    // resize
    this._ro = new ResizeObserver(() => {
      const w = mount.clientWidth, h = mount.clientHeight;
      if (!w || !h) return;
      const aspect = w / h;
      if (this._camBase && aspect < 1) {
        camera.position.copy(this._camBase).multiplyScalar(Math.min(2.5, 1 / aspect));
        controls.update();
      }
      camera.aspect = aspect; camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    });
    this._ro.observe(mount);

    const animate = () => {
      this._raf = requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene, camera);
    };
    animate();

    // this.regionData = this.buildRegionData(meta);
    this.regionData = this.liveRegionData();
    this.setState({ ready: true, regions: meta, selected: 'london', menuOpen: true }, () => { this.applyStyles(); this.lockCenter('london'); });
  }

  applyStyles() {
    const BASE = 0xd9dbde, HOVER = 0xc4d6ec, SEL = 0x2f6fb0;
    const SIDE = { [BASE]: 0xb7bac0, [HOVER]: 0x9fb4d2, [SEL]: 0x255a90 };
    const { hovered, selected } = this.state;
    for (const m of this.regionMeta()) {
      const mesh = this.meshById[m.id];
      if (!mesh) continue;
      let c = BASE;
      if (m.id === selected) c = SEL;
      else if (m.id === hovered) c = HOVER;
      if (this.topMatById[m.id]) {
        const tm = this.topMatById[m.id];
        if (m.id === selected) { tm.color.setHex(0x000000); tm.emissive.setHex(0x2f6fb0); tm.emissiveIntensity = 1; }
        else { tm.color.setHex(c); tm.emissive.setHex(0x000000); tm.emissiveIntensity = 0; }
      }
      if (this.sideMatById[m.id]) this.sideMatById[m.id].color.setHex(SIDE[c]);
      const lmat = this.lineById[m.id];
      if (lmat) {
        if (m.id === selected) { lmat.color.setHex(0x1b4f86); lmat.opacity = 0.85; }
        else if (m.id === hovered) { lmat.color.setHex(0x5b7fb0); lmat.opacity = 0.8; }
        else { lmat.color.setHex(0x9097a0); lmat.opacity = 0.55; }
      }
    }
  }

  hover(id) {
    if (this.state.hovered === id) return;
    this.setState({ hovered: id }, () => this.applyStyles());
  }

  select(id) {
    // clicking a region opens (and keeps) the menu; empty-space clicks leave the menu as-is
    const menuOpen = id ? true : this.state.menuOpen;
    const wheelDriven = this._wheelDriven; this._wheelDriven = false;
    this.setState({ selected: id, menuOpen }, () => {
      this.applyStyles();
      if (id && !wheelDriven) setTimeout(() => this.centerOn(id, true), 40);
    });
  }

  closeMenu() {
    this.setState({ menuOpen: false });
  }

  openChart() { if (this.state.selected) this.setState({ chartOpen: true }); }
  closeChart() { this.setState({ chartOpen: false }); }
  setFuel(f) { this.setState({ chartFuel: f }); }

  seriesFor(id) {
    this._series = this._series || {};
    if (this._series[id]) return this._series[id];
    const d = this.regionData[id];
    const baseByFuel = {}; d.generationmix.forEach(x => baseByFuel[x.fuel] = x.perc);
    const FO = LiveMap.FUEL_ORDER, N = 48;
    const rnd = (a) => { let t = a >>> 0; return () => { t += 0x6D2B79F5; let x = Math.imul(t ^ (t >>> 15), 1 | t); x ^= x + Math.imul(x ^ (x >>> 7), 61 | x); return ((x ^ (x >>> 14)) >>> 0) / 4294967296; }; };
    const series = {};
    for (const f of FO) {
      const base = baseByFuel[f] || 0;
      const r = rnd(Math.imul(d.region_id * 131 + f.charCodeAt(0) * 17 + f.length, 2654435761));
      let walk = 0; const arr = [];
      for (let i = 0; i < N; i++) {
        const hour = i / 2;
        let factor = 1;
        const solarish = Math.max(0, Math.sin(Math.PI * (hour - 6) / 12));
        if (f === 'solar') { factor = Math.pow(solarish, 1.3); }
        else if (f === 'wind') { walk += (r() - 0.5) * 0.5; walk = Math.max(-0.6, Math.min(0.9, walk)); factor = 1 + walk; }
        else if (f === 'gas') { factor = 1.15 - 0.45 * solarish + ((hour >= 16 && hour <= 20) ? 0.18 : 0); }
        else if (f === 'nuclear' || f === 'biomass') { factor = 0.96 + 0.08 * r(); }
        else { walk += (r() - 0.5) * 0.4; walk = Math.max(-0.5, Math.min(0.7, walk)); factor = 1 + walk; }
        let v = base * factor * (0.92 + 0.16 * r());
        if (f === 'solar' && base === 0) v = solarish * (1.5 + r());
        arr.push(Math.max(0, v));
      }
      series[f] = arr.map(v => Math.round(v * 10) / 10);
    }
    this._series[id] = series;
    return series;
  }

  chartVals() {
    const FO = LiveMap.FUEL_ORDER;
    const fuel = this.state.chartFuel;
    const sel = this.state.selected;
    const chips = [{ id: 'all', label: 'All', color: '#2f6fb0' }].concat(
      FO.map(f => ({ id: f, label: LiveMap.FUEL_LABEL[f], color: LiveMap.FUEL_COLOR[f] }))
    ).map(c => {
      const active = c.id === fuel;
      return { ...c, active, bg: active ? this.hexA(c.color, 0.13) : '#ffffff', border: active ? c.color : '#e6e8eb', fg: active ? '#23272c' : '#5a6068', onClick: () => this.setFuel(c.id) };
    });

    const d = sel && this.regionData ? this.regionData[sel] : null;
    const out = {
      chartOpen: !!(this.state.chartOpen && d),
      onOpenChart: () => this.openChart(),
      onCloseChart: () => this.closeChart(),
      stopProp: (e) => e.stopPropagation(),
      chartTitle: '',
      chartSubtitle: '',
      fuelChips: chips,
      chartLines: [], chartArea: '', chartSingle: false, chartAreaColor: 'none',
      yTicks: [], xTicks: [], nowX: 0, nowTop: 0, nowBot: 0
    };
    if (!d) return out;

    out.chartTitle = d.shortname;
    out.chartSubtitle = (fuel === 'all' ? 'All generation' : LiveMap.FUEL_LABEL[fuel]) + ' · % of mix · last 24h (half-hourly)';
    const series = this.seriesFor(sel);
    const fuels = fuel === 'all' ? FO : [fuel];

    // geometry
    const W = 860, H = 360, PADL = 48, PADR = 20, PADT = 20, PADB = 34;
    const innerW = W - PADL - PADR, innerH = H - PADT - PADB;
    let ymax = 0;
    for (const f of fuels) for (const v of series[f]) if (v > ymax) ymax = v;
    ymax = Math.max(5, Math.ceil(ymax / 5) * 5);
    const X = (i) => PADL + (i / 2) / 24 * innerW;
    const Y = (v) => PADT + (1 - v / ymax) * innerH;
    const baseY = PADT + innerH;

    out.chartSingle = fuels.length === 1;
    out.chartLines = fuels.map(f => {
      const pts = series[f].map((v, i) => X(i).toFixed(1) + ',' + Y(v).toFixed(1));
      return { fuel: f, color: LiveMap.FUEL_COLOR[f], points: pts.join(' '), width: fuels.length === 1 ? '2.5' : '1.6' };
    });
    if (out.chartSingle) {
      const f = fuels[0];
      const pts = series[f].map((v, i) => [X(i), Y(v)]);
      out.chartArea = 'M ' + pts[0][0].toFixed(1) + ',' + baseY + ' ' +
        pts.map(p => 'L ' + p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' ') +
        ' L ' + pts[pts.length - 1][0].toFixed(1) + ',' + baseY + ' Z';
      out.chartAreaColor = this.hexA(LiveMap.FUEL_COLOR[f], 0.16);
    }
    out.yTicks = [0, ymax / 2, ymax].map(v => ({ y: Y(v).toFixed(1), x1: PADL, x2: PADL + innerW, label: (Math.round(v * 10) / 10) + '%' }));
    out.xTicks = [0, 6, 12, 18, 24].map(h => ({ x: (PADL + h / 24 * innerW).toFixed(1), yb: baseY + 18, label: (h < 10 ? '0' + h : h) + ':00' }));
    out.nowX = (PADL + 9 / 24 * innerW).toFixed(1);
    out.nowTop = PADT; out.nowBot = baseY;
    return out;
  }

  renderVals() {
    const sel = this.state.selected, hov = this.state.hovered;
    const items = (this.state.regions || []).map(r => {
      const active = r.id === sel, hovd = r.id === hov;
      return {
        id: r.id, num: r.num, name: r.name,
        fg: active ? '#2f6fb0' : '#23272c',
        weight: active ? '800' : (hovd ? '700' : '600'),
        badgeBg: active ? '#2f6fb0' : 'rgba(0,0,0,0.06)',
        badgeFg: active ? '#ffffff' : '#737982',
        onEnter: () => this.hover(r.id),
        onClick: () => this.select(r.id)
      };
    });
    const selName = sel ? (this.state.regions.find(r => r.id === sel) || {}).name : '';
    return {
      mountRef: this.mountRef,
      wheelRef: this.wheelRef,
      padRef: this.padRef,
      onWheelScroll: () => this.onWheelScroll(),
      items,
      onLeaveList: () => this.hover(null),
      ready: this.state.ready,
      loading: !this.state.ready && !this.state.error,
      error: this.state.error,
      hasSelection: !!sel,
      noSelection: !sel,
      selectedName: selName,
      menuTransform: this.state.menuOpen ? 'translate(0, -50%)' : 'translate(-18px, -50%)',
      menuOpacity: this.state.menuOpen ? '1' : '0',
      menuPointer: this.state.menuOpen ? 'auto' : 'none',
      onClose: () => this.closeMenu(),
      ...this.detailVals(),
      ...this.chartVals()
    };
  }

  detailVals() {
    const sel = this.state.selected;
    const d = sel && this.regionData ? this.regionData[sel] : null;
    const open = !!d;
    const out = {
      panelOpen: open,
      panelTransform: this.state.isMobile ? (open ? 'translateY(0)' : 'translateY(112%)') : (open ? 'translateX(0)' : 'translateX(22px)'),
      panelOpacity: open ? '1' : '0',
      panelPointer: open ? 'auto' : 'none',
      detailName: d ? d.shortname : '',
      detailMeta: d ? ('Region ' + d.region_id) : '',
      detailWindow: d ? this.formatWindow(d.from, d.to) : '',
      detailForecast: d ? String(d.intensity.forecast) : '',
      detailIndexLabel: d ? d.intensity.index : '',
      detailIndexColor: d ? LiveMap.BAND_COLOR[d.intensity.index] : '#999',
      detailIndexBg: d ? this.hexA(LiveMap.BAND_COLOR[d.intensity.index], 0.14) : 'transparent',
      mixItems: []
    };
    if (d) {
      const sorted = d.generationmix.slice().sort((a, b) => b.perc - a.perc);
      const max = Math.max.apply(null, sorted.map(x => x.perc)) || 1;
      out.mixItems = sorted.map(x => ({
        fuel: x.fuel,
        label: LiveMap.FUEL_LABEL[x.fuel],
        perc: x.perc.toFixed(1),
        width: (x.perc / max * 100).toFixed(1) + '%',
        color: LiveMap.FUEL_COLOR[x.fuel],
        dim: x.perc === 0 ? '0.4' : '1'
      }));
    }
    return out;
  }

  hexA(hex, a) {
    const n = parseInt(hex.slice(1), 16);
    return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')';
  }

  // "2026-06-19T09:00Z" -> "09:00"
  static hhmm(iso) {
    const m = /T(\d{2}:\d{2})/.exec(iso || '');
    return m ? m[1] : '';
  }

  formatWindow(from, to) {
    const a = LiveMap.hhmm(from), b = LiveMap.hhmm(to);
    return a && b ? `${a}–${b} UTC` : '';
  }

  // National average across every region that currently has live data
  nationalSummary() {
    const regions = Object.values(this.regionData || {});
    if (!regions.length) return null;
    const avg = Math.round(regions.reduce((s, r) => s + r.intensity.forecast, 0) / regions.length);
    const index = LiveMap.band(avg);
    return { avg, index, color: LiveMap.BAND_COLOR[index], window: this.formatWindow(regions[0].from, regions[0].to) };
  }

  render() {
    this.regionData = this.liveRegionData();
    const nat = this.nationalSummary();
    const v = this.renderVals();
    return (
      <div style={{ display: 'flex', height: '100vh', width: '100vw', background: '#ffffff' }}>

        <aside id="region-menu" style={{ position: 'absolute', left: 18, top: '43%', width: 344, height: 'min(72vh,640px)', boxSizing: 'border-box', display: 'flex', flexDirection: 'column', background: 'transparent', zIndex: 10, opacity: v.menuOpacity, transform: v.menuTransform, transition: 'transform .44s cubic-bezier(.4,0,.2,1), opacity .44s ease', pointerEvents: v.menuPointer }}>
          <div ref={v.wheelRef} onScroll={v.onWheelScroll} onMouseLeave={v.onLeaveList} className="region-wheel" style={{ position: 'relative', height: '100%', overflowY: 'auto', perspective: '760px' }}>
            <div ref={v.padRef} style={{ padding: '320px 0' }}>
              {v.items.map((item) => (
                <div key={item.id} data-wheel-item="1" data-id={item.id} onMouseEnter={item.onEnter} onClick={item.onClick} style={{ height: 46, display: 'flex', alignItems: 'center', gap: 12, padding: '0 10px', cursor: 'pointer', transformOrigin: 'center center', backfaceVisibility: 'hidden', willChange: 'transform,opacity' }}>
                  <span style={{ flex: 'none', width: 24, height: 24, borderRadius: 7, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, background: item.badgeBg, color: item.badgeFg }}>{item.num}</span>
                  <span data-wheel-name="1" style={{ whiteSpace: 'nowrap', fontSize: 15, fontWeight: item.weight, letterSpacing: '-0.01em', color: item.fg }}>{item.name}</span>
                </div>
              ))}
            </div>
          </div>
          <div style={{ position: 'absolute', left: 6, right: 6, top: '50%', height: 46, transform: 'translateY(-50%)', pointerEvents: 'none', borderTop: '1px solid rgba(0,0,0,0.06)', borderBottom: '1px solid rgba(0,0,0,0.06)' }}></div>
        </aside>

        <main style={{ flex: 1, position: 'relative', height: '100%', background: '#ffffff' }}>
          <div ref={v.mountRef} style={{ position: 'absolute', inset: 0 }}></div>

          <div id="status-bar" style={{ position: 'absolute', left: 34, bottom: 30, display: 'flex', flexDirection: 'column', gap: 9, pointerEvents: 'none', fontSize: 12, fontWeight: 600 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#e5484d', animation: 'livepulse 1.6s ease-in-out infinite' }}></span>
              <span style={{ letterSpacing: '0.16em', textTransform: 'uppercase', color: '#23272c', fontWeight: 700 }}>UK Carbon Grid · Live</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, color: '#7c8288', letterSpacing: '0.02em' }}>
              <span>{nat ? nat.window : '—'}</span>
              <span style={{ width: 1, height: 12, background: '#d8dadd' }}></span>
              <span>National average</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 14, marginTop: 2 }}>
              <span style={{ fontSize: 30, fontWeight: 800, color: '#23272c', letterSpacing: '-0.02em', lineHeight: 1 }}>{nat ? nat.avg : '—'} <span style={{ fontSize: 16, fontWeight: 600, color: '#7c8288' }}>gCO₂/kWh</span></span>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '5px 11px 5px 9px', borderRadius: 999, background: nat ? this.hexA(nat.color, 0.13) : 'rgba(0,0,0,0.05)' }}>
                <span style={{ width: 9, height: 9, borderRadius: '50%', background: nat ? nat.color : '#9aa0a6' }}></span>
                <span style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', color: nat ? nat.color : '#9aa0a6' }}>{nat ? nat.index : '—'}</span>
              </span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginTop: 10, fontSize: 11.5, fontWeight: 600, color: '#9aa0a6', letterSpacing: '0.01em', pointerEvents: 'auto' }}>
              <span>© {new Date().getFullYear()} Wilson Wong</span>
              <span style={{ width: 1, height: 10, background: '#d8dadd' }}></span>
              <a href="https://github.com/wilws/uk-carbon-map" target="_blank" rel="noopener noreferrer" style={{ color: '#9aa0a6', textDecoration: 'none', fontWeight: 600 }}>wilws/uk-carbon-map</a>
            </div>
          </div>

          <aside id="detail-panel" style={{ position: 'absolute', right: 24, top: 24, width: 332, maxHeight: 'calc(100vh - 48px)', boxSizing: 'border-box', borderRadius: 4, display: 'flex', flexDirection: 'column', background: 'rgba(255,255,255,0.9)', WebkitBackdropFilter: 'blur(8px)', backdropFilter: 'blur(8px)', border: '1px solid rgba(255,255,255,0.6)', zIndex: 10, opacity: v.panelOpacity, transform: v.panelTransform, transition: 'transform .44s cubic-bezier(.4,0,.2,1), opacity .44s ease', pointerEvents: v.panelPointer, overflowY: 'auto' }}>
            <div style={{ position: 'relative', padding: '24px 24px 22px 24px' }}>
              <h2 style={{ margin: '2px 58px 2px 0', fontSize: 25, fontWeight: 800, color: '#1f2327', letterSpacing: '-0.015em', lineHeight: 1.1 }}>{v.detailName}</h2>
              <div style={{ fontSize: 12.5, color: '#7c8288', fontWeight: 600 }}>{v.detailMeta}</div>

              <div onClick={v.onOpenChart} style={{ display: 'inline-flex', alignItems: 'center', gap: 9, marginTop: 16, padding: '7px 12px', borderRadius: 8, fontSize: 12, color: '#5a6068', fontWeight: 600, cursor: 'pointer', background: 'rgba(0,0,0,0.04)', transition: 'background .14s ease' }}>
                <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#e5484d', animation: 'livepulse 1.6s ease-in-out infinite' }}></span>
                <span>{v.detailWindow}</span>
                <span style={{ width: 1, height: 11, background: '#cfd2d6' }}></span>
                <span style={{ color: '#2f6fb0', fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: 4 }}>View trend
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#2f6fb0" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 17 9 11 13 15 21 6"></polyline></svg>
                </span>
              </div>

              <div style={{ display: 'flex', alignItems: 'baseline', gap: 13, marginTop: 11 }}>
                <span style={{ fontSize: 46, fontWeight: 800, color: '#1f2327', letterSpacing: '-0.03em', lineHeight: 0.9 }}>{v.detailForecast}</span>
                <span style={{ fontSize: 14, fontWeight: 600, color: '#7c8288' }}>gCO₂/kWh</span>
              </div>
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: 7, marginTop: 13, padding: '5px 12px 5px 10px', borderRadius: 999, background: v.detailIndexBg }}>
                <span style={{ width: 9, height: 9, borderRadius: '50%', background: v.detailIndexColor }}></span>
                <span style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: v.detailIndexColor }}>{v.detailIndexLabel}</span>
              </div>

              <div style={{ height: 1, background: 'rgba(0,0,0,0.08)', margin: '22px 0 16px 0' }}></div>
              <div style={{ fontSize: 10.5, letterSpacing: '0.16em', textTransform: 'uppercase', color: '#9aa0a6', fontWeight: 700, marginBottom: 13 }}>Generation mix</div>

              {v.mixItems.map((m) => (
                <div key={m.fuel} style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '5px 0', opacity: m.dim }}>
                  <span style={{ flex: 'none', width: 62, fontSize: 13, fontWeight: 600, color: '#3a3f47' }}>{m.label}</span>
                  <span style={{ flex: 1, height: 7, borderRadius: 4, background: 'rgba(0,0,0,0.06)', overflow: 'hidden', display: 'block' }}>
                    <span style={{ display: 'block', height: '100%', borderRadius: 4, width: m.width, background: m.color }}></span>
                  </span>
                  <span style={{ flex: 'none', width: 42, textAlign: 'right', fontSize: 12.5, fontWeight: 700, color: '#23272c', fontVariantNumeric: 'tabular-nums' }}>{m.perc}</span>
                </div>
              ))}
            </div>
          </aside>

          {v.chartOpen && (
            <div onClick={v.onCloseChart} style={{ position: 'fixed', inset: 0, zIndex: 50, background: 'rgba(255,255,255,0.55)', WebkitBackdropFilter: 'blur(2px)', backdropFilter: 'blur(2px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 32, animation: 'scrimin .2s ease' }}>
              <div id="trend-card" onClick={v.stopProp} style={{ width: 'min(1240px,96vw)', maxHeight: '94vh', overflowY: 'auto', boxSizing: 'border-box', background: 'rgba(255,255,255,0.72)', WebkitBackdropFilter: 'blur(30px) saturate(1.6)', backdropFilter: 'blur(30px) saturate(1.6)', border: '1px solid rgba(255,255,255,0.7)', borderRadius: 10, boxShadow: '0 24px 70px rgba(0,0,0,0.12)', padding: '26px 30px 30px' }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16 }}>
                  <div>
                    <div style={{ fontSize: 10.5, letterSpacing: '0.16em', textTransform: 'uppercase', color: '#9aa0a6', fontWeight: 700 }}>Generation trend</div>
                    <h2 style={{ margin: '6px 0 3px 0', fontSize: 24, fontWeight: 800, color: '#1f2327', letterSpacing: '-0.015em' }}>{v.chartTitle}</h2>
                    <div style={{ fontSize: 13, color: '#7c8288', fontWeight: 600 }}>{v.chartSubtitle}</div>
                  </div>
                  <button onClick={v.onCloseChart} aria-label="Close" style={{ flex: 'none', border: 'none', background: '#f2f3f5', borderRadius: 8, width: 34, height: 34, fontSize: 17, color: '#6b7178', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'background .14s ease' }}>✕</button>
                </div>

                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, margin: '20px 0 16px' }}>
                  {v.fuelChips.map((c) => (
                    <button key={c.id} onClick={c.onClick} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '6px 13px', borderRadius: 999, border: `1px solid ${c.border}`, background: c.bg, color: c.fg, cursor: 'pointer', fontSize: 12.5, fontWeight: 600, transition: 'all .12s ease' }}>
                      <span style={{ width: 9, height: 9, borderRadius: '50%', background: c.color }}></span>{c.label}
                    </button>
                  ))}
                </div>

                <svg viewBox="0 0 860 360" style={{ width: '100%', height: 'auto', display: 'block' }}>
                  {v.yTicks.map((t, i) => (
                    <g key={'y' + i}>
                      <line x1={t.x1} x2={t.x2} y1={t.y} y2={t.y} stroke="#eceef1" strokeWidth="1"></line>
                      <text x="40" y={t.y} textAnchor="end" dominantBaseline="middle" fontSize="11" fill="#9aa0a6" fontWeight="600">{t.label}</text>
                    </g>
                  ))}
                  {v.xTicks.map((t, i) => (
                    <text key={'x' + i} x={t.x} y={t.yb} textAnchor="middle" fontSize="11" fill="#9aa0a6" fontWeight="600">{t.label}</text>
                  ))}
                  <line x1={v.nowX} x2={v.nowX} y1={v.nowTop} y2={v.nowBot} stroke="#e5484d" strokeWidth="1.4" strokeDasharray="4 4" opacity="0.65"></line>
                  <text x={v.nowX} y="14" textAnchor="middle" fontSize="10" fill="#e5484d" fontWeight="700">NOW</text>
                  {v.chartSingle && (
                    <path d={v.chartArea} fill={v.chartAreaColor} stroke="none"></path>
                  )}
                  {v.chartLines.map((ln) => (
                    <polyline key={ln.fuel} points={ln.points} fill="none" stroke={ln.color} strokeWidth={ln.width} strokeLinejoin="round" strokeLinecap="round"></polyline>
                  ))}
                </svg>
              </div>
            </div>
          )}

          {v.loading && (
            <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 18, background: '#ffffff' }}>
              <div style={{ width: 34, height: 34, border: '3px solid #e8eaed', borderTopColor: '#2f6fb0', borderRadius: '50%', animation: 'spin .8s linear infinite' }}></div>
              <div style={{ fontSize: 14, color: '#9aa0a6', fontWeight: 600 }}>Building map…</div>
            </div>
          )}

          {v.error && (
            <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 40, textAlign: 'center' }}>
              <div style={{ fontSize: 14, color: '#b04a4a', fontWeight: 600, maxWidth: 360 }}>{v.error}</div>
            </div>
          )}
        </main>
      </div>
    );
  }
}
