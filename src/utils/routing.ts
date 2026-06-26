import fs from 'fs';
import path from 'path';

const ROUTING_FILE = path.join(__dirname, '..', '..', 'deployments', 'routing.json');

export interface RouteEntry {
  target: string; // e.g. 'http://localhost:8001' or local static dir
  type: 'static' | 'dynamic';
}

export function getRoutes(): Record<string, RouteEntry> {
  if (!fs.existsSync(ROUTING_FILE)) return {};
  try {
    return JSON.parse(fs.readFileSync(ROUTING_FILE, 'utf8'));
  } catch (e) {
    return {};
  }
}

export function setRoute(subdomain: string, target: string, type: 'static' | 'dynamic') {
  const routes = getRoutes();
  routes[subdomain] = { target, type };
  // Ensure deployments dir exists
  const dir = path.dirname(ROUTING_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(ROUTING_FILE, JSON.stringify(routes, null, 2));
}

export function removeRoute(subdomain: string) {
  const routes = getRoutes();
  delete routes[subdomain];
  fs.writeFileSync(ROUTING_FILE, JSON.stringify(routes, null, 2));
}
