import { env } from './env';
import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';
import rateLimit from 'express-rate-limit';
import authRoutes from './routes/auth';
import deploymentRoutes from './routes/deployments';
import { recoverQueue } from './routes/deployments';
import { createProxyMiddleware, fixRequestBody } from 'http-proxy-middleware';
import { getRoutes } from './utils/routing';
import { logger } from './logger';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

// --- Rate Limiting ---
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // 100 requests per window per IP
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later.' },
});

const deployLimiter = rateLimit({
  windowMs: 10 * 60 * 1000, // 10 minutes
  max: 10, // 10 deployments per window per IP
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Deployment rate limit exceeded. Please wait before deploying again.' },
});

const webhookLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 30, // 30 webhook events per minute
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Webhook rate limit exceeded.' },
});

// Apply general rate limit to all /v1 API routes
app.use('/v1', apiLimiter);

app.use(cors());

// Parse JSON bodies (needed for API, but not for proxying)
// We only apply this to /v1 routes so it doesn't mess up proxying raw streams
app.use('/v1', express.json({
  verify: (req: any, res, buf) => {
    req.rawBody = buf;
  }
}));

function handleNotFound(res: Response, subdomain: string) {
  return res.status(404).send(`
    <div style="font-family: sans-serif; padding: 40px; text-align: center; background: #000; color: #fff; height: 100vh; display: flex; flex-direction: column; justify-content: center;">
      <h1 style="color: #ef4444; font-size: 32px; margin-bottom: 10px;">Deployment Not Found</h1>
      <p style="color: #888; font-size: 16px;">The deployment <code>${subdomain}</code> could not be found or is not running.</p>
      <p style="color: #666; font-size: 14px; margin-top: 20px;">CollabCode Cloud Hosting Engine</p>
    </div>
  `);
}

// Subdomain serving middleware (PaaS Routing)
app.use(async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  const host = req.headers.host || '';
  const hostWithoutPort = host.split(':')[0];
  
  let subdomain = null;
  const baseDomain = process.env.BASE_DOMAIN || 'localhost';
  
  if (hostWithoutPort.endsWith(`.${baseDomain}`)) {
    subdomain = hostWithoutPort.replace(`.${baseDomain}`, '');
  }
  
  if (subdomain && subdomain !== 'www' && subdomain !== 'api') {
    const routes = getRoutes();
    const route = routes[subdomain];

    if (route) {
      if (route.type === 'dynamic') {
        // Reverse Proxy to Docker Container
        const proxy = createProxyMiddleware({
          target: route.target,
          changeOrigin: true,
          ws: true,
          on: { proxyReq: fixRequestBody }
        });
        return proxy(req, res, next);
      } 
      else if (route.type === 'static') {
        // Serve Local Static Directory
        let targetPath = req.path;
        if (targetPath === '/' || targetPath === '') targetPath = '/index.html';
        
        const fullPath = path.join(route.target, targetPath);
        
        // Prevent path traversal attacks
        if (!fullPath.startsWith(path.resolve(route.target))) {
          return res.status(403).send('Forbidden: Invalid path');
        }

        if (fs.existsSync(fullPath) && fs.statSync(fullPath).isFile()) {
           return res.sendFile(fullPath);
        } else if (fs.existsSync(fullPath + '.html')) {
           return res.sendFile(fullPath + '.html');
        } else {
           // Try serving index.html if it's a SPA
           const spaIndex = path.join(route.target, 'index.html');
           if (fs.existsSync(spaIndex)) return res.sendFile(spaIndex);
        }
      }
    }
    
    return handleNotFound(res, subdomain);
  }
  
  next();
});

// Path-based serving fallback (e.g. /deployments/myproject-dpl123)
app.get('/deployments/:subdomain', async (req: Request, res: Response): Promise<any> => {
  const subdomain = req.params.subdomain as string;
  const routes = getRoutes();
  const route = routes[subdomain];
  
  if (route && route.type === 'static') {
    const spaIndex = path.join(route.target, 'index.html');
    if (fs.existsSync(spaIndex)) return res.sendFile(spaIndex);
  }
  return handleNotFound(res, subdomain);
});

// API Routes
app.use('/v1/login', authRoutes);
app.use('/v1/deployments', deployLimiter, deploymentRoutes);
app.use('/v1/deployments/webhook', webhookLimiter);

// Default API Route
app.get('/', (req, res) => {
  res.json({
    name: 'CollabCode Hosting API (PaaS Engine)',
    version: '2.0.0',
    status: 'online',
    architecture: 'Docker + Local Routing'
  });
});

app.listen(PORT, async () => {
  logger.info({ port: PORT }, `CollabCode PaaS Backend running on http://localhost:${PORT}`);
  logger.info(`Dynamic Routing enabled (e.g. http://[project]-[deploymentId].localhost:${PORT})`);
  
  // Recover any builds that were interrupted by a server crash/restart
  await recoverQueue();
});
