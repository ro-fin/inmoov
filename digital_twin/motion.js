// Expressive gestures for the digital twin (preview only: never sent to servos).
// Poses are in twin joint degrees; see JOINTS in twin.js for directions.
const fist = side => Object.fromEntries(['Index', 'Majeure', 'RingFinger', 'Pinky'].map(f => [side + f, 85]).concat([[side + 'Thumb', 55]]));
const wave = (t, rate, amp) => Math.sin(t * rate) * amp;

export const GESTURES = {
  hi: {
    label: 'Hi', icon: '👋', duration: 5.2,
    pose: {rightOmoplate: 78, rightRotate: -72, rightBicep: 92, rothead: -12, eyeRight: -8, eyeLeft: -8, jaw: 8},
    live: (t, p) => { p.rightRotate += wave(t, 6, 16); }
  },
  bye: {
    label: 'Bye', icon: '🙋', duration: 6,
    pose: {rightOmoplate: 70, rightRotate: -68, rightBicep: 100, neck: 6, rothead: -8},
    live: (t, p) => { p.rightRotate += wave(t, 8, 22); const c = 20 + wave(t, 4, 18); for (const f of ['Index', 'Majeure', 'RingFinger', 'Pinky']) p['right' + f] = c; }
  },
  left: {
    label: 'Go left', icon: '👉', duration: 5.4,
    pose: {leftOmoplate: 82, ...fist('left'), leftIndex: 0, rothead: 45, eyeLeft: 22, eyeRight: 22, waist: 12},
    live: (t, p) => { p.leftShoulder = 4 + wave(t, 2.2, 4); }
  },
  stop: {
    label: 'Stop', icon: '✋', duration: 5,
    pose: {rightShoulder: 74, rightBicep: 96, rightWrist: 88, neck: -4, eyeY: -4, jaw: 2}
  },
  vanakkam: {
    label: 'Vanakkam', sub: 'வணக்கம்', icon: '🙏', duration: 6.2,
    pose: {leftShoulder: 25, rightShoulder: 25, leftRotate: 33, rightRotate: 33, leftBicep: 96, rightBicep: 96, leftWrist: 90, rightWrist: 90, neck: -14, eyeY: -8},
    live: (t, p) => { p.neck += wave(t, 1.6, 4); }
  },
  think: {
    label: 'Think', icon: '🤔', duration: 5.6,
    pose: {rightShoulder: 48, rightRotate: 62, rightBicep: 100, ...fist('right'), rightIndex: 30, rothead: 18, rollNeck: 8, eyeY: 12, eyeLeft: 12, eyeRight: 12}
  }
};

const smooth = x => x * x * (3 - 2 * x);

export class MotionPlayer {
  constructor(twin) { this.twin = twin; this.active = null; }
  start(id, from) { if (GESTURES[id]) this.active = {id, start: performance.now(), from: {...from}}; }
  stop() { this.active = null; }
  // Returns a full target map or null when idle.
  tick(now, targets) {
    if (!this.active) return false;
    const g = GESTURES[this.active.id], t = (now - this.active.start) / 1000;
    if (t >= g.duration) { for (const k of Object.keys(targets)) targets[k] = 0; this.active = null; return false; }
    const enter = smooth(Math.min(1, t / 1.1)), leave = smooth(Math.min(1, (g.duration - t) / 1.1)), w = enter * leave;
    const p = {...g.pose};
    g.live?.(t, p);
    for (const k of Object.keys(targets)) {
      const goal = p[k] ?? 0, from = this.active.from[k] ?? 0;
      targets[k] = from * (1 - enter) * leave + goal * w;
    }
    return true;
  }
}
