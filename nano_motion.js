(function (root) {
  'use strict';
  const MAX_MS = 600000, MAX_EVENTS = 15000;
  function validProfile(p, pin) {
    return !!p && p.pin === pin && typeof p.name === 'string' && p.name.length <= 80 &&
      [p.minUs, p.maxUs, p.restUs].every(Number.isInteger) && p.minUs >= 500 &&
      p.maxUs <= 2500 && p.minUs < p.maxUs && p.restUs >= p.minUs && p.restUs <= p.maxUs;
  }
  function validAction(a, profiles) {
    if (!a || !['SET', 'OFF', 'ALL_OFF'].includes(a.type)) return false;
    if (a.type === 'ALL_OFF') return true;
    if (!Number.isInteger(a.pin) || a.pin < 2 || a.pin > 13) return false;
    const p = profiles[a.pin - 2];
    return a.type === 'OFF' || (Number.isInteger(a.us) && a.us >= p.minUs && a.us <= p.maxUs);
  }
  function validSequence(s, profiles) {
    if (!s || !Number.isInteger(s.duration) || s.duration < 100 || s.duration > MAX_MS ||
        !Array.isArray(s.events) || !s.events.length || s.events.length > MAX_EVENTS ||
        s.events[0].type !== 'ALL_OFF' || s.events[0].at !== 0) return false;
    let previous = 0;
    return s.events.every(e => {
      const ok = Number.isInteger(e.at) && e.at >= previous && e.at <= s.duration && validAction(e, profiles);
      previous = e.at; return ok;
    });
  }
  class Recorder {
    constructor(now = () => performance.now()) { this.now = now; this.active = false; }
    start(initial) {
      this.started = this.now(); this.active = true;
      this.events = [{type: 'ALL_OFF', at: 0}, ...initial.map(a => ({...a, at: 0}))];
    }
    capture(action) {
      if (!this.active) return false;
      if (this.events.length >= MAX_EVENTS || this.now() - this.started >= MAX_MS) return false;
      this.events.push({...action, at: Math.round(this.now() - this.started)}); return true;
    }
    finish() {
      this.active = false;
      return {duration: Math.max(100, Math.min(MAX_MS, Math.round(this.now() - this.started))), events: this.events};
    }
  }
  class Player {
    constructor({dispatch, onCycle = () => {}, onError = () => {}, now = () => performance.now(),
      later = setTimeout, cancel = clearTimeout}) {
      Object.assign(this, {dispatch, onCycle, onError, now, later, cancel}); this.token = 0; this.active = false;
    }
    stop() { this.active = false; this.token++; this.cancel(this.timer); }
    start(sequence) {
      this.stop(); this.active = true; this.sequence = sequence; this.cycle = 0;
      this.begin(this.token);
    }
    begin(token) {
      if (!this.active || token !== this.token) return;
      this.started = this.now(); this.index = 0; this.onCycle(++this.cycle); this.tick(token);
    }
    async tick(token) {
      if (!this.active || token !== this.token) return;
      try {
        while (this.index < this.sequence.events.length &&
               this.sequence.events[this.index].at <= this.now() - this.started) {
          await this.dispatch(this.sequence.events[this.index++]);
          if (!this.active || token !== this.token) return;
        }
        const next = this.index < this.sequence.events.length ? this.sequence.events[this.index].at : this.sequence.duration;
        const delay = Math.max(0, next - (this.now() - this.started));
        this.timer = this.later(() => this.index < this.sequence.events.length ? this.tick(token) : this.begin(token), delay);
      } catch (e) { if (token === this.token) { this.stop(); this.onError(e); } }
    }
  }
  const api = {MAX_MS, MAX_EVENTS, validProfile, validSequence, Recorder, Player};
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.NanoMotion = api;
})(globalThis);
