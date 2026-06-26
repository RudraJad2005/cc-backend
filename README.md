# CollabCode PaaS Engine 🚀

This is the core backend engine for **CollabCode**, a custom Platform-as-a-Service (PaaS) that instantly containerizes and deploys web applications.

## Features
- **Dynamic Containerization:** Automatically detects `package.json` in user uploads and builds isolated Docker containers.
- **Instant Subdomain Routing:** Uses dynamic reverse proxying (`http-proxy-middleware`) to route traffic like `https://my-project.52.172.229.65.nip.io` directly to the correct running Docker container.
- **Zero-Config Deployments:** Users simply upload their source code (without `node_modules`), and the engine handles `npm install`, image building, and port mapping automatically.
- **Static Site Hosting:** Automatically falls back to high-speed static file serving for plain HTML/JS applications.

## Architecture
The engine is built with:
- **Express / TypeScript:** Robust API and proxy routing layer.
- **Docker Engine:** Core container virtualization for isolation.
- **Supabase:** Tracks deployment logs and project status in real-time.
- **Multer:** Handles high-speed multi-part zip file streaming and extraction.

## Deployment Setup (Azure VM)
This engine is designed to run on a Linux Virtual Machine with Docker installed.

1. **Clone the repository:**
   ```bash
   git clone https://github.com/RudraJad2005/cc-backend.git
   cd cc-backend
   ```

2. **Install Dependencies:**
   ```bash
   npm install
   ```

3. **Build the TypeScript Code:**
   ```bash
   npm run build
   ```

4. **Start the Engine (with PM2):**
   ```bash
   pm2 start dist/index.js --name cc-backend
   ```

## API Endpoints
- `POST /v1/deployments` - Accepts a `.zip` file upload and streams back real-time build logs via HTTP Chunked Transfer Encoding.
- `GET /*` (Subdomain) - Reverse proxies traffic to the allocated Docker container.

## Security
- API endpoints are protected via JWT authentication synced with Supabase.
- Containers run on isolated internal network ports.
- The `node_modules` are built securely on the server to prevent architecture mismatch.
