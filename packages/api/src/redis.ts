import Redis from "ioredis";

let pub: Redis | null = null;
let sub: Redis | null = null;

export function isRedisEnabled(): boolean {
  return !!process.env.REDIS_URL;
}

export function getRedisPub(): Redis {
  if (!pub) {
    const url = process.env.REDIS_URL;
    if (!url) throw new Error("REDIS_URL is required");
    pub = new Redis(url, { maxRetriesPerRequest: 3, lazyConnect: true });
  }
  return pub;
}

export function getRedisSub(): Redis {
  if (!sub) {
    const url = process.env.REDIS_URL;
    if (!url) throw new Error("REDIS_URL is required");
    sub = new Redis(url, { maxRetriesPerRequest: 3, lazyConnect: true });
  }
  return sub;
}

export async function connectRedis(): Promise<void> {
  if (!isRedisEnabled()) {
    console.log("[redis] REDIS_URL not configured — event bus disabled");
    return;
  }
  await getRedisPub().connect();
  await getRedisSub().connect();
  console.log("[redis] Connected");
}

export async function closeRedis(): Promise<void> {
  if (pub) { pub.disconnect(); pub = null; }
  if (sub) { sub.disconnect(); sub = null; }
}
