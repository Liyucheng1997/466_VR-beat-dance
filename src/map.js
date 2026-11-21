// 谱面生成：按曲子的段落结构，用固定种子的随机数排出星晶序列（每次进游戏谱面相同）。
import { BEAT, BARS, sectionOf } from './audio.js';

function rng32(a) {
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const S = Math.SQRT1_2;
const DOWN = [[0, -1], [0, -1], [0, -1], [-S, -S], [S, -S]];
const UP = [[0, 1], [0, 1], [0, 1], [-S, S], [S, S]];

// diff: 0 普通, 1 困难
// 返回 { notes: [{t, hand, col, row, dir}], speed }；hand 0 左(琥珀) 1 右(青)，dir 为 null 表示任意方向
export function buildMap(diff) {
  const hard = diff === 1;
  const rnd = rng32(hard ? 9173 : 2024);
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  const notes = [];
  const hs = [{ last: -9, low: false }, { last: -9, low: false }];
  let next = 0;

  function put(t, hand, o = {}) {
    const h = hs[hand];
    if (t - h.last > 2 * BEAT + 1e-6) h.low = false;   // 停顿久了，手回到上方
    let dir, row;
    if (o.dot) {
      dir = null; row = 1;
    } else if (!o.vertical && rnd() < 0.12) {
      dir = [hand === 0 ? -1 : 1, 0];
      if (rnd() < 0.3) dir = [-dir[0], 0];
      row = 1;
    } else if (h.low) {
      dir = o.vertical ? [0, 1] : pick(UP);
      row = rnd() < 0.5 ? 1 : 2;
      h.low = false;
    } else {
      dir = o.vertical ? [0, -1] : pick(DOWN);
      row = rnd() < 0.5 ? 0 : 1;
      h.low = true;
    }
    const col = o.col ?? (hand === 0 ? pick([0, 1, 1, 2]) : pick([2, 3, 3, 4]));
    notes.push({ t, hand, col, row: o.row ?? row, dir });
    h.last = t;
  }

  function single(t, dot) {
    let hand = next;
    if (t - hs[hand].last < BEAT - 1e-6) hand = 1 - hand;
    if (t - hs[hand].last < BEAT - 1e-6) return;
    put(t, hand, { dot });
    next = 1 - hand;
  }

  function double(t, dot) {
    hs[1].low = hs[0].low;
    put(t, 0, { dot, vertical: true, col: 1 });
    put(t, 1, { dot, vertical: true, col: 3, row: notes[notes.length - 1].row });
  }

  for (let bar = 1; bar < BARS; bar++) {
    const s = sectionOf(bar);
    for (let step = 0; step < 8; step++) {
      const t = (bar * 4 + step * 0.5) * BEAT;
      const q = step % 2 === 0;
      const half = step === 0 || step === 4;
      let p = 0, dbl = false, dot = false;
      switch (s) {
        case 'intro': p = half ? 1 : 0; break;
        case 'verse': p = q ? (hard ? 1 : 0.8) : (hard ? 0.25 : 0); break;
        case 'verse2':
          p = q ? (hard ? 1 : 0.9) : (hard ? 0.35 : 0.08);
          dbl = step === 0 && bar % 2 === 0;
          break;
        case 'build':
          if (bar < 15) p = q ? 1 : (hard && bar === 14 ? 0.6 : 0);
          else p = hard ? 1 : (q ? 1 : 0);
          break;
        case 'chorus':
        case 'chorus2':
          p = q ? 1 : (hard ? 0.5 : 0.15);
          dbl = step === 0 || (hard && step === 4);
          break;
        case 'break':
          p = half ? 1 : 0; dot = true;
          dbl = step === 0 && bar % 2 === 0;
          break;
        default:
          if (bar < 47) p = half ? 1 : 0;
          else { p = step === 0 ? 1 : 0; dbl = true; }
      }
      if (rnd() >= p) continue;
      if (dbl) double(t, dot); else single(t, dot);
    }
  }
  return { notes, speed: hard ? 13 : 10 };
}
