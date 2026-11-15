// Ember Yard — visual effects. Tracers, muzzle flashes, impact sparks and
// explosions, all from fixed pools reused every frame: the hot loop never
// allocates a mesh, a material or a vector.
import * as THREE from 'three';

const TRACER_N = 24;
const SPARK_N = 240;

export class Effects {
  constructor(scene) {
    this.scene = scene;
    // tracer pool: one Line per slot, fading fast
    this.tracers = [];
    for (let i = 0; i < TRACER_N; i++) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
      const line = new THREE.Line(geo, new THREE.LineBasicMaterial({
        color: 0xffc46b, transparent: true, opacity: 0, blending: THREE.AdditiveBlending,
      }));
      line.frustumCulled = false;
      scene.add(line);
      this.tracers.push({ line, life: 0 });
    }
    this.tracerI = 0;
    // spark pool: one Points cloud, positions + velocities in flat arrays
    this.sparkPos = new Float32Array(SPARK_N * 3);
    this.sparkVel = new Float32Array(SPARK_N * 3);
    this.sparkLife = new Float32Array(SPARK_N);
    const sgeo = new THREE.BufferGeometry();
    sgeo.setAttribute('position', new THREE.BufferAttribute(this.sparkPos, 3));
    this.sparks = new THREE.Points(sgeo, new THREE.PointsMaterial({
      color: 0xffd27a, size: 0.09, transparent: true, opacity: 0.95,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    this.sparks.frustumCulled = false;
    scene.add(this.sparks);
    this.sparkI = 0;
    // muzzle flash: one small additive plane, reused for every shot
    const fgeo = new THREE.PlaneGeometry(0.5, 0.5);
    this.flash = new THREE.Mesh(fgeo, new THREE.MeshBasicMaterial({
      color: 0xffd27a, transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    }));
    scene.add(this.flash);
    this.flashLife = 0;
    // explosion: one expanding sphere + one light, reused
    this.boom = new THREE.Mesh(
      new THREE.SphereGeometry(1, 14, 10),
      new THREE.MeshBasicMaterial({ color: 0xff8a2f, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    scene.add(this.boom);
    this.boomLight = new THREE.PointLight(0xff7a2f, 0, 26, 1.6);
    scene.add(this.boomLight);
    this.boomLife = 0;
    // temps (allocated once)
    this._v = new THREE.Vector3();
  }

  tracer(from, to, color) {
    const t = this.tracers[this.tracerI];
    this.tracerI = (this.tracerI + 1) % TRACER_N;
    const p = t.line.geometry.attributes.position.array;
    p[0] = from[0]; p[1] = from[1]; p[2] = from[2];
    p[3] = to[0]; p[4] = to[1]; p[5] = to[2];
    t.line.geometry.attributes.position.needsUpdate = true;
    t.line.material.color.setHex(color || 0xffc46b);
    t.line.material.opacity = 0.9;
    t.life = 0.14;
  }

  muzzle(pos, yaw, pitch) {
    this.flash.position.set(pos[0], pos[1], pos[2]);
    this.flash.rotation.set(0, yaw, 0);
    this.flash.material.opacity = 0.95;
    this.flashLife = 0.05;
    // random roll so consecutive flashes do not look stamped
    this.flash.rotation.z = Math.random() * Math.PI;
    void pitch;
  }

  sparksAt(x, y, z, n) {
    for (let k = 0; k < n; k++) {
      const i = this.sparkI;
      this.sparkI = (this.sparkI + 1) % SPARK_N;
      this.sparkPos[i * 3] = x; this.sparkPos[i * 3 + 1] = y; this.sparkPos[i * 3 + 2] = z;
      const a = Math.random() * Math.PI * 2, up = (Math.random() - 0.3) * 3;
      const sp = 2 + Math.random() * 3.5;
      this.sparkVel[i * 3] = Math.cos(a) * sp;
      this.sparkVel[i * 3 + 1] = up;
      this.sparkVel[i * 3 + 2] = Math.sin(a) * sp;
      this.sparkLife[i] = 0.25 + Math.random() * 0.25;
    }
  }

  explosion(x, y, z) {
    this.boom.position.set(x, y, z);
    this.boom.scale.setScalar(0.5);
    this.boom.material.opacity = 0.85;
    this.boomLight.position.set(x, y + 1, z);
    this.boomLight.intensity = 160;
    this.boomLife = 0.55;
    this.sparksAt(x, y, z, 60);
  }

  step(dt) {
    for (const t of this.tracers) {
      if (t.life > 0) {
        t.life -= dt;
        t.line.material.opacity = Math.max(0, t.life / 0.14) * 0.9;
      }
    }
    if (this.flashLife > 0) {
      this.flashLife -= dt;
      this.flash.material.opacity = Math.max(0, this.flashLife / 0.05) * 0.95;
    }
    // sparks: integrate the flat arrays in place
    let any = false;
    for (let i = 0; i < SPARK_N; i++) {
      if (this.sparkLife[i] <= 0) continue;
      any = true;
      this.sparkLife[i] -= dt;
      this.sparkVel[i * 3 + 1] -= 9 * dt;
      this.sparkPos[i * 3] += this.sparkVel[i * 3] * dt;
      this.sparkPos[i * 3 + 1] += this.sparkVel[i * 3 + 1] * dt;
      this.sparkPos[i * 3 + 2] += this.sparkVel[i * 3 + 2] * dt;
      if (this.sparkPos[i * 3 + 1] < 0.03) { this.sparkPos[i * 3 + 1] = 0.03; this.sparkVel[i * 3 + 1] *= -0.4; }
      if (this.sparkLife[i] <= 0) { this.sparkPos[i * 3 + 1] = -50; }
    }
    if (any) this.sparks.geometry.attributes.position.needsUpdate = true;
    if (this.boomLife > 0) {
      this.boomLife -= dt;
      const k = 1 - this.boomLife / 0.55;
      this.boom.scale.setScalar(0.5 + k * 6);
      this.boom.material.opacity = Math.max(0, 0.85 * (1 - k));
      this.boomLight.intensity = Math.max(0, 160 * (1 - k));
    }
  }
}
