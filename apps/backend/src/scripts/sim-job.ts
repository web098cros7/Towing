/**
 * Dev-only "auto driver" — runs a booking end to end against any backend using
 * only the public HTTP API. No DB, no Redis, no Nest.
 *
 *   pnpm sim:job --api=http://localhost:4000
 *   pnpm sim:job --api=https://api.mitow.in --i-know
 *
 * Refuses to hit a production host unless `--i-know` is passed AND
 * `MITOW_SIM_ALLOW_REMOTE=1` is set in the environment.
 *
 * The truck drives along the job's road route (the line the customer sees)
 * when the server has one, and in a straight line when it has none.
 */

import { decodePolyline } from '@towing/api-contracts';

const PROD_HOST = 'api.mitow.in';

type Args = {
  api: string;
  mobile: string;
  booking?: string;
  cash: boolean;
  speed: number;
  tick: number;
  near: LatLng;
  iKnow: boolean;
  help: boolean;
};

function parseArgs(argv: string[]): Args {
  const out: Args = {
    api: 'http://localhost:4000',
    mobile: '+919845100001',
    cash: false,
    speed: 40,
    tick: 2000,
    near: { lat: 12.9716, lng: 77.5946 },
    iKnow: false,
    help: false,
  };
  for (const raw of argv) {
    if (raw === '--help' || raw === '-h') {
      out.help = true;
      continue;
    }
    if (raw === '--cash') {
      out.cash = true;
      continue;
    }
    if (raw === '--i-know') {
      out.iKnow = true;
      continue;
    }
    const m = /^--([a-z-]+)=(.*)$/.exec(raw);
    if (!m) continue;
    const key = m[1] ?? '';
    const value = m[2] ?? '';
    switch (key) {
      case 'api':
        out.api = value;
        break;
      case 'mobile':
        out.mobile = value;
        break;
      case 'booking':
        out.booking = value;
        break;
      case 'speed':
        out.speed = Number(value);
        break;
      case 'tick':
        out.tick = Number(value);
        break;
      case 'near': {
        const parts = value.split(',');
        if (parts.length !== 2) {
          console.error(`--near must be <lat>,<lng> (got "${value}")`);
          process.exit(1);
        }
        const lat = Number(parts[0]);
        const lng = Number(parts[1]);
        if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
          console.error(`--near latitude must be a number in [-90, 90] (got "${parts[0]}")`);
          process.exit(1);
        }
        if (!Number.isFinite(lng) || lng < -180 || lng > 180) {
          console.error(`--near longitude must be a number in [-180, 180] (got "${parts[1]}")`);
          process.exit(1);
        }
        out.near = { lat, lng };
        break;
      }
    }
  }
  return out;
}

function usage(): void {
  console.log(`sim-job — dev-only auto driver

Usage:
  pnpm sim:job [--api=URL] [--mobile=+91...] [--booking=<uuid>] [--cash]
               [--speed=KPH] [--tick=MS] [--near=LAT,LNG] [--i-know]

Options:
  --api=URL       Backend base URL (default http://localhost:4000)
  --mobile=+91... Driver mobile (default +919845100001, a seeded approved driver)
  --booking=UUID  Only accept this booking
  --cash          After completing, wait for the customer to choose cash and confirm
  --speed=KPH     Simulated drive speed (default 40)
  --tick=MS       Location ping interval (default 2000)
  --near=LAT,LNG  the driver waits here; it must be within the dispatch radius of your pickup (and inside a service zone)
                  (default 12.9716,77.5946 — Bengaluru centre)
  --i-know        Required to run against a production host
  --help          Show this message
`);
}

function log(msg: string): void {
  const d = new Date();
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  console.log(`[${hh}:${mm}:${ss}] ${msg}`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

type LatLng = { lat: number; lng: number };

const R = 6_371_000;
function haversine(a: LatLng, b: LatLng): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

function bearing(a: LatLng, b: LatLng): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const y = Math.sin(toRad(b.lng - a.lng)) * Math.cos(toRad(b.lat));
  const x =
    Math.cos(toRad(a.lat)) * Math.sin(toRad(b.lat)) -
    Math.sin(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.cos(toRad(b.lng - a.lng));
  const deg = (Math.atan2(y, x) * 180) / Math.PI;
  return ((deg % 360) + 360) % 360;
}

function stepToward(from: LatLng, to: LatLng, meters: number): LatLng {
  const d = haversine(from, to);
  if (d <= meters || d === 0) return { ...to };
  const t = meters / d;
  return {
    lat: from.lat + (to.lat - from.lat) * t,
    lng: from.lng + (to.lng - from.lng) * t,
  };
}

class HttpError extends Error {
  constructor(
    readonly method: string,
    readonly path: string,
    readonly status: number,
    readonly body: string,
  ) {
    super(`${method} ${path} → ${status}`);
  }
}

class Client {
  private token: string | null = null;
  constructor(private readonly base: string) {}

  setToken(t: string): void {
    this.token = t;
  }

  /** A 429 is the server's own rate limit, not a failure: back off and retry (up to 6 times). */
  private async send(doFetch: () => Promise<Response>): Promise<Response> {
    for (let attempt = 0; ; attempt += 1) {
      const res = await doFetch();
      if (res.status !== 429 || attempt >= 5) return res;
      await sleep(1000 * (attempt + 1));
    }
  }

  private headers(json: boolean): Record<string, string> {
    const h: Record<string, string> = {};
    if (json) h['Content-Type'] = 'application/json';
    if (this.token) h['Authorization'] = `Bearer ${this.token}`;
    return h;
  }

  async get<T>(path: string, opts: { allow404?: boolean } = {}): Promise<T | null> {
    const res = await this.send(() => fetch(`${this.base}${path}`, { headers: this.headers(false) }));
    if (opts.allow404 && res.status === 404) return null;
    if (!res.ok) throw new HttpError('GET', path, res.status, await res.text());
    return (await res.json()) as T;
  }

  async post<T>(
    path: string,
    body: unknown,
    opts: { allow409?: boolean; allow404?: boolean } = {},
  ): Promise<T | null> {
    const headers = this.headers(true);
    headers['Idempotency-Key'] = crypto.randomUUID();
    const res = await this.send(() =>
      fetch(`${this.base}${path}`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body ?? {}),
      }),
    );
    if (opts.allow409 && res.status === 409) return null;
    if (opts.allow404 && res.status === 404) return null;
    if (!res.ok) throw new HttpError('POST', path, res.status, await res.text());
    if (res.status === 204) return null;
    const text = await res.text();
    return text ? (JSON.parse(text) as T) : null;
  }
}

type Offer = {
  bookingId: string;
  reference: string;
  pickup: LatLng;
  drop: LatLng | null;
};

type DriverJob = {
  bookingId: string;
  reference: string;
  status: string;
  pickup: LatLng;
  drop: LatLng | null;
  /** The road routes the customer's map draws; null until the server has one. */
  routePolyline?: string | null;
  routeDropPolyline?: string | null;
};

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    usage();
    process.exit(0);
  }

  const host = (() => {
    try {
      return new URL(args.api).host;
    } catch {
      return '';
    }
  })();

  if (host === PROD_HOST && (!args.iKnow || process.env.MITOW_SIM_ALLOW_REMOTE !== '1')) {
    console.error(
      `Refusing to run against production host ${host}.\n` +
        `Pass --i-know AND set MITOW_SIM_ALLOW_REMOTE=1 to override.`,
    );
    process.exit(1);
  }

  const api = args.api.replace(/\/$/, '');
  const client = new Client(api);

  let pos: LatLng = { lat: args.near.lat, lng: args.near.lng };
  let wentOnline = false;
  let currentJobId: string | null = null;

  const goOfflineBestEffort = async (): Promise<void> => {
    if (!wentOnline) return;
    try {
      await client.post('/v1/driver/offline', {});
      log('offline');
    } catch {
      /* best effort */
    }
  };

  process.on('SIGINT', () => {
    void (async () => {
      await goOfflineBestEffort();
      process.exit(0);
    })();
  });

  // ---- a) Login -----------------------------------------------------------
  log(`login as ${args.mobile}`);
  const send = await client.post<{ challengeId: string }>('/v1/auth/otp/send', {
    mobile: args.mobile,
    role: 'driver',
  });
  if (!send) throw new Error('otp/send returned no body');

  const devOtp = await client.get<{ otp: string }>(
    `/v1/auth/dev/otp?challengeId=${encodeURIComponent(send.challengeId)}`,
    { allow404: true },
  );
  if (!devOtp) {
    console.error('the server does not echo OTPs — set AUTH_DEV_OTP_ECHO=true on it');
    process.exit(1);
  }

  const verify = await client.post<{ accessToken: string }>('/v1/auth/otp/verify', {
    challengeId: send.challengeId,
    otp: devOtp.otp,
  });
  if (!verify) throw new Error('otp/verify returned no body');
  client.setToken(verify.accessToken);
  log('logged in');

  // ---- b) Resume or go online --------------------------------------------
  const current = await client.get<{ job: DriverJob | null }>('/v1/driver/jobs/current');
  let job: DriverJob | null = current?.job ?? null;

  if (job) {
    log(`resuming ${job.reference} (status=${job.status})`);
    currentJobId = job.bookingId;
    if (job.status === 'arrived' || job.status === 'in_progress') {
      pos = { lat: job.pickup.lat, lng: job.pickup.lng };
    }
  }
  // Online in both cases: location pings are refused from an offline driver,
  // and a resumed job still needs them.
  await client.post('/v1/driver/online', {
    at: { lat: pos.lat, lng: pos.lng },
    accuracyM: 10,
  });
  wentOnline = true;
  log('online');

  let seq = 0;
  const postLocation = async (p: LatLng, headingDeg?: number): Promise<void> => {
    seq += 1;
    await client.post('/v1/driver/location', {
      pings: [
        {
          lat: p.lat,
          lng: p.lng,
          seq,
          at: new Date().toISOString(),
          accuracyM: 10,
          headingDeg,
          speedKph: args.speed,
        },
      ],
    });
    pos = { lat: p.lat, lng: p.lng };
  };

  // ---- c) Wait for an offer ----------------------------------------------
  if (!job) {
    let offer: Offer | null = null;
    while (!offer) {
      await postLocation(pos);
      const res = await client.get<{ offer: Offer | null }>('/v1/driver/offers/current', {
        allow404: true,
      });
      const candidate = res?.offer ?? null;
      if (candidate && (!args.booking || candidate.bookingId === args.booking)) {
        offer = candidate;
        break;
      }
      await sleep(args.tick);
    }

    log(`offer ${offer.reference}`);
    const accepted = await client.post<{ job: DriverJob }>(
      `/v1/jobs/${offer.bookingId}/accept`,
      {},
    );
    if (!accepted) throw new Error('accept returned no body');
    job = accepted.job;
    currentJobId = job.bookingId;
    log(`accepted ${job.reference}`);
  }

  // ---- d) Drive to pickup -------------------------------------------------

  /**
   * The leg's road route, as the customer's map draws it. The server computes
   * it just after accept (and the drop leg at start), so it is polled briefly;
   * null means a straight line.
   */
  const routeFor = async (leg: 'pickup' | 'drop'): Promise<LatLng[] | null> => {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const res = await client.get<{ job: DriverJob | null }>('/v1/driver/jobs/current');
      const encoded = leg === 'pickup' ? res?.job?.routePolyline : res?.job?.routeDropPolyline;
      if (encoded) {
        const points = decodePolyline(encoded);
        if (points.length >= 2) return points.map((p) => ({ lat: p.lat, lng: p.lng }));
      }
      await sleep(1500);
    }
    return null;
  };

  const driveTo = async (
    target: LatLng,
    arriveWithinM: number,
    route: LatLng[] | null = null,
  ): Promise<void> => {
    const meters = (args.speed * 1000 * args.tick) / 3_600_000;
    // Road route first: start from its point nearest the truck, then follow it.
    if (route) {
      let nearest = 0;
      route.forEach((p, i) => {
        if (haversine(pos, p) < haversine(pos, route[nearest]!)) nearest = i;
      });
      const queue = route.slice(nearest);
      while (queue.length > 0 && haversine(pos, target) > arriveWithinM) {
        let budget = meters;
        let next = pos;
        while (budget > 0 && queue.length > 0) {
          const d = haversine(next, queue[0]!);
          if (d <= budget) {
            next = queue.shift()!;
            budget -= d;
          } else {
            next = stepToward(next, queue[0]!, budget);
            budget = 0;
          }
        }
        const same = next.lat === pos.lat && next.lng === pos.lng;
        const heading = same ? undefined : Math.round(bearing(pos, next) * 10) / 10;
        await postLocation(next, heading);
        await sleep(args.tick);
      }
    }
    // The rest (or all of it, with no route): a straight line.
    while (haversine(pos, target) > arriveWithinM) {
      const next = stepToward(pos, target, meters);
      const same = next.lat === pos.lat && next.lng === pos.lng;
      const heading = same ? undefined : Math.round(bearing(pos, next) * 10) / 10;
      await postLocation(next, heading);
      await sleep(args.tick);
    }
  };

  if (job.status === 'assigned' || job.status === 'en_route') {
    const route = await routeFor('pickup');
    log(
      `driving to pickup ${job.reference} (${route ? `road route, ${route.length} points` : 'straight line'})`,
    );
    await driveTo(job.pickup, 60, route);
    await client.post(`/v1/jobs/${job.bookingId}/arrived`, {});
    log(`arrived ${job.reference}`);
  }

  // ---- e) Start code ------------------------------------------------------
  if (job.status === 'assigned' || job.status === 'en_route' || job.status === 'arrived') {
    await sleep(5000);
    const codeRes = await client.get<{ code: string; expiresAt: string }>(
      `/v1/dev/jobs/${job.bookingId}/start-code`,
    );
    if (!codeRes) throw new Error('start-code returned no body');
    await client.post(`/v1/jobs/${job.bookingId}/start`, { otp: codeRes.code });
    log(`started ${job.reference}`);
  }

  // ---- f) Drive to drop ---------------------------------------------------
  if (job.drop) {
    // Loading the vehicle takes a moment before the truck leaves the pickup.
    await sleep(8000);
    const route = await routeFor('drop');
    log(
      `driving to drop ${job.reference} (${route ? `road route, ${route.length} points` : 'straight line'})`,
    );
    await driveTo(job.drop, 60, route);
  } else {
    log('roadside job — waiting 20s at pickup');
    await sleep(20_000);
  }

  await client.post(`/v1/jobs/${job.bookingId}/complete`, {});
  log(`completed ${job.reference}`);

  // ---- g) Cash ------------------------------------------------------------
  if (args.cash) {
    log('waiting for customer to choose cash');
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const res = await client.post(
        `/v1/jobs/${job.bookingId}/cash-collected`,
        {},
        { allow409: true },
      );
      if (res !== null) break;
      await sleep(5000);
    }
    log('cash collected');
  } else {
    log('completed — the customer can now pay');
  }

  // ---- h) Offline ---------------------------------------------------------
  await goOfflineBestEffort();
  process.exit(0);
}

main().catch((err) => {
  if (err instanceof HttpError) {
    console.error(`${err.method} ${err.path} → ${err.status}`);
    console.error(err.body);
  } else {
    console.error(err);
  }
  process.exit(1);
});
