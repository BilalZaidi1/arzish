// Seeded random numbers: xoshiro128** seeded through splitmix32, Marsaglia polar normals.

function rotl(x: number, k: number): number {
  return (x << k) | (x >>> (32 - k));
}

export class Rng {
  private a: number;
  private b: number;
  private c: number;
  private d: number;
  private spare = 0;
  private hasSpare = false;

  constructor(seed: number) {
    let s = (seed >>> 0) || 0x9e3779b9;
    const sm = () => {
      s = (s + 0x9e3779b9) | 0;
      let z = s;
      z = Math.imul(z ^ (z >>> 16), 0x85ebca6b);
      z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35);
      return (z ^ (z >>> 16)) >>> 0;
    };
    this.a = sm();
    this.b = sm();
    this.c = sm();
    this.d = sm();
    if ((this.a | this.b | this.c | this.d) === 0) this.a = 1;
  }

  nextU32(): number {
    const result = Math.imul(rotl(Math.imul(this.b, 5), 7), 9) >>> 0;
    const t = this.b << 9;
    this.c ^= this.a;
    this.d ^= this.b;
    this.b ^= this.c;
    this.a ^= this.d;
    this.c ^= t;
    this.d = rotl(this.d, 11);
    return result;
  }

  /** Uniform on the open interval (0, 1). */
  uniform(): number {
    return (this.nextU32() + 0.5) / 4294967296;
  }

  normal(): number {
    if (this.hasSpare) {
      this.hasSpare = false;
      return this.spare;
    }
    let u = 0, v = 0, s = 0;
    do {
      u = this.uniform() * 2 - 1;
      v = this.uniform() * 2 - 1;
      s = u * u + v * v;
    } while (s >= 1 || s === 0);
    const mul = Math.sqrt((-2 * Math.log(s)) / s);
    this.spare = v * mul;
    this.hasSpare = true;
    return u * mul;
  }
}
